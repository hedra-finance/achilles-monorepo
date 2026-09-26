// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { IProductRegistry } from "../interfaces/IProductRegistry.sol";

/// @title  AllocatorRegistry — raw parser over get_multichain_adapters (top-level fields only)
/// @notice `MultichainAdapterInput[]` is a triply nested dynamic array (…→AdapterInput[]→CollateralInput[]);
///         a typed decoder hits "stack too deep" on the legacy pipeline, so this reads only the needed
///         top-level words out of the raw staticcall return. Deployed as an external library (delegatecall
///         linked) with whole-task public functions so raw bytes never cross the call boundary per accessor;
///         this keeps HubLedger facets under EIP-170.
///         ABI layout (standard dynamic-struct array):
///           [0x00] array offset (=0x20) · [0x20] len · [0x40+32i] element offset (relative to array data)
///           element: +0 adapter_address · +32 chain_id · +64 weightBps · +96 adapters offset (relative to element)
///           adapters: +0 len · +32+32j item offset · item: +0 source_type · +32 source_address …
library AllocatorRegistry {
    error McAdaptersCallFailed();

    // ── Logical tranche helpers ──
    //    A logical tranche is the priority rank within a chain group: get_tranches returns chain_id
    //    ascending groups, each ordered by that chain's priority (pallet guarantee). Product convention:
    //    the same logical tranche is registered with the same rank and apr on every chain — N senior
    //    ranks followed by the last rank = junior (residual). `TrancheInput[]` is only doubly nested,
    //    so a typed decode is safe here.

    /// @notice Number of logical tranches = the largest chain group (all chains are expected to match).
    function trancheCountOf(address ts, uint64 productId) public view returns (uint8 n) {
        IProductRegistry.TrancheInput[] memory trs = IProductRegistry(ts).get_tranches(productId);
        uint64 cur; uint8 g;
        for (uint256 i = 0; i < trs.length; i++) {
            if (i == 0 || trs[i].vault.chain_id != cur) { cur = trs[i].vault.chain_id; g = 0; }
            g++;
            if (g > n) n = g;
        }
    }

    /// @notice Vault → logical tranche index (= rank within its chain group). 255 if unregistered.
    function trancheIndexOf(address ts, uint64 productId, address vault) public view returns (uint8) {
        IProductRegistry.TrancheInput[] memory trs = IProductRegistry(ts).get_tranches(productId);
        uint64 cur; uint8 g;
        for (uint256 i = 0; i < trs.length; i++) {
            if (i == 0 || trs[i].vault.chain_id != cur) { cur = trs[i].vault.chain_id; g = 0; }
            if (trs[i].vault.vault_address == vault) return g;
            g++;
        }
        return 255;
    }

    /// @notice (logical tranche rank, chain) → that chain's entry vault (zero if none).
    function vaultOfTranche(address ts, uint64 productId, uint8 tranche, uint64 chainId) public view returns (address) {
        IProductRegistry.TrancheInput[] memory trs = IProductRegistry(ts).get_tranches(productId);
        uint8 g;
        for (uint256 i = 0; i < trs.length; i++) {
            if (trs[i].vault.chain_id != chainId) continue;
            if (g == tranche) return trs[i].vault.vault_address;
            g++;
        }
        return address(0);
    }

    /// @notice apr per rank, taken from the first chain group (apr is identical across chains by convention).
    function trancheAprs(address ts, uint64 productId) public view returns (uint256[] memory aprs) {
        IProductRegistry.TrancheInput[] memory trs = IProductRegistry(ts).get_tranches(productId);
        uint8 tc = trancheCountOf(ts, productId);
        aprs = new uint256[](tc);
        if (trs.length == 0) return aprs;
        uint64 first = trs[0].vault.chain_id;
        uint8 g;
        for (uint256 i = 0; i < trs.length && trs[i].vault.chain_id == first; i++) aprs[g++] = trs[i].apr;
    }

    /// @notice Allocator address registered for chainId (zero if none).
    function adapterOfChain(address ts, uint64 productId, uint64 chainId) public view returns (address) {
        bytes memory raw = _fetch(ts, productId);
        uint256 n = _length(raw);
        for (uint256 i = 0; i < n; i++) if (_chainAt(raw, i) == chainId) return _adapterAt(raw, i);
        return address(0);
    }

    /// @notice Spoke chains (+weights) excluding hubId, derived from the pallet allocator registrations.
    function spokesOf(address ts, uint64 productId, uint64 hubId) public view returns (uint64[] memory chains, uint16[] memory weights) {
        bytes memory raw = _fetch(ts, productId);
        uint256 total = _length(raw);
        uint256 n;
        for (uint256 i = 0; i < total; i++) if (_chainAt(raw, i) != hubId) n++;
        chains = new uint64[](n); weights = new uint16[](n);
        uint256 k;
        for (uint256 i = 0; i < total; i++) if (_chainAt(raw, i) != hubId) { chains[k] = _chainAt(raw, i); weights[k] = _weightAt(raw, i); k++; }
    }

    /// @notice First yield source of the chainId entry (zero if none) — used as the hub payout source.
    function firstSourceOfChain(address ts, uint64 productId, uint64 chainId) public view returns (address) {
        bytes memory raw = _fetch(ts, productId);
        uint256 n = _length(raw);
        for (uint256 i = 0; i < n; i++) {
            if (_chainAt(raw, i) != chainId) continue;
            uint256 base = _elem(raw, i);
            uint256 aArr = base + _word(raw, base + 0x60); // adapters array head
            if (_word(raw, aArr) == 0) return address(0);  // len 0
            uint256 e = aArr + 0x20 + _word(raw, aArr + 0x20); // first item
            return address(uint160(_word(raw, e + 0x20)));     // source_address
        }
        return address(0);
    }

    // ── Internal parser ──

    function _fetch(address ts, uint64 productId) private view returns (bytes memory) {
        // Selector is derived from the string signature — must move together with the pallet's uint64 product id.
        (bool ok, bytes memory ret) = ts.staticcall(abi.encodeWithSignature("get_multichain_adapters(uint64)", productId));
        if (!ok) revert McAdaptersCallFailed();
        return ret;
    }

    function _word(bytes memory b, uint256 off) private pure returns (uint256 w) {
        assembly { w := mload(add(add(b, 0x20), off)) } // single word reader; the only assembly here
    }

    function _length(bytes memory raw) private pure returns (uint256) {
        return _word(raw, _word(raw, 0)); // follow the array offset to len
    }

    /// @dev Start offset of element i (relative to raw).
    function _elem(bytes memory raw, uint256 i) private pure returns (uint256 base) {
        uint256 arr = _word(raw, 0);            // array head
        uint256 data = arr + 0x20;              // after len = element offset table
        base = data + _word(raw, data + 0x20 * i);
    }

    function _adapterAt(bytes memory raw, uint256 i) private pure returns (address) {
        return address(uint160(_word(raw, _elem(raw, i))));
    }
    function _chainAt(bytes memory raw, uint256 i) private pure returns (uint64) {
        return uint64(_word(raw, _elem(raw, i) + 0x20));
    }
    function _weightAt(bytes memory raw, uint256 i) private pure returns (uint16) {
        return uint16(_word(raw, _elem(raw, i) + 0x40));
    }
}
