// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title  BridgeFeeSponsor — bridge/messaging fee sponsor pool (one per chain).
/// @notice When an asset-carrying message arrives short of its declared amount by the bridge fee, a registered
///         receiver (VaultCoordinator / HubRouter) tops up the shortfall from this pool, keeping accounting
///         exact against declared amounts. With zero fees the sponsor is never called.
///         Refill with `fund`, drain with `sweep`.
contract BridgeFeeSponsor is Initializable {
    using SafeERC20 for IERC20;

    IERC20  public asset;
    address public owner;
    mapping(address => bool) public clients; // receivers allowed to draw sponsorship

    event Sponsored(address indexed client, uint256 amount);

    error NotOwner();
    error NotClient();

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }

    constructor() { _disableInitializers(); } // implementation is only used behind UpgradeableProxy

    function initialize(address asset_) external initializer { asset = IERC20(asset_); owner = msg.sender; }

    event ClientSet(address indexed client, bool enabled);
    event Funded(address indexed from, uint256 amount);
    event Swept(address indexed to, uint256 amount);
    function setClient(address c, bool ok) external onlyOwner { clients[c] = ok; emit ClientSet(c, ok); }
    function fund(uint256 amt) external { asset.safeTransferFrom(msg.sender, address(this), amt); emit Funded(msg.sender, amt); }
    function sweep(address to, uint256 amt) external onlyOwner { asset.safeTransfer(to, amt); emit Swept(to, amt); }

    /// @notice Cover a receive shortfall (declared − actual). Clients only; reverts if the pool is short (caller catches).
    function sponsor(uint256 amount) external {
        if (!clients[msg.sender]) revert NotClient();
        asset.safeTransfer(msg.sender, amount);
        emit Sponsored(msg.sender, amount);
    }
}
