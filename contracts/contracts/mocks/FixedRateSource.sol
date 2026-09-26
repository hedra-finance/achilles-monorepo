// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { IYieldSource, Fulfillment } from "../interfaces/IYieldSource.sol";
import { WireCodec } from "../bridge/WireCodec.sol";

/// @title  FixedRateSource
/// @notice Test yield source with a configurable APR and per-direction SYNC/ASYNC modes (setModes).
///         Assets are held idle; minting asset to this contract simulates gains, simulateLoss simulates losses.
///         totalAssets = balance + virtual interest. Interest accrues on the balance held since the last
///         checkpoint and is locked into `accruedInterest` on every allocate/release/collect, so a principal
///         withdrawal cannot erase interest already earned (accruing on the live balance would make NAV drop
///         by more than the withdrawn amount and push the loss onto the junior tranche). apr = 0 keeps
///         totalAssets equal to the balance for deterministic tests. Interest is virtual: paying it out
///         requires pre-funding. No access control.
/// @dev    Upgradeable behind UpgradeableProxy.
contract FixedRateSource is Initializable, IYieldSource {
    using SafeERC20 for IERC20;

    IERC20 public assetToken;
    address public controller;
    Fulfillment public supplyMode;
    Fulfillment public withdrawMode;

    struct P { uint8 kind; uint256 amount; bool ready; bool claimed; } // kind: 1 = allocation, 2 = release
    uint256 public nextId;
    mapping(uint256 => P) public pend;

    address public lastSupplyUser;   // last allocation's user (test observation)
    address public lastSupplyVault;  // last allocation's entry vault
    address public lastWithdrawVault;
    address public lastWithdrawUser; // last release's user
    mapping(uint256 => address) public userOf; // user per ASYNC ticket

    uint256 internal constant WAD_ = 1e18;
    uint256 internal constant YEAR_ = 365 days;

    uint256 public aprWad;          // annual rate (WAD, e.g. 5% = 0.05e18)
    uint256 public accruedInterest; // virtual interest locked in by checkpoints
    uint64  public lastAccrue;      // last checkpoint timestamp

    constructor() {
        _disableInitializers(); // implementation is only used behind a proxy
    }

    function initialize(address asset_) public initializer {
        assetToken = IERC20(asset_);
        nextId = 1;
        lastAccrue = uint64(block.timestamp);
    }

    function setController(address c) external { controller = c; }
    function setModes(Fulfillment d, Fulfillment w) external { supplyMode = d; withdrawMode = w; }
    function setReady(uint256 id) external { pend[id].ready = true; }

    function name() external view virtual returns (string memory) { return "Mock Yield Adapter"; }
    function asset() external view returns (address) { return address(assetToken); }

    /// @dev Locks in interest for the balance held since the last checkpoint and resets the clock. Called
    ///      before any balance change so the accrual base matches the principal actually held over the period.
    function _checkpoint() internal {
        uint256 dt = block.timestamp - lastAccrue;
        if (dt > 0 && aprWad > 0) {
            uint256 bal = assetToken.balanceOf(address(this));
            accruedInterest += (bal * aprWad * dt) / (WAD_ * YEAR_);
        }
        lastAccrue = uint64(block.timestamp);
    }

    /// @notice Sets the APR. Interest so far is checkpointed first, so the new rate is not applied retroactively.
    function setApr(uint256 aprWad_) external {
        _checkpoint();
        aprWad = aprWad_;
    }

    function allocate(uint256 assets, bytes32, address user, address vault) public returns (uint256, Fulfillment) {
        _checkpoint(); // interest on the pre-deposit balance is locked in; new principal accrues from now
        assetToken.safeTransferFrom(msg.sender, address(this), assets); // pull the controller's approval
        lastSupplyUser = user; lastSupplyVault = vault;
        if (supplyMode == Fulfillment.SYNC) return (0, Fulfillment.SYNC); // pulled = allocated
        uint256 id = nextId++;
        pend[id] = P(1, assets, false, false);
        userOf[id] = user;
        return (id, Fulfillment.ASYNC);
    }

    function release(uint256 assets, bytes32, address user, address vault) public returns (uint256, Fulfillment, uint256) {
        _checkpoint(); // lock in interest on the pre-withdrawal balance
        lastWithdrawUser = user; lastWithdrawVault = vault;
        if (withdrawMode == Fulfillment.SYNC) {
            assetToken.safeTransfer(controller, assets);
            return (0, Fulfillment.SYNC, assets);
        }
        uint256 id = nextId++;
        pend[id] = P(2, assets, false, false);
        userOf[id] = user;
        return (id, Fulfillment.ASYNC, 0);
    }

    function isReady(uint256 id) external view returns (bool) { return pend[id].ready; }

    function collect(uint256 id) public returns (uint256) {
        _checkpoint(); // same before an ASYNC release transfer
        P storage p = pend[id];
        require(p.ready && !p.claimed, "not ready");
        p.claimed = true;
        if (p.kind == 2) assetToken.safeTransfer(controller, p.amount); // release confirmed -> controller
        return p.amount;
    }

    function collectBatch(uint256[] calldata ids) external returns (uint256 total) {
        for (uint256 i; i < ids.length; i++) total += collect(ids[i]);
    }

    function openRequests() external view returns (uint256[] memory) { return _pending(0); }
    function openAllocations() external view returns (uint256[] memory) { return _pending(1); }
    function openReleases() external view returns (uint256[] memory) { return _pending(2); }

    function _pending(uint8 kind) internal view returns (uint256[] memory ids) {
        uint256 n = nextId; uint256 cnt;
        for (uint256 i = 1; i < n; i++) if (pend[i].kind != 0 && !pend[i].claimed && (kind == 0 || pend[i].kind == kind)) cnt++;
        ids = new uint256[](cnt); uint256 j;
        for (uint256 i = 1; i < n; i++) if (pend[i].kind != 0 && !pend[i].claimed && (kind == 0 || pend[i].kind == kind)) ids[j++] = i;
    }

    function totalAssets() external view returns (uint256) {
        return _totalAssets();
    }

    function _totalAssets() internal view returns (uint256) {
        uint256 bal = assetToken.balanceOf(address(this));
        if (aprWad == 0) return bal;
        uint256 dt = block.timestamp - lastAccrue;
        uint256 pending = (bal * aprWad * dt) / (WAD_ * YEAR_); // not yet checkpointed
        return bal + accruedInterest + pending;
    }

    /// @notice Loss simulation: moves assets out to lower the valuation.
    function simulateLoss(address to, uint256 amount) external { assetToken.safeTransfer(to, amount); }

    /// @notice Responds to the allocator's rebalance() poke before NAV collection by checkpointing pending
    ///         interest. NAV is unchanged either way (totalAssets adds the uncheckpointed part); this avoids a
    ///         reverted call frame in every collection tx.
    function rebalance() external { _checkpoint(); }

    /// @notice IMultiAssetSource: single base-asset position at priceUsd = 1e18, identical to the allocator's
    ///         fallback but without the reverted probe frame.
    function assetPositions() external view returns (WireCodec.AssetPosition[] memory pos) {
        uint256 amt = _totalAssets();
        pos = new WireCodec.AssetPosition[](1);
        pos[0] = WireCodec.AssetPosition(address(assetToken), amt, 1e18, amt, true);
    }
}
