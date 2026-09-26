// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { WireCodec } from "../../bridge/WireCodec.sol";
import { ISettlementLedger } from "../../interfaces/ISettlementLedger.sol";

/// @title  MockSettlementLedger — mock of the node's investments precompile (0x…0201)
/// @notice Records only. Same authentication model as the node: msg.sender must be the product's registered
///         valuation address. The pallet's RequestedInvestments → ApprovedInvestments move is modelled with
///         the requested / approved mappings. recorded_at / timestamp are set here as the pallet would.
contract MockSettlementLedger is ISettlementLedger {

    address public admin;
    mapping(uint256 productId => address) public valuationOf; // valuation_address of create_product

    /// @dev Requests are not deleted on approval — get_request must keep returning investor/vault/amount
    ///      afterwards. settlementId is updated to the approval round; status is derived from the approved mapping.
    struct Requested { address investor; uint64 vaultChainId; address vault; uint256 amount; uint256 settlementId; uint8 orderType; bool exists; }
    struct Approved  { uint256 settlementId; uint256 claimableAssets; bool exists; }
    mapping(uint256 productId => mapping(bytes32 requestId => Requested)) public requested;
    mapping(uint256 productId => mapping(bytes32 requestId => Approved)) public approved;
    mapping(uint256 productId => mapping(uint256 settlementId => uint256)) public productNavOf;       // derived: Σ tranche_nav
    mapping(uint256 productId => mapping(uint256 settlementId => uint256)) public pendingDepositOf;   // unconfirmed deposits per settlement
    mapping(uint256 productId => mapping(uint256 settlementId => WireCodec.TrancheSettle[])) internal trancheOf; // per-settlement tranche snapshot (vault keyed)
    mapping(uint256 productId => mapping(uint256 settlementId => WireCodec.AdapterValuation[])) internal adapterValuationsOf;
    mapping(uint256 productId => mapping(uint256 settlementId => bytes32[])) internal pendingReqIdsOf; // enumeration for get_pending_requests
    mapping(uint256 productId => uint256) public settlementIdOf;                                       // get_settlement_id — echoes the last value the ledger recorded
    mapping(uint256 productId => mapping(uint256 settlementId => bool)) internal settlementExists;
    mapping(uint256 productId => mapping(uint256 settlementId => uint256)) public recordedAtOf;  // block.number
    mapping(uint256 productId => mapping(uint256 settlementId => uint256)) public recordedTsOf;  // block.timestamp in seconds (the real pallet_timestamp is ms)

    event InvestmentRequested(uint64 product_id, bytes32 request_id, uint256 settlement_id, uint64 vault_chain_id, address vault_address, address investor_address, uint256 amount, uint8 order_type);
    event InvestmentApproved(uint64 product_id, bytes32 request_id, uint256 settlement_id, Allocation[] allocations, uint256 receivable_amount);
    event AdapterValuationsRecorded(uint64 product_id, uint256 settlement_id, WireCodec.AdapterValuation[] valuations);
    event TrancheSettlementRecorded(uint64 product_id, uint256 settlement_id, uint256 pending_deposit_assets, uint256 product_nav); // same shape as the single-chain ledger event

    error NotAdmin();
    error NotValuation();
    error UnknownRequest();
    error UnknownTranche();
    error NoSettlement();

    modifier onlyValuation(uint256 productId) {
        if (msg.sender != valuationOf[productId]) revert NotValuation();
        _;
    }

    constructor() { admin = msg.sender; }

    function setValuation(uint256 productId, address valuation) external {
        if (msg.sender != admin) revert NotAdmin();
        valuationOf[productId] = valuation;
    }

    function record_investment_request(
        uint64 product_id, bytes32 request_id, uint256 settlement_id, uint64 vault_chain_id,
        address vault_address, address investor_address, uint256 amount, uint8 order_type
    ) external onlyValuation(product_id) {
        requested[product_id][request_id] = Requested(investor_address, vault_chain_id, vault_address, amount, settlement_id, order_type, true);
        pendingReqIdsOf[product_id][settlement_id].push(request_id);
        emit InvestmentRequested(product_id, request_id, settlement_id, vault_chain_id, vault_address, investor_address, amount, order_type);
    }

    error AllocationSumMismatch(); // node rule: Σ allocations = original request amount
    mapping(uint256 => mapping(bytes32 => Allocation[])) internal _allocsOf; // per-chain allocation record

    function record_investment_approval(
        uint64 product_id, bytes32 request_id, uint256 settlement_id,
        Allocation[] calldata allocations, uint256 claimable_assets
    ) external onlyValuation(product_id) {
        _recordApproval(product_id, request_id, settlement_id, allocations, claimable_assets);
    }

    /// @notice Batch approval. Per-entry logic matches the single call; EVM revert propagation models atomicity.
    function record_investment_approvals(
        uint64 product_id, uint256 settlement_id, InvestmentApprovalInput[] calldata approvals
    ) external onlyValuation(product_id) {
        for (uint256 i = 0; i < approvals.length; i++) {
            _recordApproval(product_id, approvals[i].request_id, settlement_id, approvals[i].allocations, approvals[i].receivable_amount);
        }
    }

    function _recordApproval(
        uint64 product_id, bytes32 request_id, uint256 settlement_id,
        Allocation[] calldata allocations, uint256 claimable_assets
    ) internal {
        Requested storage r = requested[product_id][request_id];
        if (!r.exists) revert UnknownRequest();
        uint256 sum;
        for (uint256 i = 0; i < allocations.length; i++) {
            sum += allocations[i].amount;
            _allocsOf[product_id][request_id].push(allocations[i]);
        }
        if (sum != r.amount) revert AllocationSumMismatch();
        r.settlementId = settlement_id; // Requested → Approved (get_request stays readable, only status flips)
        approved[product_id][request_id] = Approved(settlement_id, claimable_assets, true);
        emit InvestmentApproved(product_id, request_id, settlement_id, allocations, claimable_assets);
    }

    function getAllocations(uint64 product_id, bytes32 request_id) external view returns (Allocation[] memory) {
        return _allocsOf[product_id][request_id];
    }

    function record_adapter_valuations(uint64 product_id, uint256 settlement_id, WireCodec.AdapterValuation[] calldata valuations)
        external onlyValuation(product_id)
    {
        delete adapterValuationsOf[product_id][settlement_id];
        // The pallet keys entries on (chainId, adapter) and rejects a repeat with DuplicateAdapterValuationEntry.
        // Accepting one here silently would let a caller that buffers the same chain twice pass its tests and
        // still lose the whole round's valuations on chain.
        for (uint256 i = 0; i < valuations.length; i++)
            for (uint256 j = 0; j < i; j++)
                require(
                    valuations[i].chainId != valuations[j].chainId || valuations[i].adapter != valuations[j].adapter,
                    "DuplicateAdapterValuationEntry"
                );
        for (uint256 i = 0; i < valuations.length; i++) adapterValuationsOf[product_id][settlement_id].push(valuations[i]);
        emit AdapterValuationsRecorded(product_id, settlement_id, valuations);
    }

    /// @notice Record the tranche-level settlement result. product_nav = the confirmed total NAV the ledger
    ///         used for the waterfall; recorded atomically with pending and the tranche snapshot.
    function record_settlement(
        uint64 product_id, uint256 settlement_id,
        WireCodec.TrancheSettle[] calldata tranches, uint256 pending_deposit_assets, uint256 product_nav
    ) external onlyValuation(product_id) {
        delete trancheOf[product_id][settlement_id];
        for (uint256 i = 0; i < tranches.length; i++) trancheOf[product_id][settlement_id].push(tranches[i]);
        productNavOf[product_id][settlement_id] = product_nav;
        pendingDepositOf[product_id][settlement_id] = pending_deposit_assets;
        settlementIdOf[product_id] = settlement_id;
        settlementExists[product_id][settlement_id] = true;
        recordedAtOf[product_id][settlement_id] = block.number;
        recordedTsOf[product_id][settlement_id] = block.timestamp;
        emit TrancheSettlementRecorded(product_id, settlement_id, pending_deposit_assets, product_nav);
    }

    // ── Views ──

    function get_settlement_id(uint64 product_id) external view returns (uint256) {
        return settlementIdOf[product_id];
    }

    /// @dev Approved entries are filtered through the approved mapping on every call instead of being removed
    ///      from the array — simpler than swap-pop at test scale (few requests per settlement).
    function get_pending_requests(uint64 product_id, uint256 settlement_id, uint256 offset, uint256 limit)
        external view returns (bytes32[] memory request_ids)
    {
        bytes32[] storage all = pendingReqIdsOf[product_id][settlement_id];
        bytes32[] memory buf = new bytes32[](limit);
        uint256 skipped; uint256 filled;
        for (uint256 i = 0; i < all.length && filled < limit; i++) {
            bytes32 rid = all[i];
            if (approved[product_id][rid].exists) continue;
            if (skipped < offset) { skipped++; continue; }
            buf[filled++] = rid;
        }
        request_ids = new bytes32[](filled);
        for (uint256 i = 0; i < filled; i++) request_ids[i] = buf[i];
    }

    function get_request(uint64 product_id, bytes32 request_id) external view returns (
        address investor, uint64 vault_chain_id, address vault, uint256 amount,
        uint256 settlement_id, uint8 order_type, uint8 status
    ) {
        Requested storage r = requested[product_id][request_id];
        if (!r.exists) revert UnknownRequest();
        status = approved[product_id][request_id].exists ? 1 : 0;
        return (r.investor, r.vaultChainId, r.vault, r.amount, r.settlementId, r.orderType, status);
    }

    function get_tranche_state(uint64 product_id, VaultInput calldata tranche)
        external view returns (uint256 units_outstanding, uint256 principal)
    {
        uint256 sid = settlementIdOf[product_id];
        if (!settlementExists[product_id][sid]) revert NoSettlement();
        WireCodec.TrancheSettle[] storage tr = trancheOf[product_id][sid];
        for (uint256 i = 0; i < tr.length; i++) {
            if (tr[i].vault_chain_id == tranche.chain_id && tr[i].vault_address == tranche.vault_address) {
                return (tr[i].units_outstanding, tr[i].principal);
            }
        }
        revert UnknownTranche();
    }

    function get_pending_deposit_assets(uint64 product_id) external view returns (uint256) {
        return pendingDepositOf[product_id][settlementIdOf[product_id]];
    }

    /// @dev Order within a chain is the order submitted to record_settlement (the ledger already submits in
    ///      priority order), not a fresh get_tranches lookup.
    function get_last_settlement(uint64 product_id)
        external view returns (uint256 settlement_id, ChainSettlement[] memory chains, uint256 product_nav)
    {
        settlement_id = settlementIdOf[product_id];
        if (!settlementExists[product_id][settlement_id]) revert NoSettlement();
        chains = _groupByChain(trancheOf[product_id][settlement_id]);
        product_nav = productNavOf[product_id][settlement_id];
    }

    function _groupByChain(WireCodec.TrancheSettle[] storage tr) internal view returns (ChainSettlement[] memory chains) {
        uint256 n = tr.length;
        uint64[] memory seen = new uint64[](n);
        uint256 uniq;
        for (uint256 i = 0; i < n; i++) {
            uint64 cid = tr[i].vault_chain_id;
            bool found;
            for (uint256 j = 0; j < uniq; j++) if (seen[j] == cid) { found = true; break; }
            if (!found) seen[uniq++] = cid;
        }
        for (uint256 i = 1; i < uniq; i++) { // insertion sort (few chains)
            uint64 key = seen[i]; uint256 j = i;
            while (j > 0 && seen[j - 1] > key) { seen[j] = seen[j - 1]; j--; }
            seen[j] = key;
        }
        chains = new ChainSettlement[](uniq);
        for (uint256 c = 0; c < uniq; c++) {
            uint64 cid = seen[c];
            uint256 cnt;
            for (uint256 i = 0; i < n; i++) if (tr[i].vault_chain_id == cid) cnt++;
            uint256[] memory prices = new uint256[](cnt);
            uint256[] memory navs = new uint256[](cnt);
            uint256 k;
            for (uint256 i = 0; i < n; i++) {
                if (tr[i].vault_chain_id == cid) { prices[k] = tr[i].share_price; navs[k] = tr[i].tranche_nav; k++; }
            }
            chains[c] = ChainSettlement(cid, prices, navs);
        }
    }

    function get_settlement_state(uint64 product_id, uint256 settlement_id) external view returns (
        WireCodec.TrancheSettle[] memory tranches, uint256 pending_deposit_assets, uint256 product_nav,
        uint256 recorded_at, uint256 timestamp
    ) {
        if (!settlementExists[product_id][settlement_id]) revert NoSettlement();
        tranches = trancheOf[product_id][settlement_id];
        pending_deposit_assets = pendingDepositOf[product_id][settlement_id];
        product_nav = productNavOf[product_id][settlement_id];
        recorded_at = recordedAtOf[product_id][settlement_id];
        timestamp = recordedTsOf[product_id][settlement_id];
    }

    function get_adapter_valuations(uint64 product_id, uint256 settlement_id)
        external view returns (WireCodec.AdapterValuation[] memory valuations)
    {
        valuations = adapterValuationsOf[product_id][settlement_id];
        if (valuations.length == 0) revert NoSettlement();
    }

    function get_approval(uint64 product_id, bytes32 request_id)
        external view returns (uint256 settlement_id, uint256 receivable_amount, uint8 status)
    {
        Approved storage a = approved[product_id][request_id];
        if (!a.exists) revert UnknownRequest();
        return (a.settlementId, a.claimableAssets, 1);
    }
}
