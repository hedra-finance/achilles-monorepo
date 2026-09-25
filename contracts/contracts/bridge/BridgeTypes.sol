// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

// Bridge (bridge hook) wire types. `User_Request` is the outbound `hook.request` input; our
// WireCodec payload rides inside `variants`.

type ChainIndex is bytes4;   // bridge chain index (not the EVM chainId)
type RBCmethod is bytes16;   // bridge action method index
type Asset_Index is bytes32; // asset index hash

struct Instruction { ChainIndex chain; RBCmethod method; }

struct Task_Params {
    Asset_Index tokenIDX0; // source-chain asset index
    Asset_Index tokenIDX1; // destination asset index (0 for single-asset)
    address     refund;    // rollback refund address
    address     to;        // destination receiver (our handler)
    uint256     amount;    // bridged amount
    bytes       variants;  // abi.encode(Variants): metadata + message
}

struct User_Request { Instruction ins_code; Task_Params params; }

// `variants` payload; the hook decodes it and forwards it as `message` to receiveMessage.
struct Variants { address sender; address receiver; address refund; uint256 max_tx_fee; bytes message; }

interface IHook {
    function request(uint256 _maxTxFee, User_Request memory _req) external payable returns (bool);
}

/// @notice Fee sponsor: tops up the receiver when the bridged amount arrives short of the declared amount.
interface IFeeSponsor {
    function sponsor(uint256 amount) external;
}

/// @notice Same-chain direct delivery receiver, implemented by BridgeClient.
interface ILocalReceiver {
    function receiveLocal(uint256 amount, bytes calldata message) external;
}

interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

// The hook checks the receiver via IERC165 before delivery; supportsInterface must return true for this id.
interface IBridgeReceiver {
    receive() external payable;
    function receiveMessage(
        ChainIndex sourceChain,
        address sender,
        address token,
        uint256 amount,
        bytes calldata message
    ) external payable;
}

// Mirror of the bridge Socket structs (ABI-identical to Socket_Struct.sol) used to verify a message on recovery.
// Primitive types instead of the named value types: user-defined value types encode as their underlying
// type, so the hash matches.
struct SocketRequestID { bytes4 chain; uint64 round_id; uint128 sequence; }
struct SocketInstruction { bytes4 chain; bytes16 method; }
struct SocketTaskParams { bytes32 tokenIDX0; bytes32 tokenIDX1; address refund; address to; uint256 amount; bytes variants; }
struct SocketMessage { SocketRequestID req_id; uint8 status; SocketInstruction ins_code; SocketTaskParams params; }
struct SocketUserRequest { SocketInstruction ins_code; SocketTaskParams params; } // msg_hash = keccak256(abi.encode(this))
struct SocketRequestInfo { uint8[32] field; bytes32 msg_hash; uint256 registered_time; } // field[0] = current Task_Status

interface IHookSocket {
    function socket() external view returns (address); // HooksState.socket
}
interface IHookProcessed {
    function processedRequests(bytes32 ridPacked) external view returns (bool); // HooksState delivery mark
}
interface ISocketView {
    function get_request(SocketRequestID calldata rid) external view returns (SocketRequestInfo memory);
}
