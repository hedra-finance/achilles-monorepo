// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC1404 } from "../../interfaces/IRestrictedShare.sol";

/// @title  ERC1404 — plain EIP-1404 (Simple Restricted Token Standard) base.
/// @notice Exactly what the standard defines:
///         - detectTransferRestriction / messageForTransferRestriction (codes and reasons are defined by the subclass)
///         - transfer/transferFrom revert with the reason string when the code is non-zero.
///         No customization lives here; tranche wiring, hooks and mint restrictions belong in RestrictedShare.
/// @dev    Same modifier pattern as the EIP-1404 reference implementation. The standard covers only
///         transfer/transferFrom, so mint/burn are out of scope for this base.
abstract contract ERC1404 is ERC20, IERC1404 {
    function detectTransferRestriction(address from, address to, uint256 value) public view virtual returns (uint8);
    function messageForTransferRestriction(uint8 restrictionCode) public view virtual returns (string memory);

    modifier notRestricted(address from, address to, uint256 value) {
        uint8 code = detectTransferRestriction(from, to, value);
        require(code == 0, messageForTransferRestriction(code));
        _;
    }

    function transfer(address to, uint256 value) public virtual override notRestricted(msg.sender, to, value) returns (bool) {
        return super.transfer(to, value);
    }

    function transferFrom(address from, address to, uint256 value) public virtual override notRestricted(from, to, value) returns (bool) {
        return super.transferFrom(from, to, value);
    }
}
