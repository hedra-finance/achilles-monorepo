// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { IYieldSource, Fulfillment } from "../interfaces/IYieldSource.sol";
import { WireCodec } from "../bridge/WireCodec.sol";

/// @notice Optional extension for basket-style sources (e.g. StockBasketSource). Implementing it makes the
///         settlement record carry real per-asset positions; sources without it fall back to a single
///         position (whole base asset, priceUsd = 1e18).
interface IMultiAssetSource { function assetPositions() external view returns (WireCodec.AssetPosition[] memory); }

/// @title  CapitalAllocator — splits one chain's capital across several yield sources and aggregates their valuation.
/// @notice A spoke instance holds the LocalAllocation cache (its own slice); a hub instance runs the same code
///         to spread the hub's share across sources. Only a controller (VaultCoordinator or HubRouter) may call.
///         Funds convention: for supply calls the controller approves `amount` first; this contract pulls it and
///         forwards per-source splits. Released funds flow source → this (controller = this) → caller.
///         The source list is assumed fixed by allocation.adapters; register/unregister is out of scope.
contract CapitalAllocator is Initializable {
    using SafeERC20 for IERC20;

    uint16 internal constant BPS = 10_000;

    IERC20 public asset; // set in initialize (proxy; immutable not possible)
    address public owner;
    address public controller;
    uint64 public localChainId;  // EVM chain id for AdapterValuation.chainId; shares a slot with controller

    struct LocalAllocation {
        uint256 weightsVersion; // +1 per weight change, independent of settlementId
        uint16  localShareBps;  // this chain's share (spoke only; unused on the hub instance)
        address[] adapters;
        uint16[]  weightBps;    // parallel to adapters, sums to 10_000
    }
    LocalAllocation internal _alloc;
    mapping(address adapter => uint256) public principalOf; // principal supplied per source (performance tracking)

    uint8 public constant TICKET_PAYOUT = 1;    // release for redemption payouts; realized funds ship at settlement
    uint8 public constant TICKET_REBALANCE = 2; // release for rebalancing; realized funds ship via NET_BRIDGE

    /// @dev ASYNC release ticket. adapter+purpose pack into one slot, four slots per ticket.
    ///      owner = initiator; realized funds go back only to the initiator (avoids misdelivery with two controllers).
    struct Ticket { address adapter; uint8 purpose; address owner; uint256 id; uint256 amount; }
    Ticket[] internal _tickets;

    mapping(address => uint256) public pendingWithdrawOf; // unrealized release liability per source; caps duplicate initiation
    /// @dev Additional controllers: on the hub, HubRouter and the coordinator both drive this allocator.
    mapping(address => bool) public isController;

    event AllocationSynced(uint256 weightsVersion, uint16 localShareBps);
    event Supplied(bytes32 indexed requestId, uint256 amount);                          // requestId = 0: not tied to a request (rebalance)
    event WithdrawRequested(bytes32 indexed requestId, uint256 requested, uint256 realizedNow); // requestId = 0: rebalance release
    event ReadyReceived(uint256 realized);

    error NotController();
    error NotOwner();
    error BadWeights();
    error StaleVersion();
    error LengthMismatch();

    modifier onlyController() { if (msg.sender != controller && msg.sender != owner && !isController[msg.sender]) revert NotController(); _; }
    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }

    constructor() { _disableInitializers(); } // implementation is only used behind UpgradeableProxy

    function initialize(address asset_, uint64 localChainId_) external initializer {
        asset = IERC20(asset_);
        owner = msg.sender;
        localChainId = localChainId_;
    }

    event ControllerSet(address controller);
    function setController(address c) external onlyOwner { controller = c; emit ControllerSet(c); }
    /// @notice Add or remove an extra controller (hub runs HubRouter and the coordinator side by side).
    event ControllerAllowed(address indexed who, bool allowed);
    function setControllerAllowed(address who, bool ok) external onlyOwner { isController[who] = ok; emit ControllerAllowed(who, ok); }

    // ──────────────────────────────────────────────────────────────
    // LocalAllocation — applied from ALLOCATION_SYNC or directly by the owner
    // ──────────────────────────────────────────────────────────────

    function syncAllocation(
        uint256 weightsVersion_,
        uint16 localShareBps,
        address[] calldata adapters_,
        uint16[] calldata weightBps_
    ) external onlyController {
        if (weightsVersion_ <= _alloc.weightsVersion && _alloc.weightsVersion != 0) revert StaleVersion();
        if (adapters_.length != weightBps_.length) revert LengthMismatch();
        uint256 sum;
        for (uint256 i = 0; i < weightBps_.length; i++) sum += weightBps_[i];
        if (sum != BPS) revert BadWeights();
        _alloc.weightsVersion = weightsVersion_;
        _alloc.localShareBps = localShareBps;
        _alloc.adapters = adapters_;
        _alloc.weightBps = weightBps_;
        emit AllocationSynced(weightsVersion_, localShareBps);
    }

    function allocation() external view returns (LocalAllocation memory) { return _alloc; }
    function weightsVersion() external view returns (uint256) { return _alloc.weightsVersion; }
    /// @dev This chain's share in bps; 0 means the controller never needs to supply or release locally (hub coordinator setup).
    function localShareBps() external view returns (uint16) { return _alloc.localShareBps; }

    // ──────────────────────────────────────────────────────────────
    // Supply
    // ──────────────────────────────────────────────────────────────

    /// @notice Supply only this chain's share of a deposit. Returns the local amount so the controller can
    ///         forward (total − localAmount) to the hub.
    function supplyLocalShare(uint256 totalAmount, bytes32 requestId) external onlyController returns (uint256 localAmount) {
        localAmount = totalAmount * _alloc.localShareBps / BPS;
        if (localAmount > 0) _supplySplit(localAmount, requestId);
    }

    /// @notice Supply the full amount across local weights (spoke receiving ADAPTER_SUPPLY, or hub share).
    function supplyAll(uint256 amount, bytes32 requestId) external onlyController {
        if (amount > 0) _supplySplit(amount, requestId);
    }

    function _supplySplit(uint256 amount, bytes32 requestId) internal {
        asset.safeTransferFrom(msg.sender, address(this), amount);
        uint256 n = _alloc.adapters.length;
        uint256 remaining = amount;
        for (uint256 i = 0; i < n; i++) {
            uint256 part = i == n - 1 ? remaining : amount * _alloc.weightBps[i] / BPS; // rounding remainder goes to the last source
            remaining -= part;
            if (part == 0) continue;
            asset.forceApprove(_alloc.adapters[i], part);
            IYieldSource(_alloc.adapters[i]).allocate(part, requestId, address(0), address(0));
            principalOf[_alloc.adapters[i]] += part;
        }
        emit Supplied(requestId, amount);
    }

    // ──────────────────────────────────────────────────────────────
    // Release (withdraw → receive)
    // ──────────────────────────────────────────────────────────────

    /// @notice Start releases from the given sources and amounts (ADAPTER_WITHDRAW, local pre-release, rebalance).
    ///         SYNC sources return realized funds immediately; ASYNC ones leave a ticket.
    function withdrawFor(address[] calldata adapters_, uint256[] calldata amounts, bytes32 requestId, uint8 ticketPurpose)
        external onlyController returns (uint256 realizedNow)
    {
        if (adapters_.length != amounts.length) revert LengthMismatch();
        uint256 requested;
        for (uint256 i = 0; i < adapters_.length; i++) {
            requested += amounts[i];
            (uint256 reqId, Fulfillment mode, uint256 realized) =
                IYieldSource(adapters_[i]).release(amounts[i], requestId, address(0), address(0));
            uint256 pr = principalOf[adapters_[i]];
            principalOf[adapters_[i]] = pr > amounts[i] ? pr - amounts[i] : 0;
            if (mode == Fulfillment.ASYNC) {
                _tickets.push(Ticket(adapters_[i], ticketPurpose, msg.sender, reqId, amounts[i])); // owner = where realized funds go
                pendingWithdrawOf[adapters_[i]] += amounts[i];
            } else {
                realizedNow += realized;
            }
        }
        if (realizedNow > 0) asset.safeTransfer(msg.sender, realizedNow); // to the initiator (multiple controllers)
        emit WithdrawRequested(requestId, requested, realizedNow);
    }

    /// @notice Start releasing this chain's share of a payout across local weights (redemption pre-release).
    function withdrawLocalShare(uint256 payoutNeeded, bytes32 requestId) external onlyController returns (uint256 initiated, uint256 realizedNow) {
        initiated = payoutNeeded * _alloc.localShareBps / BPS;
        if (initiated == 0) return (0, 0);
        uint256 n = _alloc.adapters.length;
        uint256 remaining = initiated;
        for (uint256 i = 0; i < n; i++) {
            uint256 part = i == n - 1 ? remaining : initiated * _alloc.weightBps[i] / BPS;
            remaining -= part;
            if (part == 0) continue;
            (uint256 reqId, Fulfillment mode, uint256 realized) =
                IYieldSource(_alloc.adapters[i]).release(part, requestId, address(0), address(0));
            uint256 pr = principalOf[_alloc.adapters[i]];
            principalOf[_alloc.adapters[i]] = pr > part ? pr - part : 0;
            if (mode == Fulfillment.ASYNC) {
                _tickets.push(Ticket(_alloc.adapters[i], TICKET_PAYOUT, msg.sender, reqId, part)); // release at request time = payout purpose
                pendingWithdrawOf[_alloc.adapters[i]] += part;
            }
            else realizedNow += realized;
        }
        if (realizedNow > 0) asset.safeTransfer(msg.sender, realizedNow); // to the initiator
        emit WithdrawRequested(requestId, initiated, realizedNow);
    }

    /// @notice Collect ready ASYNC tickets of one purpose and forward realized funds to the caller.
    ///         Separating purposes keeps payout funds and rebalance funds from contaminating each other's path.
    function receiveReady(uint8 purpose) external onlyController returns (uint256 realized) {
        uint256 n = _tickets.length;
        uint256 kept;
        for (uint256 i = 0; i < n; i++) {
            Ticket memory t = _tickets[i];
            bool done;
            if (t.purpose == purpose && t.owner == msg.sender && IYieldSource(t.adapter).isReady(t.id)) { // only the initiator collects
                // Non-fatal collect: one misbehaving source must not block the whole settlement trigger.
                // Failed tickets stay and are retried on the next sweep.
                try IYieldSource(t.adapter).collect(t.id) returns (uint256 got) {
                    realized += got; // realized → this (sources are configured with controller = this)
                    uint256 owed = pendingWithdrawOf[t.adapter];
                    pendingWithdrawOf[t.adapter] = owed > t.amount ? owed - t.amount : 0;
                    done = true;
                } catch {}
            }
            if (!done) _tickets[kept++] = t;
        }
        while (_tickets.length > kept) _tickets.pop();
        if (realized > 0) asset.safeTransfer(msg.sender, realized); // to the initiator
        emit ReadyReceived(realized);
    }

    function pendingWithdrawTicketCount() external view returns (uint256) { return _tickets.length; }

    /// @notice Nudge inner sources to process right before NAV aggregation; sources without `rebalance()` are skipped.
    ///         Needed because NAV collection is triggered manually rather than on the sources' own schedule.
    function pokeAdapters() external onlyController {
        for (uint256 i = 0; i < _alloc.adapters.length; i++) {
            _alloc.adapters[i].call(abi.encodeWithSignature("rebalance()"));
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Valuation — this chain's observed NAV (NAV response input)
    // ──────────────────────────────────────────────────────────────

    /// @notice Per-source valuation detail, attached to the NAV response and recorded by the hub.
    ///         Default: a single position in the base asset at priceUsd = 1e18. Sources implementing
    ///         IMultiAssetSource report their real per-asset positions instead.
    function adapterValuations() external view returns (WireCodec.AdapterValuation[] memory vals) {
        uint256 n = _alloc.adapters.length;
        vals = new WireCodec.AdapterValuation[](n);
        for (uint256 i = 0; i < n; i++) {
            address ad = _alloc.adapters[i];
            WireCodec.AssetPosition[] memory pos;
            try IMultiAssetSource(ad).assetPositions() returns (WireCodec.AssetPosition[] memory p) {
                pos = p;
            } catch {
                uint256 amt = IYieldSource(ad).totalAssets();
                pos = new WireCodec.AssetPosition[](1);
                pos[0] = WireCodec.AssetPosition(address(asset), amt, 1e18, amt, true);
            }
            vals[i] = WireCodec.AdapterValuation(localChainId, ad, 0, uint64(block.timestamp), principalOf[ad], pos);
        }
    }

    /// @notice This chain's observed NAV = Σ source totalAssets + cash held here (released funds in transit).
    function chainNav() external view returns (uint256 nav) {
        for (uint256 i = 0; i < _alloc.adapters.length; i++) {
            nav += IYieldSource(_alloc.adapters[i]).totalAssets();
        }
        nav += asset.balanceOf(address(this));
    }
}
