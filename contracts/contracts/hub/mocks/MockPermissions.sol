// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { WireCodec } from "../../bridge/WireCodec.sol";
import { HubRouter } from "../HubRouter.sol";

/// @title  MockPermissions — mock of the node's permissions precompile (0x…0202)
/// @notice Unified ProductAdmin / OracleFeeder / TrancheInvestor role surface (role parameter + VaultInput).
///         TrancheInvestor (whitelist) changes are recorded, then propagated to the spoke through HubRouter
///         in the same call, so record and propagation are atomic.
/// @dev    The investor whitelist is keyed globally by vault only (product_id is ignored), per the node spec;
///         ProductAdmin / OracleFeeder are scoped by productId.
contract MockPermissions {
    uint8 public constant ROLE_PRODUCT_ADMIN = 0;
    uint8 public constant ROLE_ORACLE_FEEDER = 1;
    uint8 public constant ROLE_TRANCHE_INVESTOR = 2;

    address public admin;
    HubRouter public orchestrator;

    struct VaultInput { uint64 chain_id; address vault_address; }

    // Source of truth: vault (chainId, addr) → who → allowed — global key, product independent.
    mapping(uint64 => mapping(address => mapping(address => bool))) public isInvestor;
    // productId → role (ProductAdmin, OracleFeeder only) → who → held
    mapping(uint256 => mapping(uint8 => mapping(address => bool))) public hasRoleOf;
    mapping(uint256 => address) public productAdmin; // stands in for the sudo pre-grant (admin assigns)

    event PermissionGranted(uint64 product_id, uint8 role, address who, uint64 vault_chain_id, address vault_address);
    event PermissionRevoked(uint64 product_id, uint8 role, address who, uint64 vault_chain_id, address vault_address);

    error NotAdmin();
    error NotProductAdmin();
    error ProductAdminNotGrantable(); // ProductAdmin cannot be granted through this precompile — sudo only
    error AlreadyGranted();
    error NotGranted();
    error UseIsTrancheInvestor();

    constructor(address orchestrator_) {
        admin = msg.sender;
        orchestrator = HubRouter(orchestrator_);
    }

    /// @notice Pre-grant ProductAdmin — on the real node this is a sudo/root extrinsic outside this interface. Call before create_product.
    function setProductAdmin(uint64 productId, address who) external {
        if (msg.sender != admin) revert NotAdmin();
        productAdmin[productId] = who;
    }

    function grant_permission(uint64 product_id, uint8 role, address who, VaultInput calldata vault) external {
        if (role == ROLE_PRODUCT_ADMIN) revert ProductAdminNotGrantable();
        if (msg.sender != productAdmin[product_id]) revert NotProductAdmin();
        if (role == ROLE_TRANCHE_INVESTOR) {
            if (isInvestor[vault.chain_id][vault.vault_address][who]) revert AlreadyGranted();
            isInvestor[vault.chain_id][vault.vault_address][who] = true;
        } else {
            if (hasRoleOf[product_id][role][who]) revert AlreadyGranted();
            hasRoleOf[product_id][role][who] = true;
        }
        emit PermissionGranted(product_id, role, who, vault.chain_id, vault.vault_address);
        _propagateIfSpoke(product_id, role, who, vault, WireCodec.ACTION_GRANT);
    }

    function revoke_permission(uint64 product_id, uint8 role, address who, VaultInput calldata vault) external {
        if (role == ROLE_PRODUCT_ADMIN) revert ProductAdminNotGrantable();
        if (msg.sender != productAdmin[product_id]) revert NotProductAdmin();
        if (role == ROLE_TRANCHE_INVESTOR) {
            if (!isInvestor[vault.chain_id][vault.vault_address][who]) revert NotGranted();
            isInvestor[vault.chain_id][vault.vault_address][who] = false;
        } else {
            if (!hasRoleOf[product_id][role][who]) revert NotGranted();
            hasRoleOf[product_id][role][who] = false;
        }
        emit PermissionRevoked(product_id, role, who, vault.chain_id, vault.vault_address);
        _propagateIfSpoke(product_id, role, who, vault, WireCodec.ACTION_REVOKE);
    }

    /// @dev Propagate through the router only for TrancheInvestor and only when the vault is not on the hub chain.
    function _propagateIfSpoke(uint64 product_id, uint8 role, address who, VaultInput calldata vault, uint8 action) internal {
        if (role != ROLE_TRANCHE_INVESTOR) return;
        if (vault.chain_id == orchestrator.localChainId()) return;
        orchestrator.sendWhitelist(vault.chain_id, product_id, vault.vault_address, who, action);
    }

    /// @dev product_id is kept for signature symmetry only — the lookup is by vault (globally unique), per the spec.
    function is_tranche_investor(uint64, VaultInput calldata vault, address who) external view returns (bool) {
        return isInvestor[vault.chain_id][vault.vault_address][who];
    }

    /// @dev ProductAdmin and OracleFeeder only — TrancheInvestor has no vault parameter here and reverts (use is_tranche_investor).
    function has_role(uint64 product_id, uint8 role, address who) external view returns (bool) {
        if (role == ROLE_TRANCHE_INVESTOR) revert UseIsTrancheInvestor();
        if (role == ROLE_PRODUCT_ADMIN) return productAdmin[product_id] == who;
        return hasRoleOf[product_id][role][who];
    }
}
