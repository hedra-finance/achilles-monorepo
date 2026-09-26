// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IRequestVault } from "../interfaces/IRequestVault.sol";
import { IRestrictedShare } from "../interfaces/IRestrictedShare.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { WireCodec } from "../bridge/WireCodec.sol";
import { CapitalAllocator } from "./CapitalAllocator.sol";
import { TrancheBalances } from "../libraries/TrancheBalances.sol";
import { SettlementApply } from "../libraries/SettlementApply.sol";

interface IWhitelistWriter { function applyWhitelist(address vault, address who, bool grant) external; } // per-vault registry (AllowlistHook)
interface ISpokeRouter {
    function send(uint64 productId, uint64 dstChainId, address to, uint256 amount, bytes calldata message) external;
    function payoutLocal(uint64 productId, uint256 amount) external;
}

/// @title  VaultCoordinator — the chain's request ledger, settlement applier and message handler, for every product
/// @notice One deployment per chain. Escrow, the per-request state machine and the cash ledger are keyed by
///         productId, and a product is wired up by registering it rather than by deploying another copy.
///         - requestDeposit: escrow → send the full amount to the hub with DEPOSIT_REQ
///         - requestRedeem:  escrow shares → start local pre-release at the last known price → send REDEEM_REQ
///         - SETTLEMENT_FINALIZE: deposits become claimable shares, redemptions become claimable assets
///         Multiple open requests per user are allowed (ledger keyed by requestId). Cancel is not supported cross-chain.
/// @dev    The bridge lives in SpokeRouter, not here. Inheriting BridgeClient cost 6.8KB and left this contract
///         six bytes under EIP-170, which is why one product per deployment used to be the only option.
///
///         Cash is tracked per product and never pooled. Several products share this address, so a single
///         balance would let one product's payout quietly spend another's principal.
///
///         User-facing state is keyed by vault address rather than by tranche index: a vault belongs to exactly
///         one (product, tranche), so the vault is the unambiguous key once one coordinator serves many products.
contract VaultCoordinator is Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 private constant PENDING = 1; // status 0 = empty slot
    uint8 private constant CLAIMABLE = 2;
    uint256 internal constant WAD = 1e18;

    // ── chain-wide wiring ──
    address public owner;
    IERC20 public asset;
    uint64 public localChainId;
    uint64 public hubChainId;
    address public hubOrchestrator; // hub receiver (HubRouter); the counterpart of every outbound message
    address public router;          // SpokeRouter: the chain's bridge endpoint, and the only caller of onBridgeMessage
    bool public paused;             // chain-wide stop; a product can also be paused on its own

    uint64 private _reqSeq;         // requestId = productId(64) | chainId(64) | seq(128), globally unique

    struct Product {
        bool registered;
        bool paused;
        uint8 trancheCount;
        CapitalAllocator allocator;   // this product's allocator on this chain (the pallet requires one per product)
        uint256 minRequest;           // shared by deposits (assets) and redemptions (shares); 0 disables
        // Cash ledger, tracked additively: a "balance − reserved" subtraction clamped under sponsor drift and hid
        // the payout reserve from NAV, so only redemption releases, payout receipts and payout spend are counted.
        uint256 poolCash;
        uint256 payoutReserve;        // reserved for user payouts (subset of poolCash)
        uint256 owedAssets;           // finalized but unclaimed redemptions; subtracted from the reported chain NAV
        uint256 payoutOutbound;       // realized redemption releases waiting to ship with the next NAV response
        uint256 supplyRecvCum;        // cumulative deposit allocations received; hub computes in-transit = sent − this
        mapping(uint8 tranche => address) vaultOf;
        mapping(uint8 tranche => uint256) lastSharePrice; // cached settlement prices; sizes redemption pre-release
        mapping(uint256 settlementId => bool) payoutCreditedAt; // one payout credit per settlement (chunked or redelivered)
    }
    mapping(uint64 productId => Product) internal _p;

    // ── vault registry (chain-wide; a vault belongs to exactly one product) ──
    mapping(address vault => uint64) public productOfVault;
    mapping(address vault => uint8) private _trancheOf;
    mapping(address vault => bool) public isVault;
    mapping(address share => address vault) public vaultOfShare;
    mapping(address vault => address) public whitelistHookOf;
    mapping(address vault => mapping(address who => uint256)) public whitelistNonceOf;

    // Per-request ledger: a user may add requests before claiming earlier ones, and each request may settle at a
    // different price when it rolls over, so requests are stored individually rather than aggregated.
    // kind matches the pallet order_type: 1 = deposit, 0 = redeem (existence is tracked by status).
    mapping(bytes32 requestId => SettlementApply.Req) public reqOf;
    mapping(address vault => mapping(address controller => bytes32[])) private _userDepReqs;
    mapping(address vault => mapping(address controller => bytes32[])) private _userRedReqs;

    event ProductRegistered(uint64 indexed productId, address allocator, uint8 trancheCount);
    event ProductPausedSet(uint64 indexed productId, bool paused);
    event VaultSet(uint64 indexed productId, uint8 indexed tranche, address vault, address share);
    event RouterSet(address router);
    event MinRequestSet(uint64 indexed productId, uint256 amount);
    // Request lifecycle events lead with an indexed requestId so they join with hub Queued/Approved events.
    event DepositRequested(bytes32 indexed requestId, uint64 chainId, address indexed vault, address indexed controller, uint256 assets, uint256 localSupplied, uint256 remainderSent);
    event RedeemRequested(bytes32 indexed requestId, uint64 chainId, address indexed vault, address indexed controller, uint256 shares, uint256 localInitiated);
    // Same parameters as the hub's WhitelistRequested so both ends join directly.
    event WhitelistApplied(uint64 chainId, address indexed vault, address indexed who, bool grant, uint256 nonce);
    event WhitelistStale(uint64 chainId, address indexed vault, address indexed who, uint256 nonce, uint256 latest);
    event DepositReceived(uint64 indexed productId, uint64 chainId, address indexed vault, address indexed controller, address receiver, uint256 shares);
    event RedeemReceived(uint64 indexed productId, uint64 chainId, address indexed vault, address indexed controller, address receiver, uint256 assets);
    event SupplyReceived(bytes32 indexed requestId, uint256 amount);
    event DustAccrued(uint64 indexed productId, uint8 tag, uint256 amount);
    event NavReported(uint64 indexed productId, uint256 indexed settlementId, uint256 chainNav);
    event PayoutRealized(uint64 indexed productId, uint256 realized);
    event PausedSet(bool paused);
    event WhitelistHookSet(address indexed vault, address hook);
    event OwnershipTransferred(address newOwner);
    event DustSwept(address indexed to, uint256 amount);

    error NotOwner();
    error NotVault();
    error NotRouter();
    error NotHub();
    error EnforcedPause();
    error NothingClaimable();
    error NotSettled();
    error AssetMismatch();
    error CancelNotSupported();
    error SweepExceedsDust();
    error UnknownTag(uint8 tag);
    error UnknownProduct();
    error BadTranche();
    error BelowMinRequest();

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }
    modifier onlyVault() { if (!isVault[msg.sender]) revert NotVault(); _; }

    constructor() { _disableInitializers(); } // implementation is only used behind UpgradeableProxy

    function initialize(address asset_, uint64 localChainId_, uint64 hubChainId_, address hubOrchestrator_)
        external
        initializer
    {
        owner = msg.sender;
        asset = IERC20(asset_);
        localChainId = localChainId_;
        hubChainId = hubChainId_;
        hubOrchestrator = hubOrchestrator_;
    }

    // ──────────────────────────────────────────────────────────────
    // Admin
    // ──────────────────────────────────────────────────────────────

    /// @notice Points this coordinator at the chain's bridge endpoint and lets it pull assets for outbound sends.
    /// @dev    A standing allowance rather than per-send approvals: the router pulls only inside its own send,
    ///         which is callable by this contract alone.
    function setRouter(address r) external onlyOwner {
        if (router != address(0)) asset.forceApprove(router, 0);
        router = r;
        asset.forceApprove(r, type(uint256).max);
        emit RouterSet(r);
    }

    /// @notice Adds a product, or updates its allocator / tranche count. Vaults are wired afterwards.
    function registerProduct(uint64 productId, address allocator, uint8 trancheCount_) external onlyOwner {
        Product storage p = _p[productId];
        if (trancheCount_ < p.trancheCount) revert BadTranche(); // lowering would orphan wired vaults
        p.registered = true;
        p.allocator = CapitalAllocator(allocator);
        p.trancheCount = trancheCount_;
        emit ProductRegistered(productId, allocator, trancheCount_);
    }

    function setVault(uint64 productId, uint8 tranche, address vault) external onlyOwner {
        Product storage p = _p[productId];
        if (!p.registered) revert UnknownProduct();
        if (tranche >= p.trancheCount) revert BadTranche();
        if (IRequestVault(vault).asset() != address(asset)) revert AssetMismatch();
        if (IRequestVault(vault).tranche() != tranche) revert BadTranche();
        address sh = IRequestVault(vault).share();
        address old = p.vaultOf[tranche];
        if (old != address(0)) {
            isVault[old] = false;
            delete productOfVault[old];
            address oldShare = IRequestVault(old).share();
            if (oldShare != sh) {
                delete vaultOfShare[oldShare];
                IRestrictedShare(oldShare).notifyVaultUpdate(address(asset), address(0));
            }
        }
        p.vaultOf[tranche] = vault;
        _trancheOf[vault] = tranche;
        isVault[vault] = true;
        productOfVault[vault] = productId;
        vaultOfShare[sh] = vault;
        IRestrictedShare(sh).notifyVaultUpdate(address(asset), vault);
        emit VaultSet(productId, tranche, vault, sh);
    }

    function setMinRequest(uint64 productId, uint256 amount) external onlyOwner {
        _p[productId].minRequest = amount;
        emit MinRequestSet(productId, amount);
    }
    function setPaused(bool v) external onlyOwner { paused = v; emit PausedSet(v); }
    function setProductPaused(uint64 productId, bool v) external onlyOwner {
        _p[productId].paused = v;
        emit ProductPausedSet(productId, v);
    }
    function setWhitelistHook(address vault, address h) external onlyOwner { whitelistHookOf[vault] = h; emit WhitelistHookSet(vault, h); }
    function transferOwnership(address o) external onlyOwner { owner = o; emit OwnershipTransferred(o); }

    // ──────────────────────────────────────────────────────────────
    // Vault → coordinator: requests (vault has already transferred assets/shares here)
    // ──────────────────────────────────────────────────────────────

    /// @dev The caller is the vault, and a vault belongs to one product, so the product is derived rather than
    ///      passed — a vault cannot name a product it does not belong to.
    function _of(address vault) internal view returns (Product storage p, uint64 pid, uint8 t) {
        pid = productOfVault[vault];
        p = _p[pid];
        if (!p.registered) revert UnknownProduct();
        if (paused || p.paused) revert EnforcedPause();
        t = _trancheOf[vault];
    }

    function requestDeposit(address controller, address /*owner*/, uint256 assets) external onlyVault nonReentrant {
        (Product storage p, uint64 pid, uint8 t) = _of(msg.sender);
        if (assets < p.minRequest) revert BelowMinRequest();
        bytes32 requestId = _newRequestId(pid);
        reqOf[requestId] = SettlementApply.Req(PENDING, 1, t, controller, assets, 0);
        _userDepReqs[msg.sender][controller].push(requestId);

        // Sends the full deposit to the hub. No local supply at request time: the spoke cannot tell whether the
        // hub is mid-collection, and unconfirmed deposit funds mixed into spoke NAV would inflate that round's
        // price. The hub allocates on approval instead, so localSupplied is always 0 (event field kept).
        _sendDepositReq(p, pid, requestId, assets, controller, msg.sender);
        emit DepositRequested(requestId, localChainId, msg.sender, controller, assets, 0, assets);
    }

    function _sendDepositReq(Product storage p, uint64 pid, bytes32 requestId, uint256 assets, address controller, address vault) internal {
        uint256 wv = p.allocator.weightsVersion(); // separate local to keep the stack shallow
        ISpokeRouter(router).send(pid, hubChainId, hubOrchestrator, assets,
            WireCodec.encodeDepositReq(pid, requestId, assets, wv, controller, vault));
    }

    function requestRedeem(address controller, address /*owner*/, uint256 shares) external onlyVault nonReentrant {
        (Product storage p, uint64 pid, uint8 t) = _of(msg.sender);
        if (shares < p.minRequest) revert BelowMinRequest();
        bytes32 requestId = _newRequestId(pid);
        reqOf[requestId] = SettlementApply.Req(PENDING, 0, t, controller, shares, 0); // kind 0 = redeem; inAmt = escrowed shares to burn later
        _userRedReqs[msg.sender][controller].push(requestId);

        // Pre-release on the requesting chain: start releasing the local share of the expected payout at the
        // last known price.
        uint256 localInitiated;
        uint256 price = p.lastSharePrice[t];
        if (price != 0 && p.allocator.localShareBps() > 0) { // local share 0 → nothing to pre-release (hub coordinator)
            uint256 realizedNow;
            (localInitiated, realizedNow) = p.allocator.withdrawLocalShare(shares * price / WAD, requestId);
            p.poolCash += realizedNow;       // only realized funds; ASYNC releases are counted when collected
            p.payoutOutbound += realizedNow; // ships with the next NAV response
        }
        _sendRedeemReq(pid, requestId, shares, controller, localInitiated, msg.sender);
        emit RedeemRequested(requestId, localChainId, msg.sender, controller, shares, localInitiated);
    }

    /// @dev Separate frame: the encode call plus the request locals overflow the stack otherwise.
    function _sendRedeemReq(uint64 pid, bytes32 requestId, uint256 shares, address controller, uint256 localInitiated, address vault) internal {
        ISpokeRouter(router).send(pid, hubChainId, hubOrchestrator, 0,
            WireCodec.encodeRedeemReq(pid, requestId, shares, controller, localInitiated, vault));
    }

    /// @notice Collect ready ASYNC redemption tickets into the outbound payout queue (keeper call; ships with the next NAV response).
    function drainPayoutAsync(uint64 productId) external nonReentrant { _drainPayout(_p[productId], productId); }

    function _drainPayout(Product storage p, uint64 pid) internal {
        uint256 realized = p.allocator.receiveReady(p.allocator.TICKET_PAYOUT());
        if (realized > 0) {
            p.poolCash += realized;
            p.payoutOutbound += realized;
            emit PayoutRealized(pid, realized);
        }
    }

    /// @notice Collect ready ASYNC rebalance tickets and ship them via NET_BRIDGE (keeper call).
    function drainRebalanceAsync(uint64 productId) external nonReentrant {
        CapitalAllocator a = _p[productId].allocator;
        _bridgeRebalance(productId, a.receiveReady(a.TICKET_REBALANCE()));
    }

    /// @dev Ship SYNC rebalance releases to the hub via NET_BRIDGE.
    function _bridgeRebalance(uint64 pid, uint256 amount) internal {
        if (amount == 0) return;
        ISpokeRouter(router).send(pid, hubChainId, hubOrchestrator, amount, WireCodec.encodeNetBridge(pid, 0));
    }

    /// @dev requestId = bytes32(productId << 192 | chainId << 128 | seq); the pallet consumes it as bytes32.
    ///      The sequence is chain-wide, so ids stay unique across products without a counter each.
    function _newRequestId(uint64 pid) internal returns (bytes32) {
        return bytes32((uint256(pid) << 192) | (uint256(localChainId) << 128) | uint256(++_reqSeq));
    }

    // ──────────────────────────────────────────────────────────────
    // Bridge receive (router only; the router has already authenticated the hub as sender)
    // ──────────────────────────────────────────────────────────────

    function onBridgeMessage(uint64 productId, uint64 sourceChain, uint256 amount, bytes calldata message)
        external
        nonReentrant
    {
        if (msg.sender != router) revert NotRouter();
        if (sourceChain != hubChainId) revert NotHub();
        Product storage p = _p[productId];
        if (!p.registered) revert UnknownProduct();

        WireCodec.Envelope memory e = WireCodec.decode(message);
        uint8 tag = e.kind;
        // Assets riding on message-only tags are carrier dust; they are not in poolCash-based NAV, so only observe them.
        if (tag != WireCodec.ADAPTER_SUPPLY && tag != WireCodec.SETTLEMENT_FINALIZE && amount > 0) emit DustAccrued(productId, tag, amount);

        if (tag == WireCodec.ADAPTER_SUPPLY) {
            asset.forceApprove(address(p.allocator), amount); // SUPPLY has a single purpose: allocate
            p.allocator.supplyAll(amount, e.requestId);
            p.supplyRecvCum += amount; // hub compares against its sent cumulative for in-transit funds
            emit SupplyReceived(e.requestId, amount);
        } else if (tag == WireCodec.SETTLEMENT_FINALIZE) {
            // Payout allocation arrives with the finalize message (declared e.amount; excess is carrier dust).
            // Credited once per settlementId so redelivery cannot double-count.
            if (e.amount > 0 && !p.payoutCreditedAt[e.settlementId]) {
                p.payoutCreditedAt[e.settlementId] = true;
                p.payoutReserve += e.amount;
                p.poolCash += e.amount;
            }
            if (amount > e.amount) emit DustAccrued(productId, tag, amount - e.amount);
            p.owedAssets += SettlementApply.applySettle(reqOf, p.lastSharePrice, e);
        } else if (tag == WireCodec.SETTLEMENT_COLLECT) {
            for (uint256 i = 0; i < e.nums.length && i < 255; i++) p.lastSharePrice[uint8(i)] = e.nums[i];
            _respondNav(p, productId, e.settlementId);
        } else if (tag == WireCodec.ALLOCATION_SYNC) {
            (uint256 wv, uint16 lsb) = WireCodec.unpackAllocation(e.aux);
            uint16[] memory wbps = new uint16[](e.nums.length);
            for (uint256 i = 0; i < e.nums.length; i++) wbps[i] = uint16(e.nums[i]);
            p.allocator.syncAllocation(wv, lsb, e.addrs, wbps);
        } else if (tag == WireCodec.ADAPTER_WITHDRAW) {
            if (e.flag == WireCodec.WITHDRAW_PAYOUT) {
                // Payout sourcing: same computation the requesting chain does in requestRedeem, run on this chain.
                // Realized funds are not bridged immediately; they ship with the next NAV response.
                (, uint256 realized) = p.allocator.withdrawLocalShare(e.amount, e.requestId);
                p.poolCash += realized;
                p.payoutOutbound += realized;
            } else {
                uint256 realized = p.allocator.withdrawFor(e.addrs, e.nums, e.requestId, p.allocator.TICKET_REBALANCE());
                _bridgeRebalance(productId, realized); // SYNC ships now; ASYNC tickets follow via drainRebalanceAsync
            }
        } else if (tag == WireCodec.WHITELIST_SYNC) {
            address h = whitelistHookOf[e.vault];
            // Drop out-of-order delivery: ignore if a newer instruction was already applied (bridge does not guarantee ordering).
            if (e.aux <= whitelistNonceOf[e.vault][e.account]) {
                emit WhitelistStale(localChainId, e.vault, e.account, e.aux, whitelistNonceOf[e.vault][e.account]);
            } else if (h != address(0)) {
                whitelistNonceOf[e.vault][e.account] = e.aux;
                IWhitelistWriter(h).applyWhitelist(e.vault, e.account, e.flag == WireCodec.ACTION_GRANT);
                emit WhitelistApplied(localChainId, e.vault, e.account, e.flag == WireCodec.ACTION_GRANT, e.aux);
            }
        } else {
            revert UnknownTag(tag);
        }
    }

    /// @dev Chain NAV = source valuations + pool-owned cash − finalized unpaid liabilities, shipped to the hub
    ///      together with the realized redemption releases that leave this chain in the same message.
    function _respondNav(Product storage p, uint64 pid, uint256 settlementId) internal {
        // A hub-chain coordinator sends no NAV response: the hub's own NAV is already in the ledger snapshot
        // (double counting), and a synchronous response would re-enter the collecting ledger. It only hands over
        // realized redemption releases directly, which is what a spoke ships with its response.
        if (localChainId == hubChainId) {
            _drainPayout(p, pid);
            uint256 shipLocal = p.payoutOutbound > p.poolCash ? p.poolCash : p.payoutOutbound;
            if (shipLocal > 0) {
                p.payoutOutbound = 0;
                p.poolCash -= shipLocal;
                ISpokeRouter(router).payoutLocal(pid, shipLocal);
            }
            return;
        }
        p.allocator.pokeAdapters(); // let inner sources rebalance right before NAV is read
        WireCodec.AdapterValuation[] memory vals = p.allocator.adapterValuations();
        _drainPayout(p, pid); // collect ready ASYNC tickets so as much as possible ships with this response
        uint256 ship = p.payoutOutbound > p.poolCash ? p.poolCash : p.payoutOutbound;
        p.payoutOutbound = 0;
        p.poolCash -= ship;
        uint256 nav = p.allocator.chainNav() + p.poolCash;
        nav = nav > p.owedAssets ? nav - p.owedAssets : 0;
        _sendNav(pid, settlementId, nav, ship, p.supplyRecvCum, vals);
        emit NavReported(pid, settlementId, nav);
    }

    /// @dev Separate frame: the encode call plus the response locals overflow the stack otherwise.
    function _sendNav(uint64 pid, uint256 settlementId, uint256 nav, uint256 ship, uint256 recvCum, WireCodec.AdapterValuation[] memory vals) internal {
        ISpokeRouter(router).send(pid, hubChainId, hubOrchestrator, ship,
            WireCodec.encodeNavResponse(pid, settlementId, nav, ship, recvCum, vals));
    }

    // ──────────────────────────────────────────────────────────────
    // Claim
    // ──────────────────────────────────────────────────────────────

    /// @dev Claims every CLAIMABLE request in one go (per-request prices are already reflected in outAmt).
    ///      Reverts NotSettled if only PENDING requests exist. Swap-pop removes claimed entries; PENDING ones stay.
    function claimDeposit(address controller, address receiver) external onlyVault nonReentrant returns (uint256 shares) {
        (, uint64 pid, ) = _of(msg.sender);
        (shares, ) = _drainClaimable(_userDepReqs[msg.sender][controller]);
        IRestrictedShare(IRequestVault(msg.sender).share()).mint(receiver, shares);
        emit DepositReceived(pid, localChainId, msg.sender, controller, receiver, shares);
    }

    function claimRedeem(address controller, address receiver) external onlyVault nonReentrant returns (uint256 assets) {
        (Product storage p, uint64 pid, ) = _of(msg.sender);
        uint256 escrowShares;
        (assets, escrowShares) = _drainClaimable(_userRedReqs[msg.sender][controller]);
        p.owedAssets = p.owedAssets > assets ? p.owedAssets - assets : 0;
        IRestrictedShare(IRequestVault(msg.sender).share()).burn(address(this), escrowShares);
        if (assets <= p.payoutReserve) p.payoutReserve -= assets; else p.payoutReserve = 0;
        p.poolCash = assets <= p.poolCash ? p.poolCash - assets : 0;
        asset.safeTransfer(receiver, assets);
        emit RedeemReceived(pid, localChainId, msg.sender, controller, receiver, assets);
    }

    function _drainClaimable(bytes32[] storage list) internal returns (uint256 outSum, uint256 inSum) {
        bool anyPending;
        for (uint256 i = list.length; i > 0; ) {
            i--;
            SettlementApply.Req storage r = reqOf[list[i]];
            if (r.status == CLAIMABLE) {
                outSum += r.outAmt;
                inSum += r.inAmt;
                delete reqOf[list[i]];
                list[i] = list[list.length - 1]; // swap-pop
                list.pop();
            } else if (r.status == PENDING) {
                anyPending = true;
            }
        }
        if (outSum == 0 && inSum == 0) {
            if (anyPending) revert NotSettled();
            revert NothingClaimable();
        }
    }

    function cancelDeposit(address) external view onlyVault { revert CancelNotSupported(); }
    function cancelRedeem(address) external view onlyVault { revert CancelNotSupported(); }

    /// @notice Clear a request orphaned by cross-chain loss (owner). Only for requests never recorded on the hub;
    ///         any asset compensation is an off-chain operational step.
    function adminClearRequest(bytes32 requestId, address vault) external onlyOwner {
        SettlementApply.clearRequest(reqOf, _userDepReqs, _userRedReqs, vault, requestId, localChainId);
    }

    /// @notice Sweep carrier dust (owner): minimum transfer amounts that rode on message-only tags, outside the
    ///         ledger. Pool-owned funds stay untouchable, so the cap is balance − Σ poolCash over the products
    ///         named by the caller; the set of products is not enumerable on chain, so omitting one would sweep
    ///         its principal, and passing them explicitly makes that the caller's stated intent.
    function sweepDust(address to, uint256 amount, uint64[] calldata products) external onlyOwner {
        uint256 booked;
        for (uint256 i = 0; i < products.length; i++) booked += _p[products[i]].poolCash;
        uint256 bal = asset.balanceOf(address(this));
        uint256 dust = bal > booked ? bal - booked : 0;
        if (amount > dust) revert SweepExceedsDust();
        asset.safeTransfer(to, amount);
        emit DustSwept(to, amount);
    }

    // ──────────────────────────────────────────────────────────────
    // Views (ERC-7540) — keyed by vault, which identifies (product, tranche)
    // ──────────────────────────────────────────────────────────────

    function pendingDepositRequest(address vault, address c) external view returns (uint256) {
        return _sumByStatus(_userDepReqs[vault][c], PENDING, false);
    }
    function claimableDepositShares(address vault, address c) external view returns (uint256) {
        return _sumByStatus(_userDepReqs[vault][c], CLAIMABLE, true);
    }
    function claimableDepositAssets(address vault, address c) external view returns (uint256) {
        return _sumByStatus(_userDepReqs[vault][c], CLAIMABLE, false);
    }
    function pendingRedeemRequest(address vault, address c) external view returns (uint256) {
        return _sumByStatus(_userRedReqs[vault][c], PENDING, false);
    }
    function claimableRedeemAssets(address vault, address c) external view returns (uint256) {
        return _sumByStatus(_userRedReqs[vault][c], CLAIMABLE, true);
    }
    function claimableRedeemShares(address vault, address c) external view returns (uint256) {
        return _sumByStatus(_userRedReqs[vault][c], CLAIMABLE, false);
    }
    /// @notice Open request ids for a user (kind = pallet order_type: 1 = deposit, 0 = redeem).
    function userRequests(address vault, address c, uint8 kind) external view returns (bytes32[] memory) {
        return kind == 1 ? _userDepReqs[vault][c] : _userRedReqs[vault][c];
    }
    function _sumByStatus(bytes32[] storage list, uint8 status_, bool outAmt_) internal view returns (uint256 sum) {
        for (uint256 i = 0; i < list.length; i++) {
            SettlementApply.Req storage r = reqOf[list[i]];
            if (r.status == status_) sum += outAmt_ ? r.outAmt : r.inAmt;
        }
    }

    function vaultFor(address share_, address asset_) external view returns (address) {
        return asset_ == address(asset) ? vaultOfShare[share_] : address(0);
    }

    /// @notice Backs RequestVault.totalAssets/convertTo*: local share supply × last settlement price.
    ///         0 before the first settlement.
    function trancheAssets(address vault) external view returns (uint256) {
        return TrancheBalances.trancheAssets(vault, _p[productOfVault[vault]].lastSharePrice[_trancheOf[vault]]);
    }

    // ── product views ──
    function productOf(uint64 productId)
        external
        view
        returns (bool registered, bool productPaused, uint8 trancheCount, address allocator, uint256 minRequest)
    {
        Product storage p = _p[productId];
        return (p.registered, p.paused, p.trancheCount, address(p.allocator), p.minRequest);
    }
    function vaultOf(uint64 productId, uint8 tranche) external view returns (address) { return _p[productId].vaultOf[tranche]; }
    function lastSharePrice(uint64 productId, uint8 tranche) external view returns (uint256) { return _p[productId].lastSharePrice[tranche]; }
    function poolCash(uint64 productId) external view returns (uint256) { return _p[productId].poolCash; }
    function payoutReserve(uint64 productId) external view returns (uint256) { return _p[productId].payoutReserve; }
    function owedAssets(uint64 productId) external view returns (uint256) { return _p[productId].owedAssets; }
    function supplyRecvCum(uint64 productId) external view returns (uint256) { return _p[productId].supplyRecvCum; }
    function payoutOutbound(uint64 productId) external view returns (uint256) { return _p[productId].payoutOutbound; }
    function cashOf(uint64 productId)
        external
        view
        returns (uint256 poolCash, uint256 payoutReserve, uint256 owedAssets, uint256 payoutOutbound, uint256 supplyRecvCum)
    {
        Product storage p = _p[productId];
        return (p.poolCash, p.payoutReserve, p.owedAssets, p.payoutOutbound, p.supplyRecvCum);
    }
    function trancheOf(address vault) external view returns (uint8) { return _trancheOf[vault]; }
}
