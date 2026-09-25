// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { ISettlementLedger } from "../../interfaces/ISettlementLedger.sol";
import { IProductRegistry } from "../../interfaces/IProductRegistry.sol";
import { HubRouter } from "../HubRouter.sol";

/// @title  LedgerStorage — namespaced storage of the HubLedger diamond (ERC-7201 style)
/// @notice Ledger state (tranches, queues, collection, rebalance) is tightly coupled, so it lives in one
///         namespaced struct shared by every facet. New fields may only be appended at the end of the struct.
///         The precompile addresses (0x…0200 / 0x…0201) are fixed on the node but kept in storage (set once
///         in init) so tests can inject mocks.
library LedgerStorage {
    // keccak256(abi.encode(uint256(keccak256("hedra.ledger.v1")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant SLOT = 0x173f2978b587e6d28f61d18a6d0fb0b0c11f69626203684bd3a4fc33c8834400;

    struct Tranche {
        uint256 units;       // shares outstanding
        uint256 lastPrice;   // last confirmed price (0 = never settled — lastPriceOf falls back to WAD before the first settlement)
        uint256 principal;   // rated (rank < jr) principal sum — waterfall target base
        uint256 target;      // rated cumulative target NAV (apr accrued; equals principal when apr = 0)
        uint256 settlePrice; // confirmed price of the settlement in progress (shared by helpers)
    }

    struct PendingReq { bytes32 requestId; uint64 srcChain; uint8 tranche; address controller; uint256 amount; uint8 orderType; }
    struct AllocSnap { uint64 chainId; uint256 amount; }

    struct Layout {
        // ── Wiring ── No owner here: diamond ownership is IERC173 (LibDiamond.contractOwner), and
        //    LedgerBase.onlyOwner reads that.
        HubRouter orchestrator;
        ISettlementLedger investments;    // 0x…0201 (mock in tests)
        IProductRegistry trancheSystem;   // 0x…0200 — source of truth for static product data; never cached, read on every use
        uint64 productId;
        uint256 reentrancy;               // nonReentrant guard (1 = unlocked, 2 = locked)

        // ── Tranches (keyed by rank — no cap on count) ──
        mapping(uint8 => Tranche) tr;

        // ── Settlement round and request queues ──
        uint256 settlementId;             // 0 = genesis (not a real round); _settle() increments first, then records under the new value
        PendingReq[] pending;             // requests awaiting settle
        uint256 pendingDepositAssets;     // excluded from NAV — unconfirmed deposit principal
        PendingReq[] pendingNext;         // arrived during collection — carried to the next round
        uint256 pendingDepositAssetsNext;

        // ── NAV collection session ──
        bool collecting;
        mapping(uint64 => bool) navReceived;
        mapping(uint64 => uint256) navOf;
        uint256 navReceivedCount;
        uint256 navExpected;
        bytes[] navValsBuf;               // buffered spoke AdapterValuation responses (abi.encode bytes)

        // ── Rebalance session (single in-flight) ──
        uint64 rebalanceTo;
        uint256 rebalanceExpected;
        uint256 rebalanceCollected;

        // ── Waterfall accrual ──
        uint64 lastAccrue;

        // ── Settlement-time payout funding ──
        uint256 payoutCollected;          // realized redemption proceeds gathered via Response (kind 4); physically held by the router

        // ── Approved allocation snapshots and per-vault attribution ──
        mapping(bytes32 => AllocSnap[]) depAllocOf;
        mapping(address => uint256) unitsOfVault; // Σ(vaults of one rank) == tr[rank].units

        // ── In-transit assets — cumulative deposit allocations sent to and received by each spoke.
        //    Both are monotonic so no approval data is needed: sent is bumped when the hub dispatches,
        //    received is reported by the spoke in its NAV response. sent − received = in-transit balance.
        mapping(uint64 => uint256) supplySentCum;
        mapping(uint64 => uint256) supplyRecvCum;
    }

    function layout() internal pure returns (Layout storage s) {
        bytes32 slot = SLOT;
        assembly { s.slot := slot }
    }

}
