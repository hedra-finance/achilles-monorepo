// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { IDiamond } from "./IDiamond.sol";

/// @title  IDiamondCut — EIP-2535 standard interface (reference implementation)
interface IDiamondCut is IDiamond {
    function diamondCut(
        FacetCut[] calldata _diamondCut,
        address _init,
        bytes calldata _calldata
    ) external;
}
