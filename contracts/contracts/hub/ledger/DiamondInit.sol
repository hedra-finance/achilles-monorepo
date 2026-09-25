// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { IDiamondCut } from "./interfaces/IDiamondCut.sol";
import { IDiamondLoupe } from "./interfaces/IDiamondLoupe.sol";
import { IERC173 } from "./interfaces/IERC173.sol";
import { LibDiamond } from "./libraries/LibDiamond.sol";

/// @title  DiamondInit — delegatecalled as the atomic `_init` of the constructor cut to register
///         ERC-165 supportedInterfaces (reference implementation). Uses type().interfaceId instead
///         of hard-coded constants.
contract DiamondInit {
    function init() external {
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        ds.supportedInterfaces[type(IERC165).interfaceId] = true;
        ds.supportedInterfaces[type(IDiamondCut).interfaceId] = true;
        ds.supportedInterfaces[type(IDiamondLoupe).interfaceId] = true;
        ds.supportedInterfaces[type(IERC173).interfaceId] = true;
    }
}
