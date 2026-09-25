// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { BridgeClient } from "../bridge/BridgeClient.sol";
import { WireCodec } from "../bridge/WireCodec.sol";
import { CapitalAllocator } from "../spoke/CapitalAllocator.sol";
import { IProductRegistry } from "../interfaces/IProductRegistry.sol";
import { AllocatorRegistry } from "../libraries/AllocatorRegistry.sol";
import { IYieldSource } from "../interfaces/IYieldSource.sol";

interface IHubLedger {
    function creditPayout(uint256 amount) external;
    function onDepositReq(uint64 srcChain, uint256 attachedAmount, bytes calldata message) external;
    function onRedeemReq(uint64 srcChain, bytes calldata message) external;
    function onNavResponse(uint64 srcChain, uint256 attachedAmount, bytes calldata message) external;
    function onNetBridge(uint64 srcChain, uint256 amount) external;
}

/// @title  HubRouter — the hub's single bridge endpoint, shared by every product
/// @notice Routes inbound messages to the product's HubLedger by productId (the second payload field of
///         every tag) and sends/executes on the ledgers' behalf. Outbound calls are authenticated by looking
///         the caller up as the product's registered ledger in the pallet. It never writes pallet records
///         itself — the investments precompile authenticates the per-product ledger address.
contract HubRouter is Initializable, BridgeClient {
    using SafeERC20 for IERC20;

    address public owner;
    IERC20 public asset;
    address public permissions; // permissions precompile — may send WHITELIST
    address public feeSponsorHook; // fee sponsor pool covering inbound shortfalls (BridgeClient._feeSponsor)

    // Product → ledger, hub allocator and yield sources come from the pallet (get_product / get_multichain_adapters).
    IProductRegistry public trancheSystem; // 0x…0200
    // WHITELIST ordering: monotonic counter per (product, destination chain); the receiver compares per (vault, who).
    mapping(uint64 productId => mapping(uint64 chainId => uint256)) public whitelistNonce;

    // Per-product custody ledger. Several products share this one address, so without a ledger one
    // product's payout could silently borrow another product's funds. Credit on arrival, debit on exit,
    // revert on shortfall — an explicit failure beats a silent subsidy.
    // Carrier amounts are excluded: they are operating funds riding message-only tags, not product assets,
    // and booking them would block a zero-balance product's first COLLECT.
    mapping(uint64 productId => uint256) public productBalance;
    uint256 public productBalanceTotal; // Σ productBalance — sweep cap is (actual balance − this)

    // Wire-level send/receive events are emitted by BridgeClient (MessageSent / MessageReceived).
    event PermissionsSet(address permissions);
    event FeeSponsorHookSet(address hook);
    event Swept(address indexed to, uint256 amount);
    /// @dev Per-product custody change — makes cross-product commingling observable. delta is signed.
    event ProductBalanceChanged(uint64 indexed productId, int256 delta, uint256 balance);
    /// @dev Whitelist propagation sent — same parameters as the spoke's WhitelistApplied so both ends can be
    ///      matched directly. The nonce also rides in the payload aux, but observing the send without
    ///      decoding the blob needs its own event.
    event WhitelistRequested(uint64 chainId, address indexed vault, address indexed who, bool grant, uint256 nonce);

    error NotOwner();
    error NotRegisteredSpoke();
    error NotValuation();
    error UnknownTag(uint8 tag);
    error InsufficientProductBalance(uint64 productId, uint256 have, uint256 want);
    error SweepExceedsFree();

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }

    constructor() { _disableInitializers(); } // implementation is only used behind UpgradeableProxy

    function initialize(address asset_, address hook_, address trancheSystem_, uint64 localChainId_) external initializer {
        owner = msg.sender;
        asset = IERC20(asset_);
        trancheSystem = IProductRegistry(trancheSystem_);
        _initBridge(hook_, asset_, localChainId_);
    }

    // ── Pallet-derived views (static product data — nothing stored) ──
    /// @notice Coordinator registered for (product, chain) in the pallet, or zero — the ledger uses it to check a delivery target exists.
    function managerOf(uint64 pid, uint64 chainId) external view returns (address) { return _spokeManagerOf(pid, chainId); }

    /// @dev Spoke coordinator per the pallet. Zero if unregistered — callers reject.
    function _spokeManagerOf(uint64 pid, uint64 chainId) internal view returns (address) {
        IProductRegistry.MultichainTrancheManagerInput[] memory ms = trancheSystem.get_multichain_tranche_managers(pid);
        for (uint256 i = 0; i < ms.length; i++) if (ms[i].chain_id == chainId) return ms[i].tranche_manager_address;
        return address(0);
    }

    function _valuationOf(uint64 pid) internal view returns (address v) {
        (, v, , , ) = trancheSystem.get_product(pid); // the precompile reverts for unknown products
    }
    function _hubAdapterAddr(uint64 pid) internal view returns (address) {
        address a = AllocatorRegistry.adapterOfChain(address(trancheSystem), pid, localChainId);
        if (a == address(0)) revert NotValuation(); // product has no hub allocator registered
        return a;
    }
    function _hubFirstSource(uint64 pid) internal view returns (address) {
        return AllocatorRegistry.firstSourceOfChain(address(trancheSystem), pid, localChainId);
    }

    function setPermissions(address p) external onlyOwner { permissions = p; emit PermissionsSet(p); }
    /// @notice Recover assets gathered here outside a rebalance (admin). onNetBridge only holds them when rebalanceTo == 0.
    ///         Cap = actual balance − total product custody, i.e. only funds outside the ledger (carrier remainders etc.).
    function sweep(address to, uint256 amount) external onlyOwner {
        uint256 bal = asset.balanceOf(address(this));
        uint256 free = bal > productBalanceTotal ? bal - productBalanceTotal : 0;
        if (amount > free) revert SweepExceedsFree();
        asset.safeTransfer(to, amount);
        emit Swept(to, amount);
    }
    function setFeeSponsorHook(address h) external onlyOwner { feeSponsorHook = h; emit FeeSponsorHookSet(h); }
    function _feeSponsor() internal view override returns (address) { return feeSponsorHook; }

    // ── Per-product custody ledger ──
    function _credit(uint64 pid, uint256 amount) internal {
        if (amount == 0) return;
        uint256 b = productBalance[pid] + amount;
        productBalance[pid] = b;
        productBalanceTotal += amount;
        emit ProductBalanceChanged(pid, int256(amount), b);
    }
    function _debit(uint64 pid, uint256 amount) internal {
        if (amount == 0) return;
        uint256 b = productBalance[pid];
        if (b < amount) revert InsufficientProductBalance(pid, b, amount);
        unchecked { b -= amount; }
        productBalance[pid] = b;
        productBalanceTotal -= amount;
        emit ProductBalanceChanged(pid, -int256(amount), b);
    }
    /// @notice Attribute pre-existing custody to a product (owner, once after enabling the ledger).
    ///         With the ledger at zero, allocation and payout of funds already held would all fail on shortfall.
    function seedProductBalance(uint64 pid, uint256 amount) external onlyOwner { _credit(pid, amount); }
    /// @notice Correct the ledger downward (owner) — no funds move; inverse of seedProductBalance. Same guard
    ///         as _debit, so it reverts when removing more than is booked. Used to undo phantom credits.
    function correctProductBalance(uint64 pid, uint256 amount) external onlyOwner { _debit(pid, amount); }

    // ── Inbound: route by productId ──

    function _handleMessage(uint64 sourceChain, address sender, address, uint256 amount, bytes memory message) internal override {
        WireCodec.Envelope memory p = WireCodec.decode(message);
        uint8 tag = p.kind;
        uint64 pid = p.productId;
        if (pid == 0) revert UnknownTag(tag);
        // Authentication is routing: accept only from the registered coordinator of the claimed product — blocks cross-product spoofing.
        if (sender != _spokeManagerOf(pid, sourceChain) || sender == address(0)) revert NotRegisteredSpoke();
        IHubLedger v = IHubLedger(_valuationOf(pid)); // pallet is the source of truth — create_product registers it

        if (tag == WireCodec.DEPOSIT_REQUEST) {
            _credit(pid, amount); // attached assets are held here until the allocation instruction
            v.onDepositReq(sourceChain, amount, message);
        } else if (tag == WireCodec.REDEEM_REQUEST) {
            v.onRedeemReq(sourceChain, message); // asset-less tag — whatever arrived is the carrier minimum, not booked
        } else if (tag == WireCodec.SETTLEMENT_RESPONSE) {
            // Book the funded amount from the payload (p.aux), not the transport amount. _send promotes
            // ship == 0 to the carrier minimum and that value also lands in declared, so a "nothing to fund
            // this round" response still physically delivers the minimum. onNavResponse reads only pl.aux and
            // ignores it; booking `amount` here would accumulate phantom credits every round.
            _credit(pid, p.aux); // realized redemption proceeds attached by the spoke — held here
            v.onNavResponse(sourceChain, amount, message);
        } else {
            _credit(pid, amount); // NET_BRIDGE — proceeds gathered at the hub
            v.onNetBridge(sourceChain, amount); // during a rebalance the ledger re-dispatches to the underweight chain
        }
    }

    // ── Execution and sending on behalf of a ledger (caller claims pid, verified against the pallet) ──

    modifier onlyValuation(uint64 pid) {
        if (msg.sender != _valuationOf(pid)) revert NotValuation();
        _;
    }

    /// @notice Allocate the hub share immediately — held assets go to the product's hub CapitalAllocator (pallet lookup).
    function supplyHub(uint64 pid, uint256 amount, bytes32 requestId) external onlyValuation(pid) {
        _debit(pid, amount);
        CapitalAllocator a = CapitalAllocator(_hubAdapterAddr(pid));
        asset.forceApprove(address(a), amount);
        a.supplyAll(amount, requestId);
    }

    /// @notice Send SUPPLY with attached assets to a spoke (deposit allocation).
    function sendSupply(uint64 pid, uint64 chainId, uint256 amount, bytes32 requestId) external onlyValuation(pid) {
        _debit(pid, amount);
        _send(pid, chainId, _spokeManagerOf(pid, chainId), amount, WireCodec.encodeSupply(pid, requestId));
    }

    /// @notice Send a message (COLLECT, FINALIZE, WITHDRAW, ALLOCATION …). amount > 0 attaches assets (settlement payout), 0 sends the carrier minimum.
    function sendMessage(uint64 pid, uint64 chainId, uint256 amount, bytes calldata message) external onlyValuation(pid) {
        _debit(pid, amount); // no-op at 0 — the carrier minimum promotion is outside the ledger
        _send(pid, chainId, _spokeManagerOf(pid, chainId), amount, message);
    }

    /// @notice Start releasing the hub share of a redemption. SYNC sources realize at once into this contract
    ///         (returned); ASYNC sources leave a payout ticket that sweepPayout collects later. Source = first
    ///         yield source of the pallet's hub entry.
    function initiatePayout(uint64 pid, uint256 amount) external onlyValuation(pid) returns (uint256 realizedNow) {
        if (amount == 0) return 0;
        address src = _hubFirstSource(pid);
        if (src == address(0)) return 0;
        // Cap = claim value − outstanding ticket liability, so the same funds are not booked twice.
        uint256 booked = CapitalAllocator(_hubAdapterAddr(pid)).pendingWithdrawOf(src);
        // The cap uses the source's totalAssets (claim value), not its token balance: with shared-pool sources
        // the funds sit outside the allocator, balanceOf(src) is 0 and funding would silently return 0,
        // rolling the redemption over forever.
        uint256 bal = IYieldSource(src).totalAssets();
        uint256 avail = bal > booked ? bal - booked : 0;
        uint256 take = amount < avail ? amount : avail;
        if (take == 0) return 0;
        realizedNow = _withdrawHub(pid, src, take);
        _credit(pid, realizedNow);
    }

    /// @notice Gather redemption proceeds realized by the hub coordinator into this contract (same chain, no bridge).
    /// @dev    Plays the role of a spoke's SETTLEMENT_RESPONSE attachment, but uses a direct call instead of a
    ///         message to avoid re-entering the ledger during collection. Only the registered hub coordinator may call.
    function receivePayoutLocal(uint64 pid, uint256 amount) external {
        if (msg.sender != _spokeManagerOf(pid, localChainId)) revert NotRegisteredSpoke();
        if (amount == 0) return;
        asset.safeTransferFrom(msg.sender, address(this), amount);
        _credit(pid, amount);
        IHubLedger(_valuationOf(pid)).creditPayout(amount);
    }

    /// @notice Collect ready hub ASYNC payout tickets. Realized assets land here; the ledger adds them to payoutCollected.
    function sweepPayout(uint64 pid) external onlyValuation(pid) returns (uint256 realized) {
        CapitalAllocator a = CapitalAllocator(_hubAdapterAddr(pid));
        realized = a.receiveReady(a.TICKET_PAYOUT());
        _credit(pid, realized);
    }

    function _withdrawHub(uint64 pid, address src, uint256 take) internal returns (uint256) {
        address[] memory ads = new address[](1); ads[0] = src;
        uint256[] memory amts = new uint256[](1); amts[0] = take;
        CapitalAllocator a = CapitalAllocator(_hubAdapterAddr(pid));
        // Non-fatal: the cap is based on totalAssets, which includes accrued/estimated value, so a release may
        // exceed the real balance and revert. A funding failure is absorbed by deferral; it must not kill settlement.
        try a.withdrawFor(ads, amts, bytes32(0), a.TICKET_PAYOUT()) returns (uint256 r) { return r; }
        catch { return 0; }
    }


    /// @notice Propagate a whitelist change to a spoke — permissions precompile only (it has already verified the ProductAdmin caller).
    function sendWhitelist(uint64 chainId, uint64 productId, address vaultAddress, address who, uint8 action) external {
        if (msg.sender != permissions) revert NotOwner();
        uint256 n = ++whitelistNonce[productId][chainId]; // lets the receiver drop out-of-order deliveries — the bridge does not guarantee ordering
        // Emit before sending: for a hub vault target _send applies the change (WhitelistApplied) within the same tx,
        // so the request must be logged before the application.
        emit WhitelistRequested(chainId, vaultAddress, who, action == WireCodec.ACTION_GRANT, n);
        _send(productId, chainId, _spokeManagerOf(productId, chainId), 0, WireCodec.encodeWhitelist(productId, vaultAddress, who, action, n));
    }
}
