// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { IRequestVault } from "../interfaces/IRequestVault.sol";
import { IRestrictedShare } from "../interfaces/IRestrictedShare.sol";

/// @title  TrancheBalances — computes IVaultCoordinator.trancheAssets (backs RequestVault.totalAssets).
/// @notice Public library (deployed separately, delegatecall-linked, same shape as AllocatorRegistry):
///         VaultCoordinator sits at the EIP-170 size limit, so even a few-line view must live outside it.
library TrancheBalances {
    /// @param vault          the tranche's vault (address(0) if not wired)
    /// @param lastSharePrice last finalized settlement price cached on this chain (WAD)
    function trancheAssets(address vault, uint256 lastSharePrice) public view returns (uint256) {
        if (vault == address(0)) return 0;
        uint256 supply = IRestrictedShare(IRequestVault(vault).share()).totalSupply();
        return lastSharePrice * supply / 1e18;
    }

}
