// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import { ITransferHook } from "../interfaces/IRestrictedShare.sol";

/// @title  AllowlistHook — per-vault allowlist, a spoke-side replica of the hub permissions registry.
/// @notice Registry is `allowed[vault][who]`, so one hook per chain isolates every tranche vault.
///         When a share calls checkTransfer, msg.sender (the share) maps to its vault and only that
///         vault's registry is consulted. Key shape mirrors the hub pallet (vault-scoped) so replication
///         is a straight copy. Deployed behind UpgradeableProxy.
contract AllowlistHook is Initializable, ITransferHook {
    uint8 public constant SENDER_NOT_ALLOWED = 1;
    uint8 public constant RECEIVER_NOT_ALLOWED = 2;

    address public owner;
    address public writer; // VaultCoordinator — applies WHITELIST_SYNC messages

    mapping(address vault => mapping(address who => bool)) public allowed; // per-vault registry (same key shape as the pallet)
    mapping(address share => address vault) public vaultOfShare;           // checkTransfer caller (share) → vault
    mapping(address => bool) public exempt;                                // system addresses (coordinator escrow etc.) pass for every vault

    event AllowedSet(address indexed vault, address indexed account, bool allowed);
    event ExemptSet(address indexed account, bool exempt);
    event ShareVaultSet(address indexed share, address indexed vault);

    error NotOwner();
    error NotWriter();
    error ZeroAddress();

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }

    constructor() { _disableInitializers(); } // implementation is only used behind UpgradeableProxy

    function initialize(address owner_) external initializer {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
    }

    // ── ITransferHook ── (0 = allowed; from == 0 is a mint, so only the receiver is checked)
    function checkTransfer(address from, address to, uint256) external view returns (uint8) {
        address vault = vaultOfShare[msg.sender];
        if (from != address(0) && !allowed[vault][from] && !exempt[from]) return SENDER_NOT_ALLOWED;
        if (!allowed[vault][to] && !exempt[to]) return RECEIVER_NOT_ALLOWED;
        return 0;
    }

    function messageFor(uint8 code) external pure returns (string memory) {
        if (code == SENDER_NOT_ALLOWED) return "AllowlistHook: sender not whitelisted";
        if (code == RECEIVER_NOT_ALLOWED) return "AllowlistHook: receiver not whitelisted";
        return "";
    }

    /// @notice Per-user request capacity, asked by RequestVault before it takes a depositor's funds.
    /// @dev    This product caps nobody, so every request is admitted. The function exists because the vault
    ///         probes for it with a low-level call and reads a failed call as "no gate": the behaviour was
    ///         already correct, but a call to a function that does not exist reverts, and that left an
    ///         [execution reverted] frame on every single deposit for explorers to flag. Returning true is
    ///         exactly what the missing function produced, so nothing about admission changes here.
    ///         A real cap would keep the same signature and record against (vault, who).
    function consumeCapacity(address vault, address who, uint256 amount) external pure returns (bool) {
        vault; who; amount;
        return true;
    }

    // ── WHITELIST_SYNC application — writer only, per-vault grant/revoke ──
    // Ordering (propagation nonce) is enforced by the writer; the hook only records final state.
    // The nonce is already emitted in the coordinator's WhitelistApplied in the same tx, so it is not repeated here.
    function applyWhitelist(address vault, address who, bool grant) external {
        if (msg.sender != writer) revert NotWriter();
        allowed[vault][who] = grant;
        emit AllowedSet(vault, who, grant);
    }

    // ── registry admin (owner) ──
    event WriterSet(address writer);
    function setWriter(address w) external onlyOwner { writer = w; emit WriterSet(w); }
    function setShareVault(address share, address vault) external onlyOwner {
        vaultOfShare[share] = vault;
        emit ShareVaultSet(share, vault);
    }
    function setAllowed(address vault, address[] calldata accounts, bool isAllowed) external onlyOwner {
        for (uint256 i; i < accounts.length; i++) {
            allowed[vault][accounts[i]] = isAllowed;
            emit AllowedSet(vault, accounts[i], isAllowed);
        }
    }
    function setExempt(address[] calldata accounts, bool isExempt) external onlyOwner {
        for (uint256 i; i < accounts.length; i++) {
            exempt[accounts[i]] = isExempt;
            emit ExemptSet(accounts[i], isExempt);
        }
    }
}
