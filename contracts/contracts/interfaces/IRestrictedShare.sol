// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title  IRestrictedShare — tranche share token (ERC20 + transfer hook). Only the coordinator may mint/burn.
interface IRestrictedShare is IERC20 {
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
    /// @notice Called by the coordinator when the vault link changes; the share emits ERC-7575 `VaultUpdate`.
    function notifyVaultUpdate(address asset, address vault) external;
}

/// @notice Transfer-restriction hook — the share token's single compliance attachment point. 0 = allowed, else a restriction code.
/// @dev    ERC-1404 detect/message views delegate here. An ERC-3643 setup wraps compliance.canTransfer +
///         identityRegistry.isVerified behind this interface without touching the token.
///         from == address(0) is a mint check; burns bypass the hook.
interface ITransferHook {
    function checkTransfer(address from, address to, uint256 amount) external view returns (uint8);
    function messageFor(uint8 code) external view returns (string memory);
}

/// @notice ERC-1404 standard surface — lets wallets and integrators query restrictions before transferring.
interface IERC1404 {
    function detectTransferRestriction(address from, address to, uint256 value) external view returns (uint8);
    function messageForTransferRestriction(uint8 restrictionCode) external view returns (string memory);
}
