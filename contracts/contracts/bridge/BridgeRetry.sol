// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { SocketMessage, SocketUserRequest, SocketRequestInfo, ISocketView, IHookSocket, IHookProcessed, IFeeSponsor, Variants } from "./BridgeTypes.sol";

/// @title  BridgeRetry
/// @notice External library that verifies and unwraps a stuck bridge message for BridgeClient.recoverMessage.
///         Kept out of BridgeClient because the Socket decode/hash/double-unwrap codegen would push the
///         spoke coordinator over EIP-170. Runs via delegatecall, so address(this) is the calling contract
///         and the sender/receiver checks hold. Two recovery modes, decided from the Socket status:
///           - Rollbacked: the send leg failed; resend the same payload with the refunded assets (MODE_RESEND).
///           - Executed and marked processed by the hook: delivery reached us but our handler reverted.
///             The hook's manual execute is try/catch, so assets already moved and processedRequests is
///             final; only our handler needs to run again (MODE_HANDLE).
library BridgeRetry {
    error BadSocketMessage();
    error NotRecoverable();
    error NotOurRequest();
    error AlreadyRetried();
    error AlreadyHandled();

    uint8 internal constant MODE_RESEND = 0;
    uint8 internal constant MODE_HANDLE = 1;
    uint8 internal constant TASK_EXECUTED = 3;   // Socket_Struct.Task_Status
    uint8 internal constant TASK_ROLLBACKED = 8;
    bytes32 internal constant RETRY_NS = keccak256("achilles.bridge.retried.v1");
    bytes32 internal constant HANDLED_NS = keccak256("achilles.bridge.handled.v1");

    /// @notice Whether the receive handler already processed this message; prevents re-running a
    ///         normally delivered message. Key = (source ChainIndex, sender contract, declared amount,
    ///         payload hash); the payload carries requestId/settlementId so real messages never collide.
    function handled(bytes4 srcIdx, address sender, uint256 declared, bytes32 payloadHash) public view returns (bool v) {
        bytes32 slot = keccak256(abi.encode(HANDLED_NS, srcIdx, sender, declared, payloadHash));
        assembly { v := sload(slot) }
    }
    /// @notice Marks a message handled. BridgeClient.receiveMessage calls this right before dispatching
    ///         (delegatecall: writes the caller's storage).
    function markHandled(bytes4 srcIdx, address sender, uint256 declared, bytes32 payloadHash) external {
        bytes32 slot = keccak256(abi.encode(HANDLED_NS, srcIdx, sender, declared, payloadHash));
        assembly { sstore(slot, 1) }
    }

    /// @notice Whether the packed req_id was already recovered (reads the caller's scattered slot).
    function retried(bytes32 reqId) public view returns (bool done) {
        bytes32 slot = keccak256(abi.encode(RETRY_NS, reqId));
        assembly { done := sload(slot) }
    }

    /// @param  hook    bridge hook; the Socket is resolved via hook.socket()
    /// @param  sponsor fee sponsor (0 skips the top-up)
    /// @return mode     0 = resend (our outbound request rolled back), 1 = re-handle (inbound handler failed)
    /// @return chainIdx destination ChainIndex on resend, source ChainIndex on re-handle (caller maps to chainId)
    /// @return peer     receiver contract on resend, sender contract on re-handle
    /// @return amt      original declared amount
    /// @return message  our raw payload
    /// @return reqId    packed RequestID (chain|round|sequence), the idempotency key
    function verifyAndUnwrap(address hook, address sponsor, SocketMessage calldata m)
        external
        returns (uint8 mode, bytes4 chainIdx, address peer, uint256 amt, bytes memory message, bytes32 reqId)
    {
        // 1. Verify against the Socket record: m must be the message registered for this req_id.
        reqId = bytes32(abi.encodePacked(m.req_id.chain, m.req_id.round_id, m.req_id.sequence));
        SocketRequestInfo memory ri = ISocketView(IHookSocket(hook).socket()).get_request(m.req_id);
        if (ri.msg_hash != keccak256(abi.encode(SocketUserRequest(m.ins_code, m.params)))) revert BadSocketMessage();

        // 2. Unwrap the hook envelope: (sender, to, refund, maxTxFee, our Variants).
        (address sender_,,,, bytes memory ourVariants) = abi.decode(m.params.variants, (address, address, address, uint256, bytes));
        Variants memory v = abi.decode(ourVariants, (Variants));
        (amt, message) = abi.decode(v.message, (uint256, bytes));

        // 3. Decide the mode from the Socket status.
        if (ri.field[0] == TASK_ROLLBACKED) {
            if (sender_ != address(this)) revert NotOurRequest();   // only resend our own requests
            (mode, chainIdx, peer) = (MODE_RESEND, m.ins_code.chain, v.receiver);
        } else if (ri.field[0] >= TASK_EXECUTED && IHookProcessed(hook).processedRequests(reqId)) {
            // Hook marked it processed: verification and asset transfer are done; only our handler remains.
            if (v.receiver != address(this)) revert NotOurRequest(); // only re-handle messages addressed to us
            // processedRequests alone cannot tell handler success from failure; refuse already handled ones.
            if (handled(m.req_id.chain, v.sender, amt, keccak256(message))) revert AlreadyHandled();
            (mode, chainIdx, peer) = (MODE_HANDLE, m.req_id.chain, v.sender);
        } else revert NotRecoverable();

        // 4. Fee top-up: the refunded/delivered amount (m.params.amount) is net of the bridge fee, so it is
        //    below the declared amount. Without this each recovery would shave principal. No-op when the
        //    bridge fee is 0, or when no sponsor is set / sponsor is empty.
        if (amt > m.params.amount && sponsor != address(0)) {
            try IFeeSponsor(sponsor).sponsor(amt - m.params.amount) {} catch {}
        }
        // 5. Once per req_id, recorded in a scattered slot (no sequential base slots: derived layouts).
        if (retried(reqId)) revert AlreadyRetried();
        bytes32 slot = keccak256(abi.encode(RETRY_NS, reqId));
        assembly { sstore(slot, 1) }
    }
}
