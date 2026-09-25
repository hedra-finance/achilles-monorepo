// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/// @title  IDiamond — shared EIP-2535 types (FacetCut, DiamondCut event)
/// @notice Ported from Nick Mudge's reference implementation (https://eips.ethereum.org/assets/eip-2535/reference/Diamond.sol,
///         CC0-1.0); relicensed MIT to match the project (CC0 permits relicensing).
interface IDiamond {
    enum FacetCutAction { Add, Replace, Remove }

    struct FacetCut {
        address facetAddress;
        FacetCutAction action;
        bytes4[] functionSelectors;
    }

    event DiamondCut(FacetCut[] _diamondCut, address _init, bytes _calldata);
}
