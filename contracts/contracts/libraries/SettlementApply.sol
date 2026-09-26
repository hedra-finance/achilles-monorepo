// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { WireCodec } from "../bridge/WireCodec.sol";

/// @title  SettlementApply — applies a SETTLEMENT_FINALIZE message to VaultCoordinator request state
/// @notice External library split out of VaultCoordinator to stay under EIP-170; it has a single call
///         site, so the delegatecall overhead is smaller than the bytecode saved.
library SettlementApply {
    struct Req { uint8 status; uint8 kind; uint8 tranche; address controller; uint256 inAmt; uint256 outAmt; }

    uint8 internal constant PENDING = 1;
    uint8 internal constant CLAIMABLE = 2;

    event SettleApplied(uint256 indexed settlementId, uint256 depositCount, uint256 redeemCount);
    event RequestCleared(bytes32 indexed requestId, uint64 chainId, address indexed vault, address indexed controller, uint8 kind, uint256 inAmt);

    /// @dev Target of adminClearRequest — hosted here to avoid one more library for a single call site.
    function clearRequest(
        mapping(bytes32 => Req) storage reqOf,
        mapping(uint8 => mapping(address => bytes32[])) storage userDepReqs,
        mapping(uint8 => mapping(address => bytes32[])) storage userRedReqs,
        mapping(uint8 => address) storage vaultOf,
        bytes32 requestId,
        uint64 localChainId
    ) public {
        Req storage r = reqOf[requestId];
        bytes32[] storage list = r.kind == 1 ? userDepReqs[r.tranche][r.controller] : userRedReqs[r.tranche][r.controller];
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == requestId) { list[i] = list[list.length - 1]; list.pop(); break; }
        }
        emit RequestCleared(requestId, localChainId, vaultOf[r.tranche], r.controller, r.kind, r.inAmt);
        delete reqOf[requestId];
    }

    function applySettle(
        mapping(bytes32 => Req) storage reqOf,
        mapping(uint8 => uint256) storage lastSharePrice,
        WireCodec.Envelope memory p
    ) public returns (uint256 owedDelta) {
        (WireCodec.SettleItem[] memory deposits, WireCodec.SettleItem[] memory redeems) = WireCodec.decodeSettleItems(p.data);
        for (uint256 i = 0; i < p.nums.length; i++) lastSharePrice[uint8(i)] = p.nums[i]; // share price cache

        for (uint256 i = 0; i < deposits.length; i++) {
            Req storage r = reqOf[deposits[i].requestId];
            if (r.kind != 1 || r.status != PENDING) continue; // idempotent — skip already processed items
            r.status = CLAIMABLE;
            r.outAmt = deposits[i].amount; // shares minted
        }
        for (uint256 i = 0; i < redeems.length; i++) {
            Req storage r = reqOf[redeems[i].requestId];
            if (r.kind != 0 || r.status != PENDING) continue; // kind 0 = redeem; the status check filters empty slots
            r.status = CLAIMABLE;
            r.outAmt = redeems[i].amount; // assets payable
            owedDelta += redeems[i].amount;
        }
        emit SettleApplied(p.settlementId, deposits.length, redeems.length);
    }
}
