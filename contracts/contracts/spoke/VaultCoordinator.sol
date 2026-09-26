// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IRequestVault } from "../interfaces/IRequestVault.sol";
import { IRestrictedShare } from "../interfaces/IRestrictedShare.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { BridgeClient } from "../bridge/BridgeClient.sol";
import { WireCodec } from "../bridge/WireCodec.sol";
import { CapitalAllocator } from "./CapitalAllocator.sol";
import { TrancheBalances } from "../libraries/TrancheBalances.sol";
import { SettlementApply } from "../libraries/SettlementApply.sol";

interface IHubPayoutSink { function receivePayoutLocal(uint64 productId, uint256 amount) external; } // hub-local payout collection (same-chain counterpart of the NAV response shipment)
interface IWhitelistWriter { function applyWhitelist(address vault, address who, bool grant) external; } // per-vault registry (AllowlistHook)

/// @title  VaultCoordinator — spoke-side request ledger, settlement applier and bridge message handler.
/// @notice Holds escrow and the per-request state machine for every tranche vault on this chain and implements
///         the bridge receiver directly.
///         - requestDeposit: escrow → send the full amount to the hub with DEPOSIT_REQ
///         - requestRedeem:  escrow shares → start local pre-release at the last known price → send REDEEM_REQ
///         - SETTLEMENT_FINALIZE: deposits become claimable shares, redemptions become claimable assets
///         Multiple open requests per user are allowed (ledger keyed by requestId). Cancel is not supported cross-chain.
contract VaultCoordinator is Initializable, BridgeClient {
    using SafeERC20 for IERC20;

    uint8 private constant PENDING = 1; // status 0 = empty slot
    uint8 private constant CLAIMABLE = 2;

    address public owner;
    bool public paused;
    IERC20 public asset;
    uint8 public trancheCount;

    // ── cross-chain wiring ── (hook, bridge asset and localChainId live in BridgeClient)
    uint64 public hubChainId;
    address public hubOrchestrator;       // hub receiver (HubRouter); the only authenticated sender
    CapitalAllocator public mcAdapter;
    mapping(address vault => address) public whitelistHookOf; // per-vault allowlist hook

    uint64 private _reqSeq;               // requestId = productId(64) | chainId(64) | seq(128), globally unique

    mapping(uint8 tranche => address vault) public vaultOf;
    mapping(address vault => uint8 tranche) private _trancheOf;
    mapping(address vault => bool) public isVault;
    mapping(address share => address vault) public vaultOfShare;

    // Per-request ledger: a user may add requests before claiming earlier ones, and each request may settle at a
    // different price when it rolls over, so requests are stored individually rather than aggregated.
    // kind matches the pallet order_type: 1 = deposit, 0 = redeem (existence is tracked by status).
    // The struct lives in SettlementApply so the library can take the storage mapping directly (bytecode headroom).
    mapping(bytes32 requestId => SettlementApply.Req) public reqOf;
    mapping(uint8 tranche => mapping(address controller => bytes32[])) private _userDepReqs; // for view sums and claim iteration
    mapping(uint8 tranche => mapping(address controller => bytes32[])) private _userRedReqs;

    uint256 internal constant WAD = 1e18;

    // ── wiring (addresses, product) ──
    address public feeSponsorHook; // fee sponsor pool covering receive shortfalls (BridgeClient._feeSponsor)
    uint64 public productId;       // product id (uint32 prefix | uint32 seq); top 64 bits of requestId. Shares a slot with feeSponsorHook

    // ── cash ledger ──
    // poolCash tracks pool-owned cash additively. A "balance − reserved" subtraction clamped under sponsor drift
    // and hid the payout reserve from NAV, so only redemption releases, payout receipts and payout spend are counted.
    uint256 public poolCash;
    uint256 public payoutReserve;   // reserved for user payouts (subset of poolCash)
    uint256 public owedAssets;      // finalized but unclaimed redemptions; subtracted from the reported chain NAV
    uint256 public payoutOutbound;  // realized redemption releases waiting to ship with the next NAV response
    uint256 public supplyRecvCum;   // cumulative deposit allocations received; hub computes in-transit = sent − this

    // ── caches and guards ──
    mapping(uint8 tranche => uint256) public lastSharePrice; // cached settlement prices; used to size redemption pre-release
    mapping(uint256 => bool) internal payoutCreditedAt;      // one payout credit per settlementId (chunked or redelivered messages)
    // Whitelist ordering: latest nonce per target. The hub issues one counter per chain, but grant/revoke is per
    // target state, so comparison must also be per target (a chain-wide compare lets users' updates evict each other).
    mapping(address vault => mapping(address who => uint256)) public whitelistNonceOf;

    // Minimum request size shared by deposits (assets) and redemptions (shares). Keeps every bridge leg above
    // maxTxFee: deposits are split by allocation weight and re-sent to spokes, and redemption payouts ship
    // ≈ shares × price after settlement. One value serves both because these products are 6-decimal with
    // price ≈ 1.0; two variables would exceed the bytecode limit. 0 disables the check.
    // Distinct from BridgeClient.minAmountOf (carrier minimum for asset-less tags), hence the different name.
    // Operators must keep the smallest allocation slice above maxTxFee.
    uint256 public minRequest;

    event VaultSet(uint8 indexed tranche, address vault, address share);
    // Request lifecycle events lead with an indexed requestId so they join with hub Queued/Approved events.
    // Tranche key = (chainId, vault), matching the pallet.
    event DepositRequested(bytes32 indexed requestId, uint64 chainId, address indexed vault, address indexed controller, uint256 assets, uint256 localSupplied, uint256 remainderSent);
    event RedeemRequested(bytes32 indexed requestId, uint64 chainId, address indexed vault, address indexed controller, uint256 shares, uint256 localInitiated);
    event SettleApplied(uint256 indexed settlementId, uint256 depositCount, uint256 redeemCount);
    // Same parameters as the hub's WhitelistRequested so both ends join directly.
    event WhitelistApplied(uint64 chainId, address indexed vault, address indexed who, bool grant, uint256 nonce);
    event WhitelistStale(uint64 chainId, address indexed vault, address indexed who, uint256 nonce, uint256 latest); // out-of-order delivery dropped
    event DepositReceived(uint64 indexed productId, uint64 chainId, address indexed vault, address indexed controller, address receiver, uint256 shares);
    event RedeemReceived(uint64 indexed productId, uint64 chainId, address indexed vault, address indexed controller, address receiver, uint256 assets);
    // Action events for indexing; wire-level tracing is covered by BridgeClient events.
    event SupplyReceived(bytes32 indexed requestId, uint256 amount);
    event DustAccrued(uint8 tag, uint256 amount);
    event NavReported(uint256 indexed settlementId, uint256 chainNav);
    event PausedSet(bool paused);
    event WhitelistHookSet(address indexed vault, address hook);
    event FeeSponsorHookSet(address hook);
    event ProductIdSet(uint64 productId);
    event OwnershipTransferred(address newOwner);

    error NotOwner();
    error NotVault();
    error NotHub();
    error EnforcedPause();
    error NothingClaimable();
    error NotSettled();
    error AssetMismatch();
    error CancelNotSupported();
    error SweepExceedsDust();
    error UnknownTag(uint8 tag);
    error WrongProduct();
    error BadTranche();
    error BelowMinRequest(); // deposit assets or redeem shares below minRequest

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }
    modifier onlyVault() { if (!isVault[msg.sender]) revert NotVault(); _; }
    modifier whenNotPaused() { if (paused) revert EnforcedPause(); _; }

    constructor() { _disableInitializers(); } // implementation is only used behind UpgradeableProxy

    function initialize(
        address asset_,
        uint8 trancheCount_,
        address hook_,
        uint64 localChainId_,
        uint64 hubChainId_,
        address hubOrchestrator_,
        address mcAdapter_
    ) external initializer {
        owner = msg.sender;
        asset = IERC20(asset_);
        trancheCount = trancheCount_;
        _initBridge(hook_, asset_, localChainId_);
        hubChainId = hubChainId_;
        hubOrchestrator = hubOrchestrator_;
        mcAdapter = CapitalAllocator(mcAdapter_);
    }

    // ──────────────────────────────────────────────────────────────
    // Admin
    // ──────────────────────────────────────────────────────────────

    /// @notice Minimum deposit/redeem request size (0 = no limit).
    function setMinRequest(uint256 amount) external onlyOwner { minRequest = amount; }

    function setVault(uint8 tranche, address vault) external onlyOwner {
        if (tranche >= trancheCount) revert BadTranche();
        if (IRequestVault(vault).asset() != address(asset)) revert AssetMismatch();
        if (IRequestVault(vault).tranche() != tranche) revert BadTranche();
        address sh = IRequestVault(vault).share();
        address old = vaultOf[tranche];
        if (old != address(0)) {
            isVault[old] = false;
            address oldShare = IRequestVault(old).share();
            if (oldShare != sh) {
                delete vaultOfShare[oldShare];
                IRestrictedShare(oldShare).notifyVaultUpdate(address(asset), address(0));
            }
        }
        vaultOf[tranche] = vault;
        _trancheOf[vault] = tranche;
        isVault[vault] = true;
        vaultOfShare[sh] = vault;
        IRestrictedShare(sh).notifyVaultUpdate(address(asset), vault);
        emit VaultSet(tranche, vault, sh);
    }

    function setPaused(bool p) external onlyOwner { paused = p; emit PausedSet(p); }
    function setWhitelistHook(address vault, address h) external onlyOwner { whitelistHookOf[vault] = h; emit WhitelistHookSet(vault, h); }

    event TrancheCountSet(uint8 count);
    /// @notice Raise the tranche count before wiring a new vault with setVault. Lowering is refused (would orphan vaults).
    function setTrancheCount(uint8 n) external onlyOwner {
        if (n < trancheCount) revert BadTranche();
        trancheCount = n;
        emit TrancheCountSet(n);
    }
    function setFeeSponsorHook(address h) external onlyOwner { feeSponsorHook = h; emit FeeSponsorHookSet(h); }
    function setProductId(uint64 pid) external onlyOwner { productId = pid; emit ProductIdSet(pid); }
    function _feeSponsor() internal view override returns (address) { return feeSponsorHook; }

    function transferOwnership(address o) external onlyOwner { owner = o; emit OwnershipTransferred(o); }

    // ──────────────────────────────────────────────────────────────
    // Vault → coordinator: requests (vault has already transferred assets/shares here)
    // ──────────────────────────────────────────────────────────────

    function requestDeposit(address controller, address /*owner*/, uint256 assets)
        external onlyVault nonReentrant whenNotPaused
    {
        if (assets < minRequest) revert BelowMinRequest();
        uint8 t = _trancheOf[msg.sender];
        bytes32 requestId = _newRequestId();
        reqOf[requestId] = SettlementApply.Req(PENDING, 1, t, controller, assets, 0);
        _userDepReqs[t][controller].push(requestId);

        (uint256 localSupplied, uint256 remainder) = _dispatchDeposit(requestId, t, assets, controller);
        emit DepositRequested(requestId, localChainId, vaultOf[t], controller, assets, localSupplied, remainder);
    }

    /// @dev Sends the full deposit to the hub. No local supply at request time: the spoke cannot tell whether the hub
    ///      is mid-collection, and unconfirmed deposit funds mixed into spoke NAV would inflate that round's price.
    ///      The hub allocates on approval instead. localSupplied is always 0 (event field kept).
    function _dispatchDeposit(bytes32 requestId, uint8 t, uint256 assets, address controller)
        internal returns (uint256 localSupplied, uint256 remainder)
    {
        remainder = assets;
        _sendDepositReq(requestId, t, assets, controller, remainder); // separate frame to avoid stack-too-deep
    }

    function _sendDepositReq(bytes32 requestId, uint8 t, uint256 assets, address controller, uint256 remainder) internal {
        uint256 wv = mcAdapter.weightsVersion(); // separate local to keep the stack shallow
        bytes memory m = WireCodec.encodeDepositReq(productId, requestId, assets, wv, controller, vaultOf[t]);
        _send(productId, hubChainId, hubOrchestrator, remainder, m);
    }

    function requestRedeem(address controller, address /*owner*/, uint256 shares)
        external onlyVault nonReentrant whenNotPaused
    {
        if (shares < minRequest) revert BelowMinRequest();
        uint8 t = _trancheOf[msg.sender];
        bytes32 requestId = _newRequestId();
        reqOf[requestId] = SettlementApply.Req(PENDING, 0, t, controller, shares, 0); // kind 0 = redeem; inAmt = escrowed shares to burn later
        _userRedReqs[t][controller].push(requestId);

        // Pre-release on the requesting chain: start releasing the local share of the expected payout at the last known price.
        uint256 localInitiated;
        if (lastSharePrice[t] != 0 && mcAdapter.localShareBps() > 0) { // local share 0 → nothing to pre-release (hub coordinator)
            uint256 realizedNow;
            (localInitiated, realizedNow) = mcAdapter.withdrawLocalShare(shares * lastSharePrice[t] / WAD, requestId);
            poolCash += realizedNow;       // only realized funds; ASYNC releases are counted when collected
            payoutOutbound += realizedNow; // ships with the next NAV response
        }
        _send(
            productId,
            hubChainId,
            hubOrchestrator,
            0,
            WireCodec.encodeRedeemReq(productId, requestId, shares, controller, localInitiated, vaultOf[t])
        );
        emit RedeemRequested(requestId, localChainId, vaultOf[t], controller, shares, localInitiated);
    }

    /// @dev Ship SYNC rebalance releases to the hub via NET_BRIDGE.
    function _bridgeRebalance(uint256 amount) internal {
        if (amount == 0) return;
        _send(productId, hubChainId, hubOrchestrator, amount, WireCodec.encodeNetBridge(productId, 0));
    }

    /// @notice Collect ready ASYNC redemption tickets into the outbound payout queue (keeper call; ships with the next NAV response).
    event PayoutRealized(uint256 realized);
    function drainPayoutAsync() external nonReentrant { _drainPayout(); }

    function _drainPayout() internal {
        uint256 realized = mcAdapter.receiveReady(CapitalAllocator(mcAdapter).TICKET_PAYOUT());
        if (realized > 0) {
            poolCash += realized;
            payoutOutbound += realized;
            emit PayoutRealized(realized);
        }
    }

    /// @notice Collect ready ASYNC rebalance tickets and ship them via NET_BRIDGE (keeper call).
    function drainRebalanceAsync() external nonReentrant {
        uint256 realized = mcAdapter.receiveReady(CapitalAllocator(mcAdapter).TICKET_REBALANCE());
        _bridgeRebalance(realized);
    }


    /// @dev requestId = bytes32(productId << 192 | chainId << 128 | seq); the pallet consumes it as bytes32.
    function _newRequestId() internal returns (bytes32) {
        return bytes32((uint256(productId) << 192) | (uint256(localChainId) << 128) | uint256(++_reqSeq));
    }

    // ──────────────────────────────────────────────────────────────
    // Bridge receive (only the hub router is accepted as sender)
    // ──────────────────────────────────────────────────────────────

    function _handleMessage(uint64 sourceChain, address sender, address, uint256 amount, bytes memory message)
        internal override
    {
        if (sourceChain != hubChainId || sender != hubOrchestrator) revert NotHub();

        WireCodec.Envelope memory p = WireCodec.decode(message);
        uint8 tag = p.kind;
        // productId check on every message, on top of sender authentication.
        if (p.productId != productId) revert WrongProduct();
        // Assets riding on message-only tags are carrier dust; they are not in poolCash-based NAV, so only observe them.
        if (tag != WireCodec.ADAPTER_SUPPLY && tag != WireCodec.SETTLEMENT_FINALIZE && amount > 0) emit DustAccrued(tag, amount);
        if (tag == WireCodec.ADAPTER_SUPPLY) {
            asset.forceApprove(address(mcAdapter), amount); // SUPPLY has a single purpose: allocate
            mcAdapter.supplyAll(amount, p.requestId);
            supplyRecvCum += amount; // received cumulative; hub compares against its sent cumulative for in-transit funds
            emit SupplyReceived(p.requestId, amount);
        } else if (tag == WireCodec.SETTLEMENT_FINALIZE) {
            // Payout allocation arrives with the finalize message (declared p.amount; excess is carrier dust).
            // Credited once per settlementId so redelivery cannot double-count.
            if (p.amount > 0 && !payoutCreditedAt[p.settlementId]) {
                payoutCreditedAt[p.settlementId] = true;
                payoutReserve += p.amount;
                poolCash += p.amount;
            }
            if (amount > p.amount) emit DustAccrued(tag, amount - p.amount);
            _applySettle(p);
        } else if (tag == WireCodec.SETTLEMENT_COLLECT) {
            for (uint256 i = 0; i < p.nums.length && i < 255; i++) lastSharePrice[uint8(i)] = p.nums[i]; // refresh the cache so pre-release uses current prices
            // A hub-chain coordinator sends no NAV response: the hub's own NAV is already in the ledger snapshot
            // (double counting), and a synchronous response would re-enter the collecting ledger. It only hands over
            // realized redemption releases directly, which is what a spoke ships with its response.
            if (localChainId == hubChainId) {
                _drainPayout();
                uint256 shipLocal = payoutOutbound > poolCash ? poolCash : payoutOutbound;
                if (shipLocal > 0) {
                    payoutOutbound = 0;
                    poolCash -= shipLocal;
                    asset.forceApprove(hubOrchestrator, shipLocal);
                    IHubPayoutSink(hubOrchestrator).receivePayoutLocal(productId, shipLocal);
                }
                return;
            }
            mcAdapter.pokeAdapters(); // let inner sources rebalance right before NAV is read
            WireCodec.AdapterValuation[] memory vals = mcAdapter.adapterValuations();
            // Chain NAV = source valuations + pool-owned cash (poolCash: pre-released + awaiting payout) − finalized unpaid liabilities.
            _drainPayout(); // collect ready ASYNC redemption tickets so as much as possible ships with this response
            // Realized redemption releases ship with this message to the hub; shipped funds leave poolCash and NAV.
            uint256 ship = payoutOutbound > poolCash ? poolCash : payoutOutbound;
            payoutOutbound = 0;
            poolCash -= ship;
            uint256 nav = mcAdapter.chainNav() + poolCash;
            nav = nav > owedAssets ? nav - owedAssets : 0;
            _send(productId, hubChainId, hubOrchestrator, ship, WireCodec.encodeNavResponse(productId, p.settlementId, nav, ship, supplyRecvCum, vals));
            emit NavReported(p.settlementId, nav);
        } else if (tag == WireCodec.ALLOCATION_SYNC) {
            (uint256 wv, uint16 lsb) = WireCodec.unpackAllocation(p.aux);
            uint16[] memory wbps = new uint16[](p.nums.length);
            for (uint256 i = 0; i < p.nums.length; i++) wbps[i] = uint16(p.nums[i]);
            mcAdapter.syncAllocation(wv, lsb, p.addrs, wbps);
        } else if (tag == WireCodec.ADAPTER_WITHDRAW) {
            if (p.flag == WireCodec.WITHDRAW_PAYOUT) {
                // Payout sourcing: same computation the requesting chain does in requestRedeem, run on this chain.
                // Realized funds are not bridged immediately; they ship with the next NAV response.
                (, uint256 realized) = mcAdapter.withdrawLocalShare(p.amount, p.requestId);
                poolCash += realized;
                payoutOutbound += realized;
            } else {
                uint256 realized = mcAdapter.withdrawFor(p.addrs, p.nums, p.requestId, CapitalAllocator(mcAdapter).TICKET_REBALANCE()); // SYNC now, ASYNC as tickets
                _bridgeRebalance(realized); // SYNC portion ships now; ASYNC tickets follow via drainRebalanceAsync
            }
        } else if (tag == WireCodec.WHITELIST_SYNC) {
            address h = whitelistHookOf[p.vault];
            // Drop out-of-order delivery: ignore if a newer instruction was already applied (bridge does not guarantee ordering).
            if (p.aux <= whitelistNonceOf[p.vault][p.account]) {
                emit WhitelistStale(localChainId, p.vault, p.account, p.aux, whitelistNonceOf[p.vault][p.account]);
            } else if (h != address(0)) {
                whitelistNonceOf[p.vault][p.account] = p.aux;
                IWhitelistWriter(h).applyWhitelist(p.vault, p.account, p.flag == WireCodec.ACTION_GRANT);
                emit WhitelistApplied(localChainId, p.vault, p.account, p.flag == WireCodec.ACTION_GRANT, p.aux);
            }
        } else {
            revert UnknownTag(tag);
        }
    }

    /// @dev Settlement application lives in SettlementApply (bytecode headroom); it also emits SettleApplied.
    function _applySettle(WireCodec.Envelope memory p) internal {
        owedAssets += SettlementApply.applySettle(reqOf, lastSharePrice, p);
    }

    // ──────────────────────────────────────────────────────────────
    // Claim
    // ──────────────────────────────────────────────────────────────

    /// @dev Claims every CLAIMABLE request in one go (per-request prices are already reflected in outAmt).
    ///      Reverts NotSettled if only PENDING requests exist. Swap-pop removes claimed entries; PENDING ones stay.
    function claimDeposit(address controller, address receiver) external onlyVault nonReentrant whenNotPaused returns (uint256 shares) {
        uint8 t = _trancheOf[msg.sender];
        (shares, ) = _drainClaimable(_userDepReqs[t][controller]);
        IRestrictedShare(IRequestVault(vaultOf[t]).share()).mint(receiver, shares);
        emit DepositReceived(productId, localChainId, vaultOf[t], controller, receiver, shares);
    }

    function claimRedeem(address controller, address receiver) external onlyVault nonReentrant whenNotPaused returns (uint256 assets) {
        uint8 t = _trancheOf[msg.sender];
        uint256 escrowShares;
        (assets, escrowShares) = _drainClaimable(_userRedReqs[t][controller]);
        owedAssets = owedAssets > assets ? owedAssets - assets : 0;
        IRestrictedShare(IRequestVault(vaultOf[t]).share()).burn(address(this), escrowShares);
        if (assets <= payoutReserve) payoutReserve -= assets; else payoutReserve = 0;
        poolCash = assets <= poolCash ? poolCash - assets : 0;
        asset.safeTransfer(receiver, assets);
        emit RedeemReceived(productId, localChainId, vaultOf[t], controller, receiver, assets);
    }

    /// @dev Removes every CLAIMABLE entry from the list and returns (Σ outAmt, Σ inAmt). Reverts by state if none.
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
    event RequestCleared(bytes32 indexed requestId, uint64 chainId, address indexed vault, address indexed controller, uint8 kind, uint256 amount);
    /// @dev Logic lives in SettlementApply (bytecode headroom); it also emits RequestCleared.
    function adminClearRequest(bytes32 requestId) external onlyOwner {
        SettlementApply.clearRequest(reqOf, _userDepReqs, _userRedReqs, vaultOf, requestId, localChainId);
    }

    /// @notice Sweep carrier dust (owner): minimum transfer amounts that rode on message-only tags, outside the ledger.
    ///         Pool-owned funds are untouchable: cap = balance − poolCash (payoutReserve is part of poolCash).
    event DustSwept(address indexed to, uint256 amount);
    function sweepDust(address to, uint256 amount) external onlyOwner {
        uint256 dust = asset.balanceOf(address(this)) - poolCash;
        if (amount > dust) revert SweepExceedsDust();
        asset.safeTransfer(to, amount);
        emit DustSwept(to, amount);
    }

    // ──────────────────────────────────────────────────────────────
    // Views (ERC-7540)
    // ──────────────────────────────────────────────────────────────

    // Sums over the user's request list; signatures unchanged from the single-slot design.
    function pendingDepositRequest(uint8 t, address c) external view returns (uint256) {
        return _sumByStatus(_userDepReqs[t][c], PENDING, false);
    }
    function claimableDepositShares(uint8 t, address c) external view returns (uint256) {
        return _sumByStatus(_userDepReqs[t][c], CLAIMABLE, true);
    }
    function claimableDepositAssets(uint8 t, address c) external view returns (uint256) {
        return _sumByStatus(_userDepReqs[t][c], CLAIMABLE, false);
    }
    function pendingRedeemRequest(uint8 t, address c) external view returns (uint256) {
        return _sumByStatus(_userRedReqs[t][c], PENDING, false);
    }
    function claimableRedeemAssets(uint8 t, address c) external view returns (uint256) {
        return _sumByStatus(_userRedReqs[t][c], CLAIMABLE, true);
    }
    function claimableRedeemShares(uint8 t, address c) external view returns (uint256) {
        return _sumByStatus(_userRedReqs[t][c], CLAIMABLE, false);
    }
    /// @notice Open request ids for a user (kind = pallet order_type: 1 = deposit, 0 = redeem).
    function userRequests(uint8 t, address c, uint8 kind) external view returns (bytes32[] memory) {
        return kind == 1 ? _userDepReqs[t][c] : _userRedReqs[t][c];
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

    /// @notice Backs RequestVault.totalAssets/convertTo* via IVaultCoordinator: local share supply × last settlement
    ///         price. 0 before the first settlement.
    function trancheAssets(uint8 t) external view returns (uint256) {
        return TrancheBalances.trancheAssets(vaultOf[t], lastSharePrice[t]);
    }
}
