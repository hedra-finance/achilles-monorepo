// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IHook, User_Request, Variants, ChainIndex, SocketRequestID, SocketRequestInfo } from "../bridge/BridgeTypes.sol";

interface IBridgeReceiver {
    function receiveMessage(ChainIndex sourceChain, address sender, address token, uint256 amount, bytes calldata message) external payable;
}

/// @title  MockBridge
/// @notice Test double for the bridge hook, one instance per simulated chain on a single Hardhat network.
///         The live path request -> Socket event -> relayer -> receiveMessage collapses to request (queue) and
///         relay (the test plays relayer). Bridging is a token transfer on the same network; receivers
///         authenticate msg.sender == their chain's hook (this contract). No signatures, fees or rollback;
///         happy path only, Task_Status is a delivered flag.
contract MockBridge is IHook {
    using SafeERC20 for IERC20;

    uint64 public immutable chainId;
    bytes4 public immutable localIndex; // this chain's ChainIndex, passed to receivers as the source index
    IERC20 public immutable token;      // single base asset

    mapping(uint64 => MockBridge) public peers;        // dstChainId -> peer chain's MockBridge
    mapping(bytes4 => uint64) public chainOfIndex;     // dst ChainIndex -> dstChainId (outbound routing)
    address public admin;

    struct Outbound {
        uint64  dstChain;
        address to;        // handler on the destination chain
        address sender;    // sending handler (for the receiver's sender check)
        uint256 amount;
        bytes   message;
        bool    delivered;
    }
    Outbound[] public outbox;

    event Delivered(uint256 indexed id);

    error NotAdmin();
    error NotPeer();
    error AlreadyDelivered();
    error UnknownDestIndex();

    constructor(uint64 chainId_, bytes4 localIndex_, address token_) {
        chainId = chainId_;
        localIndex = localIndex_;
        token = IERC20(token_);
        admin = msg.sender;
    }

    /// @notice Registers a peer chain and its ChainIndex reverse map for outbound routing.
    function setPeer(uint64 dstChain, MockBridge peer, bytes4 dstIndex) external {
        if (msg.sender != admin) revert NotAdmin();
        peers[dstChain] = peer;
        chainOfIndex[dstIndex] = dstChain;
    }

    /// @notice Outbound (mirrors hook.request). Pulls approved assets when amount > 0 and queues the message.
    /// @dev The live hook refuses to carry less than the fee it charges ("insufficient amount for
    ///      maxTxFee"), and a mock that accepts anything lets that failure through to a testnet: a
    ///      redemption's realised share was smaller than the carrier minimum, the hook rejected the NAV
    ///      response, and settlement sat in collecting. Enforce the same precondition here so the suite
    ///      fails first.
    function request(uint256 maxTxFee, User_Request memory req) external payable returns (bool) {
        uint64 dstChain = chainOfIndex[ChainIndex.unwrap(req.ins_code.chain)];
        if (dstChain == 0) revert UnknownDestIndex();
        uint256 amount = req.params.amount;
        require(amount >= maxTxFee, "Hooks: insufficient amount for maxTxFee");
        if (amount > 0) token.safeTransferFrom(msg.sender, address(this), amount);
        // Like the live hook, receiveMessage gets the whole Variants blob, not the inner v.message;
        // BridgeClient unwraps it on receipt.
        outbox.push(Outbound(dstChain, req.params.to, msg.sender, amount, req.params.variants, false));
        return true;
    }

    /// @notice Relay (called by the test). Moves assets to the peer bridge and triggers delivery.
    function relay(uint256 id) external {
        Outbound storage o = outbox[id];
        if (o.delivered) revert AlreadyDelivered();
        o.delivered = true;
        MockBridge peer = peers[o.dstChain];
        if (o.amount > 0) token.safeTransfer(address(peer), o.amount);
        peer.deliver(chainId, localIndex, o.sender, o.to, o.amount, o.message);
        emit Delivered(id);
    }

    /// @notice Peer bridges only. Forwards assets to the receiver, then receiveMessage with the source ChainIndex.
    function deliver(uint64 srcChain, bytes4 srcIndex, address srcSender, address to, uint256 amount, bytes calldata message) external {
        if (msg.sender != address(peers[srcChain])) revert NotPeer();
        if (amount > 0) token.safeTransfer(to, amount);
        IBridgeReceiver(to).receiveMessage(ChainIndex.wrap(srcIndex), srcSender, address(token), amount, message);
    }

    // --- Socket stand-in for recovery tests (live wiring: hook.socket() -> Socket.get_request) ---
    mapping(bytes32 => SocketRequestInfo) internal reqInfos;
    function socket() external view returns (address) { return address(this); }
    function get_request(SocketRequestID calldata rid) external view returns (SocketRequestInfo memory) {
        return reqInfos[bytes32(abi.encodePacked(rid.chain, rid.round_id, rid.sequence))];
    }
    mapping(bytes32 => bool) public processedRequests; // hook delivery mark stand-in
    function mockSetProcessed(SocketRequestID calldata rid, bool v) external {
        processedRequests[bytes32(abi.encodePacked(rid.chain, rid.round_id, rid.sequence))] = v;
    }

    /// @notice Test helper: injects a Socket record (msg_hash + current phase).
    function mockSetRequest(SocketRequestID calldata rid, bytes32 msgHash, uint8 phase) external {
        SocketRequestInfo storage r = reqInfos[bytes32(abi.encodePacked(rid.chain, rid.round_id, rid.sequence))];
        r.msg_hash = msgHash;
        r.field[0] = phase;
    }

    function pendingOutbox() external view returns (uint256[] memory ids) {
        uint256 n;
        for (uint256 i = 0; i < outbox.length; i++) if (!outbox[i].delivered) n++;
        ids = new uint256[](n);
        uint256 j;
        for (uint256 i = 0; i < outbox.length; i++) if (!outbox[i].delivered) ids[j++] = i;
    }
}
