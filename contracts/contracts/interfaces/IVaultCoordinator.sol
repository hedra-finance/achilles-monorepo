// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/// @title  IVaultCoordinator — callbacks and views the RequestVault uses on the coordinator.
/// @dev    The vault transfers assets/shares to the coordinator first, then calls request*.
///         The coordinator identifies the tranche by msg.sender (the vault).
interface IVaultCoordinator {
    // Vault → coordinator (msg.sender = vault)
    function requestDeposit(address controller, address owner, uint256 assets) external;
    function requestRedeem(address controller, address owner, uint256 shares) external;
    function claimDeposit(address controller, address receiver) external returns (uint256 shares);
    function claimRedeem(address controller, address receiver) external returns (uint256 assets);
    function cancelDeposit(address controller) external returns (uint256 refundedAssets);
    function cancelRedeem(address controller) external returns (uint256 shares);

    // Views
    function pendingDepositRequest(uint8 tranche, address controller) external view returns (uint256 assets);
    function claimableDepositShares(uint8 tranche, address controller) external view returns (uint256 shares);
    function claimableDepositAssets(uint8 tranche, address controller) external view returns (uint256 assets);
    function pendingRedeemRequest(uint8 tranche, address controller) external view returns (uint256 shares);
    function claimableRedeemAssets(uint8 tranche, address controller) external view returns (uint256 assets);
    function claimableRedeemShares(uint8 tranche, address controller) external view returns (uint256 shares);
    function trancheAssets(uint8 tranche) external view returns (uint256);
    /// @notice ERC-7575 reverse lookup — entry vault for (share, asset); 0 if unregistered or asset mismatch.
    function vaultFor(address share, address asset) external view returns (address);
}
