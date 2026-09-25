// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { CapitalAllocator } from "../../spoke/CapitalAllocator.sol";
import { IProductRegistry } from "../../interfaces/IProductRegistry.sol";
import { AllocatorRegistry } from "../../libraries/AllocatorRegistry.sol";
import { LedgerStorage } from "./LedgerStorage.sol";
import { LibDiamond } from "./libraries/LibDiamond.sol";

/// @title  LedgerBase — shared base of the HubLedger facets (events, errors, modifiers, helpers)
/// @notice Every facet inherits this. All state lives in the LedgerStorage namespace (_s()); facets must
///         not declare their own storage. Events are duplicated in each facet ABI, but the log address and
///         signatures are identical from the diamond's point of view.
abstract contract LedgerBase {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant YEAR = 365 days;

    // ── Events ──
    event SettleStarted(uint256 indexed settlementId, uint256 hubNav, uint64[] collectResponseChainIds, uint64[] finalizeChainIds);
    event Settled(uint256 indexed settlementId, uint256 productNav, uint256 seniorNav, uint256 juniorNav);
    event DepositQueued(bytes32 indexed requestId, uint64 indexed srcChain, address vault, address controller, uint256 assets, uint256 settlementId, bool deferred, uint64[] adapterChainIds);
    event RedeemQueued(bytes32 indexed requestId, uint64 indexed srcChain, address vault, address controller, uint256 shares, uint256 settlementId, bool deferred, uint64[] adapterChainIds);
    event NavReceived(uint256 indexed settlementId, uint64 indexed chainId, uint256 chainNav);
    struct ApprovedItem { bytes32 requestId; uint256 inAmt; uint256 outAmt; uint256 price; }
    event DepositsApproved(uint256 indexed settlementId, ApprovedItem[] items);
    event RedeemsApproved(uint256 indexed settlementId, ApprovedItem[] items);
    event CollectAborted(uint256 indexed settlementId);
    event ProductIdSet(uint64 productId);
    event RebalanceStarted(uint64 indexed fromChain, uint64 indexed toChain, uint256 amount);
    event RebalanceCollected(uint256 amount, uint256 collectedTotal, bool completed);
    event AllocationPushed(uint64 indexed chainId, uint256 weightsVersion, uint16 localShareBps);
    event RedeemDeferred(bytes32 indexed requestId, uint256 indexed settlementId, uint256 assetsNeeded);
    event AdapterValsSkipped(uint256 settlementId);
    event TrancheSettlementSkipped(uint256 settlementId);

    error NotOwner();
    error NotOrchestrator();
    error AlreadyCollecting();
    error NotCollecting();
    error BadTranche();
    error RebalanceActive();
    error AlreadyInitialized();
    error Reentrancy();

    function _s() internal pure returns (LedgerStorage.Layout storage) { return LedgerStorage.layout(); }

    /// @dev Diamond ownership has a single source: IERC173 (OwnershipFacet / LibDiamond). LedgerStorage
    ///      holds no separate owner, which also avoids an owner() selector clash in the cut.
    modifier onlyOwner() { if (msg.sender != LibDiamond.contractOwner()) revert NotOwner(); _; }
    modifier onlyOrchestrator() { if (msg.sender != address(_s().orchestrator)) revert NotOrchestrator(); _; }
    modifier nonReentrant() {
        LedgerStorage.Layout storage s = _s();
        if (s.reentrancy == 2) revert Reentrancy();
        s.reentrancy = 2;
        _;
        s.reentrancy = 1;
    }

    // ── Views derived from the pallet (static product data — nothing stored) ──
    function _hubChainId() internal view returns (uint64) { return _s().orchestrator.localChainId(); }
    function _tranches() internal view returns (IProductRegistry.TrancheInput[] memory) { return _s().trancheSystem.get_tranches(_s().productId); }
    /// @dev Logical tranche count; parsing lives in AllocatorRegistry to save bytecode.
    function trancheCount() public view returns (uint8 n) {
        return AllocatorRegistry.trancheCountOf(address(_s().trancheSystem), _s().productId);
    }
    /// @dev Vault → logical tranche index (senior = 0). Receiving-side counterpart of the wire format, which carries no index.
    function _trancheIndexOf(address vault) internal view returns (uint8 t) {
        t = AllocatorRegistry.trancheIndexOf(address(_s().trancheSystem), _s().productId, vault);
        if (t == 255) revert BadTranche();
    }
    /// @dev (logical tranche, chain) → that chain's entry vault. Used for per-vault unit attribution.
    function _vaultOf(uint8 tranche, uint64 chainId) internal view returns (address) {
        return AllocatorRegistry.vaultOfTranche(address(_s().trancheSystem), _s().productId, tranche, chainId);
    }
    function _hubAdapter() internal view returns (CapitalAllocator) { return CapitalAllocator(_adapterOfChain(_hubChainId())); }
    // Parsing is completed inside the external AllocatorRegistry library (one delegatecall per task).
    function _adapterOfChain(uint64 chainId) internal view returns (address) {
        return AllocatorRegistry.adapterOfChain(address(_s().trancheSystem), _s().productId, chainId);
    }
    /// @dev Spokes (+weights) excluding the hub, derived from the pallet allocator registrations.
    function _spokes() internal view returns (uint64[] memory chains, uint16[] memory weights) {
        return AllocatorRegistry.spokesOf(address(_s().trancheSystem), _s().productId, _hubChainId());
    }

    /// @dev Dispatch funds exactly as planned in depAllocOf. Planning and execution are separated because
    ///      deposits that arrive during collection are only planned; their funds stay in the router (outside
    ///      NAV) until after settlement, when this function sends them out. Since the plan is fixed, the actual
    ///      allocation always matches the approval record (Allocation[], hub included). The adapterChainIds of
    ///      DepositQueued/RedeemQueued are the spoke-only subset of this plan (hub excluded, same convention
    ///      as SettleStarted; see IntakeFacet).
    function _executeDeposit(bytes32 requestId) internal {
        LedgerStorage.AllocSnap[] storage snap = _s().depAllocOf[requestId];
        uint64 hubId = _hubChainId();
        for (uint256 i = 0; i < snap.length; i++) {
            if (snap[i].chainId == hubId) _s().orchestrator.supplyHub(_s().productId, snap[i].amount, requestId);
            else {
                _s().supplySentCum[snap[i].chainId] += snap[i].amount; // count as in transit so it is not missing from NAV before landing
                _s().orchestrator.sendSupply(_s().productId, snap[i].chainId, snap[i].amount, requestId);
            }
        }
    }

    // ── Shared state views (selectors assigned to IntakeFacet in the cut) ──
    function unitsOf(uint8 t) public view returns (uint256) { return _s().tr[t].units; }
    function principalOf(uint8 t) public view returns (uint256) { return _s().tr[t].principal; }
    /// @notice Last confirmed price per rank — falls back to 1.0 (WAD) only before the first settlement.
    ///         A 0 after settlement is a genuine total-loss price and is returned as is.
    function lastPriceOf(uint8 t) public view returns (uint256 p) { p = _s().tr[t].lastPrice; if (p == 0 && _s().settlementId == 0) p = WAD; }

    function unitsOfVault(address vault) public view returns (uint256) { return _s().unitsOfVault[vault]; }
    function settlementId() public view returns (uint256) { return _s().settlementId; }
    function collecting() public view returns (bool) { return _s().collecting; }
    function pendingDepositAssets() public view returns (uint256) { return _s().pendingDepositAssets; }
    function rebalanceTo() public view returns (uint64) { return _s().rebalanceTo; }
    function PRODUCT_ID() public view returns (uint64) { return _s().productId; }
    // owner() belongs to OwnershipFacet (IERC173) — redeclaring it here would clash in diamondCut.
    function orchestrator() public view returns (address) { return address(_s().orchestrator); }
}
