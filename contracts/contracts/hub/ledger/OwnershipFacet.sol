// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { IERC173 } from "./interfaces/IERC173.sol";
import { LibDiamond } from "./libraries/LibDiamond.sol";

/// @title  OwnershipFacet — IERC173 ownership surface used by the EIP-2535 reference implementation
contract OwnershipFacet is IERC173 {
    function transferOwnership(address _newOwner) external override {
        LibDiamond.enforceIsContractOwner();
        LibDiamond.setContractOwner(_newOwner);
    }

    function owner() external view override returns (address owner_) {
        owner_ = LibDiamond.contractOwner();
    }
}
