// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { BridgeClient } from "../bridge/BridgeClient.sol";
import { WireCodec } from "../bridge/WireCodec.sol";

interface IHubPayoutSink { function receivePayoutLocal(uint64 productId, uint256 amount) external; }

interface ISpokeCoordinator {
    function onBridgeMessage(uint64 productId, uint64 sourceChain, uint256 amount, bytes calldata message) external;
}

/// @title  SpokeRouter — the spoke's single bridge endpoint, shared by every product
/// @notice Mirror of HubRouter on the other side of the wire. One deployment per chain owns the bridge
///         wiring — routes, carrier minimums, fee sponsor, the hook — and forwards to the chain's
///         VaultCoordinator with the productId attached, instead of every product deploying its own
///         endpoint.
/// @dev    Splitting this out is also what makes a multi-product coordinator possible at all: the bridge
///         wiring is ~6.8KB of the coordinator's former 24.5KB, and EIP-170 left it six bytes of room.
///
///         The pallet must register THIS address as the chain's tranche manager. The hub authenticates an
///         inbound message by comparing its sender against the registered manager, and addresses its own
///         sends to the same entry, so the coordinator is never the counterpart the hub sees.
contract SpokeRouter is Initializable, BridgeClient {
    using SafeERC20 for IERC20;

    address public owner;
    address public coordinator;    // the chain's VaultCoordinator; the only contract that may send
    address public feeSponsorHook; // covers inbound shortfalls (BridgeClient._feeSponsor)
    uint64 public hubChainId;
    address public hubRouter;      // the hub's endpoint: the only authenticated sender

    event CoordinatorSet(address coordinator);
    event FeeSponsorHookSet(address hook);
    event HubSet(uint64 chainId, address router);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    /// @dev Inbound message accepted and handed to the coordinator. The wire-level MessageReceived comes
    ///      from BridgeClient; this records which product the assets and payload were attributed to.
    event Routed(uint64 indexed productId, uint64 sourceChain, uint256 amount, uint8 tag);

    error NotOwner();
    error NotCoordinator();
    error NotHubRouter();
    error NoCoordinator();
    error UnknownProduct();

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }

    constructor() { _disableInitializers(); }

    function initialize(address hook_, address asset_, uint64 localChainId_, uint64 hubChainId_, address hubRouter_)
        external
        initializer
    {
        _initBridge(hook_, asset_, localChainId_);
        owner = msg.sender;
        hubChainId = hubChainId_;
        hubRouter = hubRouter_;
        emit OwnershipTransferred(address(0), msg.sender);
        emit HubSet(hubChainId_, hubRouter_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert NotOwner();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setCoordinator(address c) external onlyOwner {
        coordinator = c;
        emit CoordinatorSet(c);
    }

    function setFeeSponsorHook(address h) external onlyOwner {
        feeSponsorHook = h;
        emit FeeSponsorHookSet(h);
    }

    function setHub(uint64 chainId, address router) external onlyOwner {
        hubChainId = chainId;
        hubRouter = router;
        emit HubSet(chainId, router);
    }

    // ── Outbound ──

    /// @notice Sends on the coordinator's behalf. The coordinator keeps custody of product assets and
    ///         approves this contract, so nothing sits here between messages.
    /// @dev    Anything below the carrier minimum ships as the minimum, so the asset to pull is the promoted
    ///         amount rather than the requested one. The promotion rule has to match BridgeClient exactly:
    ///         pulling less than it sends leaves the send short, pulling more strands the difference here.
    function send(uint64 productId, uint64 dstChainId, address to, uint256 amount, bytes calldata message) external {
        if (msg.sender != coordinator) revert NotCoordinator();
        uint256 need = amount;
        if (dstChainId != localChainId) {
            uint256 min_ = minAmountOf[productId];
            if (need < min_) need = min_;
        }
        if (need > 0) bridgeAsset.safeTransferFrom(coordinator, address(this), need);
        _send(productId, dstChainId, to, amount, message);
    }

    /// @notice Hands realized redemption proceeds to the hub on the same chain, on the coordinator's behalf.
    /// @dev    The hub accepts this only from the address it has registered as the chain's manager, which is
    ///         this contract — so a hub-resident product has to pay out through here, not from the coordinator.
    function payoutLocal(uint64 productId, uint256 amount) external {
        if (msg.sender != coordinator) revert NotCoordinator();
        if (amount > 0) bridgeAsset.safeTransferFrom(coordinator, address(this), amount);
        bridgeAsset.forceApprove(hubRouter, amount);
        IHubPayoutSink(hubRouter).receivePayoutLocal(productId, amount);
    }

    // ── Inbound ──

    /// @dev Authentication is the hub's address, not the product's: on this side every product shares one
    ///      counterpart. The productId then decides attribution, and the coordinator — which holds the
    ///      per-product ledger — rejects a product it does not know.
    function _handleMessage(uint64 sourceChain, address sender, address, uint256 amount, bytes memory message)
        internal
        override
    {
        if (sender != hubRouter || sourceChain != hubChainId) revert NotHubRouter();
        address c = coordinator;
        if (c == address(0)) revert NoCoordinator();

        WireCodec.Envelope memory p = WireCodec.decode(message);
        if (p.productId == 0) revert UnknownProduct();

        // Assets move with the message so the coordinator can book them against the product in the same
        // call. Holding them here would need a second custody ledger for no benefit.
        if (amount > 0) bridgeAsset.safeTransfer(c, amount);
        emit Routed(p.productId, sourceChain, amount, p.kind);
        ISpokeCoordinator(c).onBridgeMessage(p.productId, sourceChain, amount, message);
    }

    function _feeSponsor() internal view override returns (address) { return feeSponsorHook; }

    /// @notice Recovers assets that arrived without a usable message. Product funds live in the coordinator,
    ///         so anything resting here is carrier dust or a refund.
    function sweep(address to, uint256 amount) external onlyOwner {
        bridgeAsset.safeTransfer(to, amount);
    }
}
