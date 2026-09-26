// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { ERC1404 } from "./ERC1404.sol";
import { IRestrictedShare, ITransferHook, IERC1404 } from "../../interfaces/IRestrictedShare.sol";
import { IVaultCoordinator } from "../../interfaces/IVaultCoordinator.sol";

/// @title  RestrictedShare — ERC1404 base plus tranche-specific behavior (default share token).
/// @notice Additions over plain ERC1404:
///         1. Restriction checks delegate to a swappable hook (ITransferHook) set via setHook; no hook = unrestricted.
///         2. Mints are also gated by the hook (the standard only covers transfers). Burns are always allowed.
///         3. Core integration: only the coordinator mints/burns (settlement); ERC-7575 share side (vault lookup, VaultUpdate).
///         4. ERC-1967 proxy initialize pattern (name/symbol stored, not constructor-set).
contract RestrictedShare is Initializable, ERC1404, IRestrictedShare, IERC165 {
    // Proxy storage: base ERC20 name/symbol are set in the implementation constructor, so they are overridden here.
    string private _nameStored;
    string private _symbolStored;
    uint8 private _dec;

    address public owner;      // admin: sets hook/manager
    address public manager;    // mint/burn authority (settlement)
    ITransferHook public hook; // optional restriction hook; unset = free transfers

    event ManagerUpdated(address manager);
    event HookUpdated(address hook);
    event VaultUpdate(address indexed asset, address vault); // ERC-7575 share-side event

    error NotOwner();
    error NotManager();
    error ZeroAddress();
    error TransferRestricted(uint8 code); // raised on the mint-gate path

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }

    constructor() ERC20("", "") {
        _disableInitializers(); // implementation is only used behind UpgradeableProxy
    }

    function initialize(string memory name_, string memory symbol_, uint8 decimals_, address owner_, address manager_)
        external initializer
    {
        if (owner_ == address(0) || manager_ == address(0)) revert ZeroAddress();
        _nameStored = name_;
        _symbolStored = symbol_;
        _dec = decimals_;
        owner = owner_;
        manager = manager_;
    }

    function name() public view override returns (string memory) { return _nameStored; }
    function symbol() public view override returns (string memory) { return _symbolStored; }
    function decimals() public view override returns (uint8) { return _dec; }

    // ── 1. ERC-1404 checks delegate to the hook ──

    function detectTransferRestriction(address from, address to, uint256 value) public view override returns (uint8) {
        if (address(hook) == address(0)) return 0;
        return hook.checkTransfer(from, to, value);
    }

    function messageForTransferRestriction(uint8 restrictionCode) public view override returns (string memory) {
        if (restrictionCode == 0 || address(hook) == address(0)) return "";
        return hook.messageFor(restrictionCode);
    }

    // ── 2. Mints go through the hook as well; burns always pass ──

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) && to != address(0) && address(hook) != address(0)) {
            uint8 code = hook.checkTransfer(from, to, value);
            if (code != 0) revert TransferRestricted(code);
        }
        super._update(from, to, value);
    }

    // ── 3. Core integration: coordinator mint/burn + ERC-7575 share ──

    function mint(address to, uint256 amount) external {
        if (msg.sender != manager) revert NotManager();
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        if (msg.sender != manager) revert NotManager();
        _burn(from, amount);
    }

    /// @notice Entry vault for this share and `asset`; delegates to the coordinator's reverse lookup (0 if none).
    function vault(address asset) external view returns (address) {
        return IVaultCoordinator(manager).vaultFor(address(this), asset);
    }

    /// @notice Called by the coordinator when the vault link changes; emits ERC-7575 VaultUpdate.
    function notifyVaultUpdate(address asset, address vault_) external {
        if (msg.sender != manager) revert NotManager();
        emit VaultUpdate(asset, vault_);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC165).interfaceId
            || interfaceId == 0xf815c03d              // ERC-7575 share
            || interfaceId == type(IERC1404).interfaceId;
    }

    // ── admin ──

    function setManager(address m) external onlyOwner {
        if (m == address(0)) revert ZeroAddress();
        manager = m;
        emit ManagerUpdated(m);
    }

    function setHook(address h) external onlyOwner {
        hook = ITransferHook(h);
        emit HookUpdated(h);
    }

    function transferOwnership(address o) external onlyOwner {
        if (o == address(0)) revert ZeroAddress();
        owner = o;
    }
}
