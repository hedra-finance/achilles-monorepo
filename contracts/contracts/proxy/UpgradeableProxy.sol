// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.2.0) (proxy/ERC1967/ERC1967Proxy.sol)

pragma solidity ^0.8.21;

import { Proxy } from "@openzeppelin/contracts/proxy/Proxy.sol";
import { ERC1967Utils } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";

/**
 * @title UpgradeableProxy
 * @dev ERC-1967 upgradeable proxy with an on-chain admin. Calls are delegated to an implementation address
 * stored at the ERC-1967 slot (https://eips.ethereum.org/EIPS/eip-1967), so it never collides with the
 * implementation's storage layout. Only the admin may upgrade or transfer admin rights.
 */
contract UpgradeableProxy is Proxy {
    modifier onlyAdmin() {
        require(msg.sender == _admin(), "Proxy: Not admin");
        _;
    }

    constructor(address _newAdmin) {
        require(_newAdmin != address(0), "Proxy: Admin cannot be zero address");

        ERC1967Utils.changeAdmin(_newAdmin);
    }

    function transferAdmin(address _newAdmin) external onlyAdmin {
        ERC1967Utils.changeAdmin(_newAdmin);
    }

    function upgradeToAndCall(address _newImplementation, bytes memory _data) external payable onlyAdmin {
        ERC1967Utils.upgradeToAndCall(_newImplementation, _data);
    }

    function upgradeTo(address _newImplementation) external onlyAdmin {
        ERC1967Utils.upgradeToAndCall(_newImplementation, bytes(""));
    }

    function getAdmin() external view returns (address) {
        return _admin();
    }


    function getImplementation() external view returns (address) {
        return _implementation();
    }

    function _admin() internal view returns (address) {
        return ERC1967Utils.getAdmin();
    }

    /**
     * @dev Returns the current implementation address.
     */
    function _implementation() internal view override returns (address) {
        return ERC1967Utils.getImplementation();
    }

    receive() external payable {}
}
