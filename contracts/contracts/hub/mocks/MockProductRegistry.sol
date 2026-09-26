// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { IProductRegistry } from "../../interfaces/IProductRegistry.sol";

/// @title  MockProductRegistry — mock of the node's product-registry precompile (0x…0200) for tests
/// @notice Stores create_product / create_single_chain_product inputs and returns them as is — the same
///         "input equals output" shape as the real node.
/// @dev    Consistency rules of the real pallet (senior >= 1 per chain, junior <= 1, senior-first, ...) are not
///         enforced: our contracts never consume that validation and tests only submit valid configurations.
contract MockProductRegistry is IProductRegistry {
    uint8 internal constant ACTION_ADD = 0;
    uint8 internal constant ACTION_REMOVE = 1;
    uint8 internal constant ACTION_UPDATE = 2;

    struct ProductMeta {
        address base_asset; address valuation; uint64 start; uint64 len; uint64 offset;
        bool exists;
        bool isSingleChain; uint64 singleChainId; address trancheManager; address ledger; bool isSync;
    }
    mapping(uint256 => ProductMeta) internal _meta;
    mapping(uint256 => TrancheInput[]) internal _tranches;
    mapping(uint256 => MultichainAdapterInput[]) internal _adapters;    // multichain routing table
    mapping(uint256 => AdapterInput[]) internal _flatAdapters;          // single-chain flat adapter list
    mapping(uint256 => MultichainTrancheManagerInput[]) internal _managers;

    address public admin;
    address public orchestratorAddress; // get_orchestrator — root-only on the real pallet, outside this interface (admin sets it here)

    error UnknownProduct();
    error NotSingleChain();
    error NotMultichain();
    error NotFound();
    error NotAdmin();

    event ProductCreated(uint64 product_id, address product_admin, address base_asset, address valuation_address, uint64 settlement_start_timestamp, uint64 settlement_length_secs, uint64 settlement_offset_secs);
    event TrancheSet(uint64 product_id, uint8 action, uint8 tranche_type, uint256 apr, uint64 vault_chain_id, address vault_address, address asset, address shares, uint8 priority);
    event AdaptersSet(uint64 product_id, address parent_adapter_address, uint64 parent_chain_id, AdapterInput[] adapters);
    event MultichainAdaptersSet(uint64 product_id, MultichainAdapterInput[] multichain_adapters);
    event MultichainTrancheManagersSet(uint64 product_id, MultichainTrancheManagerInput[] multichain_tranche_managers);
    event SingleChainProductCreated(uint64 product_id, address product_admin, uint64 chain_id, address base_asset, address valuation_address, address tranche_manager, address ledger, bool is_sync, uint64 settlement_start_timestamp, uint64 settlement_length_secs, uint64 settlement_offset_secs);

    constructor() { admin = msg.sender; }

    /// @notice Set the global address returned by get_orchestrator — a root extrinsic on the real pallet.
    function setOrchestratorAddress(address o) external {
        if (msg.sender != admin) revert NotAdmin();
        orchestratorAddress = o;
    }

    function create_product(
        uint64 product_id,
        ValuationInput calldata valuation,
        TrancheInput[] calldata tranches, MultichainAdapterInput[] calldata adapters,
        MultichainTrancheManagerInput[] calldata managers // spoke coordinator bindings are part of product registration
    ) external {
        _meta[product_id] = ProductMeta(
            valuation.base_asset, valuation.valuation_address,
            valuation.settlement_start_timestamp, valuation.settlement_length_secs, valuation.settlement_offset_secs,
            true, false, 0, address(0), address(0), false
        );
        delete _tranches[product_id];
        delete _adapters[product_id];
        for (uint256 i = 0; i < tranches.length; i++) _tranches[product_id].push(tranches[i]);
        for (uint256 i = 0; i < adapters.length; i++) _adapters[product_id].push(adapters[i]);
        delete _managers[product_id];
        for (uint256 i = 0; i < managers.length; i++) _managers[product_id].push(managers[i]);
        emit ProductCreated(product_id, msg.sender, valuation.base_asset, valuation.valuation_address,
            valuation.settlement_start_timestamp, valuation.settlement_length_secs, valuation.settlement_offset_secs);
    }

    /// @notice Register a single-chain product — vaults, coordinator, valuation, adapters and ledger all live on chain_id.
    function create_single_chain_product(
        uint64 product_id, uint64 chain_id, SingleChainValuationInput calldata valuation,
        TrancheInput[] calldata tranches, address tranche_manager, AdapterInput[] calldata adapters, address ledger
    ) external {
        _meta[product_id] = ProductMeta(
            valuation.base_asset, valuation.valuation_address,
            valuation.settlement_mode.settlement_start_timestamp, valuation.settlement_mode.settlement_length_secs, valuation.settlement_mode.settlement_offset_secs,
            true, true, chain_id, tranche_manager, ledger, valuation.settlement_mode.is_sync
        );
        delete _tranches[product_id];
        for (uint256 i = 0; i < tranches.length; i++) _tranches[product_id].push(tranches[i]);
        delete _flatAdapters[product_id];
        for (uint256 i = 0; i < adapters.length; i++) _flatAdapters[product_id].push(adapters[i]);
        _emitSingleChainCreated(product_id, chain_id, tranche_manager, ledger);
    }

    function _emitSingleChainCreated(uint64 product_id, uint64 chain_id, address tranche_manager, address ledger) internal { // separate frame to avoid stack too deep
        ProductMeta memory m = _meta[product_id];
        emit SingleChainProductCreated(product_id, msg.sender, chain_id, m.base_asset, m.valuation,
            tranche_manager, ledger, m.isSync, m.start, m.len, m.offset);
    }

    /// @notice Add / remove / update one tranche, identified by vault (chain_id, vault_address); priority order is kept within the chain group.
    function set_tranche(uint64 product_id, uint8 action, TrancheInput calldata tranche) external {
        TrancheInput[] storage list = _tranches[product_id];
        if (action == ACTION_ADD) {
            uint256 insertAt = list.length;
            for (uint256 i = 0; i < list.length; i++) {
                if (list[i].vault.chain_id == tranche.vault.chain_id && list[i].priority > tranche.priority) { insertAt = i; break; }
            }
            list.push(tranche);
            for (uint256 i = list.length - 1; i > insertAt; i--) list[i] = list[i - 1];
            list[insertAt] = tranche;
        } else if (action == ACTION_REMOVE) {
            uint256 idx = _findTranche(list, tranche.vault.chain_id, tranche.vault.vault_address);
            for (uint256 i = idx; i < list.length - 1; i++) list[i] = list[i + 1];
            list.pop();
        } else {
            uint256 idx = _findTranche(list, tranche.vault.chain_id, tranche.vault.vault_address);
            list[idx].apr = tranche.apr;
            list[idx].asset = tranche.asset;
            list[idx].shares = tranche.shares;
            list[idx].priority = tranche.priority;
        }
        emit TrancheSet(product_id, action, tranche.tranche_type, tranche.apr, tranche.vault.chain_id, tranche.vault.vault_address, tranche.asset, tranche.shares, tranche.priority);
    }

    function _findTranche(TrancheInput[] storage list, uint64 chainId, address vault) internal view returns (uint256) {
        for (uint256 i = 0; i < list.length; i++) if (list[i].vault.chain_id == chainId && list[i].vault.vault_address == vault) return i;
        revert NotFound();
    }

    /// @notice Replace an adapter list — for multichain only the nested adapters of the entry identified by
    ///         (parent_adapter_address, parent_chain_id); for single-chain the product's whole flat list.
    function set_adapters(uint64 product_id, address parent_adapter_address, uint64 parent_chain_id, AdapterInput[] calldata adapters) external {
        if (_meta[product_id].isSingleChain) {
            delete _flatAdapters[product_id];
            for (uint256 i = 0; i < adapters.length; i++) _flatAdapters[product_id].push(adapters[i]);
        } else {
            MultichainAdapterInput[] storage list = _adapters[product_id];
            uint256 idx = list.length;
            for (uint256 i = 0; i < list.length; i++) {
                if (list[i].adapter_address == parent_adapter_address && list[i].chain_id == parent_chain_id) { idx = i; break; }
            }
            if (idx == list.length) revert NotFound();
            delete list[idx].adapters;
            for (uint256 i = 0; i < adapters.length; i++) list[idx].adapters.push(adapters[i]);
        }
        emit AdaptersSet(product_id, parent_adapter_address, parent_chain_id, adapters);
    }

    /// @notice Replace the whole multichain routing table.
    function set_multichain_adapters(uint64 product_id, MultichainAdapterInput[] calldata multichain_adapters) external {
        if (_meta[product_id].isSingleChain) revert NotMultichain();
        delete _adapters[product_id];
        for (uint256 i = 0; i < multichain_adapters.length; i++) _adapters[product_id].push(multichain_adapters[i]);
        emit MultichainAdaptersSet(product_id, multichain_adapters);
    }

    function set_multichain_tranche_managers(uint64 product_id, MultichainTrancheManagerInput[] calldata managers) external {
        if (_meta[product_id].isSingleChain) revert NotMultichain();
        delete _managers[product_id];
        for (uint256 i = 0; i < managers.length; i++) _managers[product_id].push(managers[i]);
        emit MultichainTrancheManagersSet(product_id, managers);
    }

    // ── Views ──

    function get_product(uint64 pid) external view returns (address, address, uint64, uint64, uint64) {
        ProductMeta memory m = _meta[pid];
        if (!m.exists) revert UnknownProduct();
        return (m.base_asset, m.valuation, m.start, m.len, m.offset);
    }

    /// @dev Mirrors the pallet's return order: grouped by chain_id ascending, priority order within a group.
    function get_tranches(uint64 pid) external view returns (TrancheInput[] memory out) {
        if (!_meta[pid].exists) revert UnknownProduct();
        TrancheInput[] storage src = _tranches[pid];
        out = new TrancheInput[](src.length);
        for (uint256 i = 0; i < src.length; i++) { // insertion sort (few items)
            TrancheInput memory t = src[i];
            uint256 j = i;
            while (j > 0 && (out[j - 1].vault.chain_id > t.vault.chain_id ||
                   (out[j - 1].vault.chain_id == t.vault.chain_id && out[j - 1].priority > t.priority))) {
                out[j] = out[j - 1];
                j--;
            }
            out[j] = t;
        }
    }

    function get_multichain_adapters(uint64 pid) external view returns (MultichainAdapterInput[] memory) {
        if (!_meta[pid].exists) revert UnknownProduct();
        if (_meta[pid].isSingleChain) revert NotMultichain();
        return _adapters[pid];
    }

    function get_multichain_tranche_managers(uint64 pid) external view returns (MultichainTrancheManagerInput[] memory) {
        if (!_meta[pid].exists) revert UnknownProduct();
        if (_meta[pid].isSingleChain) revert NotMultichain();
        return _managers[pid];
    }

    /// @notice Product adapters grouped by chain — multichain returns (chain_id, nested adapters) without the
    ///         allocator address and weight; single-chain returns one entry.
    function get_adapters(uint64 pid) external view returns (AdaptersByChain[] memory adapters_by_chain) {
        ProductMeta memory m = _meta[pid];
        if (!m.exists) revert UnknownProduct();
        if (m.isSingleChain) {
            adapters_by_chain = new AdaptersByChain[](1);
            adapters_by_chain[0] = AdaptersByChain(m.singleChainId, _flatAdapters[pid]);
        } else {
            MultichainAdapterInput[] storage list = _adapters[pid];
            adapters_by_chain = new AdaptersByChain[](list.length);
            for (uint256 i = 0; i < list.length; i++) adapters_by_chain[i] = AdaptersByChain(list[i].chain_id, list[i].adapters);
        }
    }

    function get_tranche_manager(uint64 pid) external view returns (address) {
        ProductMeta memory m = _meta[pid];
        if (!m.exists) revert UnknownProduct();
        if (!m.isSingleChain) revert NotSingleChain();
        return m.trancheManager;
    }

    function get_ledger(uint64 pid) external view returns (address) {
        ProductMeta memory m = _meta[pid];
        if (!m.exists) revert UnknownProduct();
        if (!m.isSingleChain) revert NotSingleChain();
        return m.ledger;
    }

    function get_orchestrator() external view returns (address) {
        return orchestratorAddress;
    }
}
