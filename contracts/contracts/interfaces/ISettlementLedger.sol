// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { WireCodec } from "../bridge/WireCodec.sol";

/// @title  ISettlementLedger — write/read surface of the node's investments precompile (0x…0201)
/// @notice Only the product's registered valuation contract may write (the precompile checks the caller).
///         Tests substitute MockSettlementLedger for this interface.
interface ISettlementLedger {
    /// @dev Per-chain allocation snapshot recorded at approval — for verification and client display.
    struct Allocation { address adapter_address; uint64 adapter_chain_id; uint256 amount; }

    /// @dev order_type: 1=deposit, 0=redeem (pallet convention).
    function record_investment_request(
        uint64 product_id, bytes32 request_id, uint256 settlement_id,
        uint64 vault_chain_id, address vault_address, address investor_address,
        uint256 amount, uint8 order_type
    ) external;

    function record_investment_approval(
        uint64 product_id, bytes32 request_id, uint256 settlement_id,
        Allocation[] calldata allocations, uint256 receivable_amount
    ) external;

    /// @dev Batch approval. Per-entry validation, recording and events match record_investment_approval.
    ///      Atomic — one failing entry rolls back the whole batch. approvals <= MAX_SETTLEMENT_REQUESTS (1,000).
    struct InvestmentApprovalInput { bytes32 request_id; Allocation[] allocations; uint256 receivable_amount; }
    function record_investment_approvals(
        uint64 product_id, uint256 settlement_id, InvestmentApprovalInput[] calldata approvals
    ) external;

    /// @dev Allowed once per settlement_id — callers must treat failure as non-fatal.
    function record_adapter_valuations(
        uint64 product_id, uint256 settlement_id, WireCodec.AdapterValuation[] calldata valuations
    ) external;

    /// @dev Tranche entries are per vault. Entries of the same logical tranche share one share_price.
    function record_settlement(
        uint64 product_id, uint256 settlement_id, WireCodec.TrancheSettle[] calldata tranches,
        uint256 pending_deposit_assets, uint256 product_nav
    ) external;

    // ── Read surface ──

    struct VaultInput { uint64 chain_id; address vault_address; }
    /// @dev Per-chain tranche group — chain_id ascending, entries in that chain's tranche priority order.
    struct ChainSettlement { uint64 chain_id; uint256[] share_prices; uint256[] tranche_navs; }

    function get_settlement_id(uint64 product_id) external view returns (uint256);

    function get_pending_requests(uint64 product_id, uint256 settlement_id, uint256 offset, uint256 limit)
        external view returns (bytes32[] memory request_ids);

    // status: 0=pending, 1=approved
    function get_request(uint64 product_id, bytes32 request_id) external view returns (
        address investor, uint64 vault_chain_id, address vault, uint256 amount,
        uint256 settlement_id, uint8 order_type, uint8 status
    );

    function get_tranche_state(uint64 product_id, VaultInput calldata tranche)
        external view returns (uint256 units_outstanding, uint256 principal);

    function get_pending_deposit_assets(uint64 product_id) external view returns (uint256);

    function get_last_settlement(uint64 product_id)
        external view returns (uint256 settlement_id, ChainSettlement[] memory chains, uint256 product_nav);

    function get_settlement_state(uint64 product_id, uint256 settlement_id) external view returns (
        WireCodec.TrancheSettle[] memory tranches, uint256 pending_deposit_assets, uint256 product_nav,
        uint256 recorded_at, uint256 timestamp
    );

    function get_adapter_valuations(uint64 product_id, uint256 settlement_id)
        external view returns (WireCodec.AdapterValuation[] memory valuations);

    // status: always 1 (approved) — the 0/1 distinction of get_request does not apply here
    function get_approval(uint64 product_id, bytes32 request_id)
        external view returns (uint256 settlement_id, uint256 receivable_amount, uint8 status);
}
