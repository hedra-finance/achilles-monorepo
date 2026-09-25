// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/// @notice Fulfillment mode: SYNC settles in the same tx, ASYNC returns a ticket to collect later.
enum Fulfillment { SYNC, ASYNC }

/// @title  IYieldSource
/// @notice Boundary between the allocator and a single yield source (one protocol). The allocator talks to
///         sources only through this interface, so adding a source means one new implementation.
/// @dev    Each direction declares SYNC or ASYNC. The mode is a property of the source (can it settle now);
///         the allocator's own mode is policy, and policy may not be faster than the source.
///
///         Custody convention (transfer-then-call):
///         - Before allocate, the controller approves/transfers `assets` to the source.
///         - On release confirmation (SYNC release or collect) the source transfers the realized assets to the controller.
///         - totalAssets includes open allocations and releases.
interface IYieldSource {
    /// @notice Human-readable source name for operator UIs; not used on-chain.
    function name() external view returns (string memory);

    /// @notice Underlying asset handled by this source.
    function asset() external view returns (address);

    /// @notice Allocates to the source. SYNC completes here; ASYNC returns `reqId` to confirm via isReady/collect.
    /// @param  user      account the request belongs to (the controller for user deposits, address(0) for
    ///         operator moves such as rebalance/drain). Only sources that record investors externally use it.
    /// @param  vault     entry vault (tranche identity) or address(0) for operator moves. Recording only.
    /// @param  requestId pallet request id, 0 for operator moves. Sources track their own reqId; this is for tracing.
    function allocate(uint256 assets, bytes32 requestId, address user, address vault) external returns (uint256 reqId, Fulfillment mode);

    /// @notice Releases from the source. SYNC transfers `realized` to the controller now; ASYNC returns only `reqId`.
    ///         `user`/`vault`/`requestId` have the same meaning as in allocate.
    function release(uint256 assets, bytes32 requestId, address user, address vault) external returns (uint256 reqId, Fulfillment mode, uint256 realized);

    /// @notice Whether an ASYNC request is ready to collect.
    function isReady(uint256 reqId) external view returns (bool);

    /// @notice Confirms an ASYNC request. Allocation: returns accepted assets. Release: transfers realized to the controller and returns it.
    function collect(uint256 reqId) external returns (uint256 realized);

    /// @notice Collects several requests; returns the sum. Reverts entirely if any is not ready.
    function collectBatch(uint256[] calldata reqIds) external returns (uint256 totalRealized);

    /// @notice Open request ids (operator view; always empty for all-SYNC sources), overall and per direction.
    function openRequests() external view returns (uint256[] memory reqIds);
    function openAllocations() external view returns (uint256[] memory reqIds);
    function openReleases() external view returns (uint256[] memory reqIds);

    /// @notice Current value (principal + unrealized yield, including open requests). Input to NAV.
    function totalAssets() external view returns (uint256);
}
