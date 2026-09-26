// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { WireCodec } from "../bridge/WireCodec.sol";
import { ISettlementLedger } from "../interfaces/ISettlementLedger.sol";

interface IAdapterVals {
    function adapterValuations() external view returns (WireCodec.AdapterValuation[] memory);
}

/// @title  ValuationRecords — merges per-source valuations and records them to the pallet (external library)
/// @notice The codegen for AdapterValuation[] (nested struct arrays) is large enough to threaten HubLedger's
///         EIP-170 budget, so the merge-and-record path lives here. The ledger keeps only raw byte buffers
///         and never touches the AdapterValuation type.
library ValuationRecords {
    /// @notice Emitted when the pallet write fails (non-fatal — mergeAndRecord returns false) so operators
    ///         can follow up. Settlement itself is never blocked; see the note in mergeAndRecord.
    event AdapterValuationsRecordFailed(uint64 indexed productId, uint256 indexed settlementId);

    /// @notice Merge buffered spoke responses (abi.encode(AdapterValuation[])) with the hub allocator's live
    ///         valuations and call record_adapter_valuations. A pallet write failure is non-fatal (returns false).
    function mergeAndRecord(
        address investments,
        uint64 productId,
        uint256 settlementId,
        bytes[] memory bufs,
        address hubAdapter
    ) public returns (bool ok) {
        // Products without a hub allocator (spoke-only capital) merge spoke responses only.
        WireCodec.AdapterValuation[] memory hubVals = hubAdapter == address(0)
            ? new WireCodec.AdapterValuation[](0)
            : IAdapterVals(hubAdapter).adapterValuations();
        uint256 total = hubVals.length;
        WireCodec.AdapterValuation[][] memory chunks = new WireCodec.AdapterValuation[][](bufs.length);
        for (uint256 i = 0; i < bufs.length; i++) {
            chunks[i] = abi.decode(bufs[i], (WireCodec.AdapterValuation[]));
            total += chunks[i].length;
        }
        if (total == 0) return true;
        WireCodec.AdapterValuation[] memory merged = new WireCodec.AdapterValuation[](total);
        uint256 k;
        for (uint256 i = 0; i < hubVals.length; i++) merged[k++] = hubVals[i];
        for (uint256 i = 0; i < chunks.length; i++)
            for (uint256 j = 0; j < chunks[i].length; j++) merged[k++] = chunks[i][j];
        // Pallet writes do not roll back on EVM revert: propagating a revert here would leave a partial
        // record and a permanently stuck settlement id, so the failure must be swallowed.
        try ISettlementLedger(investments).record_adapter_valuations(productId, settlementId, merged) {
            ok = true;
        } catch {
            emit AdapterValuationsRecordFailed(productId, settlementId);
        }
    }
}
