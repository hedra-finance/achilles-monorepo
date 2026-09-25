// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/// @title  IERC173 — contract ownership standard (used for diamond ownership by the EIP-2535 reference)
interface IERC173 {
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    function owner() external view returns (address owner_);
    function transferOwnership(address _newOwner) external;
}
