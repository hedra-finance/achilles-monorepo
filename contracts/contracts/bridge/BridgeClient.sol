// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IHook, IFeeSponsor, User_Request, Instruction, Task_Params, Variants, ChainIndex, RBCmethod, Asset_Index, IERC165, IBridgeReceiver, ILocalReceiver, SocketMessage } from "./BridgeTypes.sol";
import { BridgeRetry } from "./BridgeRetry.sol";

/// @title  BridgeClient
/// @notice Shared send/receive wiring for the bridge hook, inherited by HubRouter and VaultCoordinator.
///         Send: one `hook.request(User_Request)` call bridges assets and message together; message-only
///         tags carry the minimum transfer amount. Receive: the hook calls receiveMessage directly.
///         Routes (chain index, method, asset indexes) and fees are configured per product because the
///         hub router is one shared instance and products with different assets/decimals must coexist
///         against the same destination chain.
abstract contract BridgeClient is ReentrancyGuard, IERC165 {
    using SafeERC20 for IERC20;

    struct Route { bytes4 chainIndex; bytes16 method; bytes32 tok0; bytes32 tok1; bool set; }

    IHook  public hook;          // bridge hook: outbound entry and inbound caller
    IERC20 internal bridgeAsset;   // base asset; equals the derived contract's asset(), so no getter (EIP-170)
    uint64 public localChainId;  // EVM chainId of this deployment

    mapping(uint64 productId => mapping(uint64 dstChainId => Route)) public routeOf; // per product x destination
    mapping(bytes4 => uint64) internal chainIdOfIndex; // inbound ChainIndex -> chainId (network fact, product-agnostic)

    address public bridgeAdmin;

    // Message-only tags still carry a minimum amount (the live bridge rejects amount=0; fees/dust are
    // sponsored). MockBridge delivers amount=0, so local tests set 0 to keep dust out of NAV.
    mapping(uint64 productId => uint256) public minAmountOf; // per product, in asset decimals
    mapping(uint64 productId => uint256) public maxTxFeeOf;  // per product fee cap we sponsor

    error NotBridgeAdmin();
    error NotHook();
    error NoReceiver();
    error NoRoute();

    modifier onlyBridgeAdmin() { if (msg.sender != bridgeAdmin) revert NotBridgeAdmin(); _; }

    function _initBridge(address hook_, address asset_, uint64 localChainId_) internal {
        hook = IHook(hook_);
        bridgeAsset = IERC20(asset_);
        localChainId = localChainId_;
        bridgeAdmin = msg.sender;
    }

    // Indexer choke points for send/receive plus admin parameters. `message` is the raw WireCodec bytes.
    event MessageSent(uint64 indexed dstChainId, address indexed to, uint256 amount, bytes message);
    event MessageReceived(uint64 indexed srcChainId, address indexed sender, uint256 declared, uint256 received, bytes message);
    event RouteSet(uint64 indexed productId, uint64 indexed dstChainId, bytes4 chainIndex, bytes16 method, bytes32 tok0, bytes32 tok1);
    event MaxTxFeeSet(uint64 indexed productId, uint256 fee);
    event MinAmountSet(uint64 indexed productId, uint256 amount);

    /// @notice Registers the route for (product, destination chain) and the inbound ChainIndex reverse map.
    function setRoute(uint64 productId, uint64 dstChainId, bytes4 chainIndex, bytes16 method, bytes32 tok0, bytes32 tok1) external onlyBridgeAdmin {
        routeOf[productId][dstChainId] = Route(chainIndex, method, tok0, tok1, true);
        chainIdOfIndex[chainIndex] = dstChainId;
        emit RouteSet(productId, dstChainId, chainIndex, method, tok0, tok1);
    }
    function setMaxTxFee(uint64 productId, uint256 fee) external onlyBridgeAdmin { maxTxFeeOf[productId] = fee; emit MaxTxFeeSet(productId, fee); }
    function setMinAmount(uint64 productId, uint256 amount) external onlyBridgeAdmin { minAmountOf[productId] = amount; emit MinAmountSet(productId, amount); }

    /// @dev Outbound send. amount=0 (message-only) is raised to the product's minimum transfer amount.
    ///      A destination on this chain is delivered directly without the bridge; events and handler are
    ///      identical so the indexer does not need to tell the two paths apart.
    function _send(uint64 productId, uint64 dstChainId, address to, uint256 amount, bytes memory message) internal {
        if (to == address(0)) revert NoReceiver(); // never send assets to an unregistered destination
        if (dstChainId == localChainId) {
            // Local delivery has no fee or minimum, so declared == received == amount (0 stays 0).
            if (amount > 0) bridgeAsset.safeTransfer(to, amount);
            emit MessageSent(dstChainId, to, amount, message);
            ILocalReceiver(to).receiveLocal(amount, message);
            return;
        }
        Route memory r = routeOf[productId][dstChainId];
        if (!r.set) revert NoRoute();
        uint256 maxTxFee = maxTxFeeOf[productId];
        // Promote anything below the carrier minimum, not just zero. A bridge cannot carry a zero amount,
        // which is why the rule existed — but it also cannot carry less than the fee it charges, and a
        // small non-zero payout (a redemption's realised share) is rejected with
        // "insufficient amount for maxTxFee". Treating only zero as special left that gap open.
        uint256 min_ = minAmountOf[productId];
        uint256 amt = amount < min_ ? min_ : amount;
        bridgeAsset.forceApprove(address(hook), amt);
        // The declared amount travels with the message so the receiver can compare it against the
        // fee-reduced delivery and have the fee sponsor cover the gap (no-op when the bridge fee is 0).
        bytes memory variants = abi.encode(Variants({
            sender: address(this),
            receiver: to,
            refund: address(this),
            max_tx_fee: maxTxFee,
            message: abi.encode(amt, message)
        }));
        hook.request(maxTxFee, User_Request({
            ins_code: Instruction({ chain: ChainIndex.wrap(r.chainIndex), method: RBCmethod.wrap(r.method) }),
            params: Task_Params({
                tokenIDX0: Asset_Index.wrap(r.tok0),
                tokenIDX1: Asset_Index.wrap(r.tok1),
                refund: address(this),   // rollback refunds go back to the sending contract
                to: to,
                amount: amt,
                variants: variants
            })
        }));
        emit MessageSent(dstChainId, to, amt, message);
    }

    /// @notice Recovers a stuck message from its Socket_Message (as emitted by the Socket / hook ExecuteFailed).
    ///         The contract decides the failure type from the Socket status: Rollbacked means our send failed
    ///         and the payload is resent with the refunded assets; Executed + processed means delivery landed
    ///         but our handler reverted, so only the handler is re-run. Forgery is impossible because the
    ///         Socket's msg_hash is the reference. Once per req_id. The admin supplies productId so this base
    ///         does not need WireCodec. Observability is unchanged: resend emits MessageSent, re-handle MessageReceived.
    function recoverMessage(uint64 productId, SocketMessage calldata m) external onlyBridgeAdmin nonReentrant {
        (uint8 mode, bytes4 idx, address peer, uint256 amt, bytes memory message,) =
            BridgeRetry.verifyAndUnwrap(address(hook), _feeSponsor(), m); // verify, unwrap, fee top-up, idempotency mark
        uint64 chainId = chainIdOfIndex[idx];
        if (mode == 0) {
            _send(productId, chainId, peer, amt, message);
        } else {
            // Assets already arrived via the hook's manual execute; re-run the receive path with the declared amount.
            emit MessageReceived(chainId, peer, amt, amt, message);
            _handleMessage(chainId, peer, address(bridgeAsset), amt, message);
        }
    }

    /// @notice Same-chain delivery entry point, called directly by the sending contract.
    /// @dev    sender and source chain are fixed to msg.sender / localChainId, matching the trust level of the
    ///         hook's sender attestation. Authorization is decided by the inheriting handler.
    function receiveLocal(uint256 amount, bytes calldata message) external nonReentrant {
        emit MessageReceived(localChainId, msg.sender, amount, amount, message);
        _handleMessage(localChainId, msg.sender, address(bridgeAsset), amount, message);
    }

    /// @notice Bridge hook entry point (hook only). Maps ChainIndex to chainId and dispatches to the handler.
    function receiveMessage(ChainIndex sourceChain, address sender, address token, uint256 amount, bytes calldata message)
        external payable nonReentrant
    {
        if (msg.sender != address(hook)) revert NotHook();
        uint64 srcChainId = chainIdOfIndex[ChainIndex.unwrap(sourceChain)];
        // The hook passes the whole abi-encoded Variants as `message`; our payload is nested in v.message.
        // Parsing it as the raw payload would revert on the tag, fail gas estimation and drop the relay.
        Variants memory v = abi.decode(message, (Variants));
        (uint256 declared, bytes memory inner) = abi.decode(v.message, (uint256, bytes));
        // Fee top-up: if less than declared arrived, pull the gap from the fee sponsor and proceed with the
        // declared amount. Missing/empty sponsor is non-fatal; a 0 bridge fee makes this a no-op.
        uint256 received = amount;
        if (amount < declared) {
            address sp = _feeSponsor();
            if (sp != address(0)) {
                try IFeeSponsor(sp).sponsor(declared - amount) { amount = declared; } catch {}
            }
        }
        emit MessageReceived(srcChainId, sender, declared, received, inner);
        // Mark handled so recoverMessage refuses to re-run a normally processed message (the hook's
        // processedRequests cannot distinguish handler success from failure).
        BridgeRetry.markHandled(ChainIndex.unwrap(sourceChain), sender, declared, keccak256(inner));
        _handleMessage(srcChainId, sender, token, amount, inner);
    }

    /// @dev Derived contracts expose the sponsor from their own appended storage; adding slots here would
    ///      shift derived layouts.
    function _feeSponsor() internal view virtual returns (address) { return address(0); }

    /// @notice The hook checks IERC165 before delivery; without this the delivery leg is dropped.
    function supportsInterface(bytes4 interfaceId) external pure virtual override returns (bool) {
        return interfaceId == type(IBridgeReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    /// @dev Implemented by the inheriting contract: per-tag dispatch.
    function _handleMessage(uint64 srcChainId, address sender, address token, uint256 amount, bytes memory message) internal virtual;
}
