// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/// @title  IProductRegistry — read surface of the node's product-registry precompile (0x…0200)
/// @notice The pallet is the source of truth for static product data; hub contracts query it on every
///         use instead of caching a copy. Structs are returned in the same shape as the create_product inputs.
/// @dev    Enum fields (tranche_type, source_type, action) are flattened to uint8 — identical ABI encoding,
///         fewer imports at call sites. Values: tranche_type 0=Junior 1=Senior,
///         source_type 0=OffchainSource 1=OnchainSource, action (CrudAction) 0=Add 1=Remove 2=Update.
interface IProductRegistry {
    struct VaultInput { uint64 chain_id; address vault_address; }
    struct AdapterInput { uint8 source_type; address source_address; uint16 weightBps; address borrower; CollateralInput[] collaterals; }
    /// @dev chain_id — collateral may live on a chain other than the hub.
    struct CollateralInput { uint64 chain_id; address nft_contract; uint256 nft_token_id; }
    /// @dev Valuation parameter of create_product: base asset, valuation address and the settlement schedule.
    struct ValuationInput {
        address base_asset;
        address valuation_address;
        uint64 settlement_start_timestamp;
        uint64 settlement_length_secs;
        uint64 settlement_offset_secs;
    }
    struct TrancheInput { uint8 tranche_type; uint256 apr; VaultInput vault; address asset; address shares; uint8 priority; }
    struct MultichainAdapterInput { address adapter_address; uint64 chain_id; uint16 weightBps; AdapterInput[] adapters; }
    /// @dev chain_id is never the hub itself — hub vault requests reach the ledger directly without a
    ///      coordinator hop. Bindings are per product: two products on the same spoke bind separate instances.
    struct MultichainTrancheManagerInput { uint64 chain_id; address tranche_manager_address; }

    /// @dev Settlement mode of a single-chain product — when is_sync is true the other fields are unused.
    struct SettlementModeInput {
        bool is_sync;
        uint64 settlement_start_timestamp;
        uint64 settlement_length_secs;
        uint64 settlement_offset_secs;
    }
    /// @dev Valuation parameter of create_single_chain_product — distinct from ValuationInput because
    ///      base_asset and valuation_address live on the product's own chain, not the hub.
    struct SingleChainValuationInput {
        address base_asset;
        address valuation_address;
        SettlementModeInput settlement_mode;
    }
    /// @dev Unit returned by get_adapters — one entry per allocator for multichain, one entry total for single-chain.
    struct AdaptersByChain { uint64 chain_id; AdapterInput[] adapters; }

    function get_product(uint64 product_id) external view
        returns (address base_asset, address valuation, uint64 settlement_start_timestamp, uint64 settlement_length_secs, uint64 settlement_offset_secs);
    /// @dev Sorted by priority (0 = highest = senior).
    function get_tranches(uint64 product_id) external view returns (TrancheInput[] memory);
    /// @dev weightBps = per-chain split (sums to 10_000). Nested adapters = that chain's yield sources. Multichain only.
    function get_multichain_adapters(uint64 product_id) external view returns (MultichainAdapterInput[] memory);
    /// @dev Per-spoke coordinator bindings — the hub entry is never included. Multichain only.
    function get_multichain_tranche_managers(uint64 product_id) external view returns (MultichainTrancheManagerInput[] memory);
    /// @dev Full replacement (not a delta) — ProductAdmin only. Reverts if the hub chain_id is included.
    function set_multichain_tranche_managers(uint64 product_id, MultichainTrancheManagerInput[] calldata managers) external;

    /// @dev Adapters grouped by chain — shared by multichain and single-chain products.
    function get_adapters(uint64 product_id) external view returns (AdaptersByChain[] memory adapters_by_chain);
    /// @dev Single-chain only — reverts for multichain products.
    function get_tranche_manager(uint64 product_id) external view returns (address tranche_manager);
    /// @dev Single-chain only — reverts for multichain products (multichain writes the investments pallet directly).
    function get_ledger(uint64 product_id) external view returns (address ledger);
    /// @dev Global single value (product independent). Zero address when unset.
    function get_orchestrator() external view returns (address orchestrator);
}
