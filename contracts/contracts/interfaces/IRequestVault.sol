// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/// @title  IRequestVault — tranche entry point (ERC-7540/7575). No mint authority; delegates to the coordinator.
/// @dev    The coordinator derives the share token via `share()` instead of hardcoding it.
interface IRequestVault {
    function asset() external view returns (address);
    function share() external view returns (address);
    function tranche() external view returns (uint8);
    function totalAssets() external view returns (uint256);
}
