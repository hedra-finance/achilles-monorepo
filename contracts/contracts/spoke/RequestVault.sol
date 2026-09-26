// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { IRequestVault } from "../interfaces/IRequestVault.sol";
import { IVaultCoordinator } from "../interfaces/IVaultCoordinator.sol";
import { IERC1404 } from "../interfaces/IRestrictedShare.sol";

/// @title  RequestVault — ERC-7540/7575 entry point (thin facade).
/// @notice User-facing vault. All state and issuance is delegated to the coordinator; the vault has no mint
///         authority. The share token is separate and exposed via `share()` (ERC-7575).
/// @dev    ERC-7540 surface:
///         - request → claim in two steps. claim (deposit/mint/redeem/withdraw) accepts only the full claimable
///           amount (otherwise ClaimMismatch); partial claims are optional in the spec and not supported.
///         - preview* always revert, as the spec requires for async vaults.
///         - max* return the controller's claimable balance. convertTo* are NAV/supply estimates, not settlement prices.
///         - ERC-165: operator(0xe3bc4e65), async deposit(0xce3bbe50), async redeem(0x620ee8e4), 7575(0x2f0a18c5).
contract RequestVault is Initializable, IRequestVault, IERC165 {
    using SafeERC20 for IERC20;

    uint256 public constant REQUEST_ID = 0; // one request per user and direction

    uint8 private _tranche;
    address private _asset;
    address private _share;
    address public manager;

    // ERC-7540 operator: controller approves a delegate
    mapping(address controller => mapping(address operator => bool)) public isOperator;

    event DepositRequest(address indexed controller, address indexed owner, uint256 indexed requestId, address sender, uint256 assets);
    event RedeemRequest(address indexed controller, address indexed owner, uint256 indexed requestId, address sender, uint256 shares);
    event Deposit(address indexed controller, address indexed receiver, uint256 assets, uint256 shares);
    event Withdraw(address indexed sender, address indexed receiver, address indexed controller, uint256 assets, uint256 shares); // ERC-4626 signature (owner slot = controller)
    event OperatorSet(address indexed controller, address indexed operator, bool approved);

    error NotOwner();
    error NotController();
    error InvalidController(); // controller must be the owner or an approved operator (prevents slot griefing)
    error ZeroAmount();
    error ClaimMismatch();       // claim parameter != full claimable amount (partial claims unsupported)
    error PreviewNotSupported(); // ERC-7540: preview* MUST revert on async vaults
    error DepositRestricted(uint8 code); // share hook rejected the requester before funds were taken
    error OverCapacity();        // cumulative deposit requests exceed the per-user capacity set by the hook

    constructor() {
        _disableInitializers(); // implementation is only used behind UpgradeableProxy
    }

    function initialize(uint8 tranche_, address asset_, address share_, address manager_) external initializer {
        _tranche = tranche_;
        _asset = asset_;
        _share = share_;
        manager = manager_;
    }

    // ── views (IRequestVault / 7575 / 4626 subset) ──
    function asset() external view returns (address) { return _asset; }
    function share() external view returns (address) { return _share; }
    function tranche() external view returns (uint8) { return _tranche; }
    function totalAssets() public view returns (uint256) { return IVaultCoordinator(manager).trancheAssets(address(this)); }

    /// @notice NAV/supply based estimate (4626 view). Not the settlement price, which is fixed at settle time.
    function convertToShares(uint256 assets) external view returns (uint256) {
        uint256 supply = IERC20(_share).totalSupply();
        uint256 ta = totalAssets();
        return (supply == 0 || ta == 0) ? assets : assets * supply / ta;
    }

    function convertToAssets(uint256 shares) external view returns (uint256) {
        uint256 supply = IERC20(_share).totalSupply();
        return supply == 0 ? shares : shares * totalAssets() / supply;
    }

    // ── 4626 max*: async vault, so the controller's claimable balance ──
    function maxDeposit(address controller) external view returns (uint256) {
        return IVaultCoordinator(manager).claimableDepositAssets(address(this), controller);
    }
    function maxMint(address controller) external view returns (uint256) {
        return IVaultCoordinator(manager).claimableDepositShares(address(this), controller);
    }
    function maxWithdraw(address controller) external view returns (uint256) {
        return IVaultCoordinator(manager).claimableRedeemAssets(address(this), controller);
    }
    function maxRedeem(address controller) external view returns (uint256) {
        return IVaultCoordinator(manager).claimableRedeemShares(address(this), controller);
    }

    // ── 4626 preview*: ERC-7540 requires async vaults to revert ──
    function previewDeposit(uint256) external pure returns (uint256) { revert PreviewNotSupported(); }
    function previewMint(uint256) external pure returns (uint256) { revert PreviewNotSupported(); }
    function previewWithdraw(uint256) external pure returns (uint256) { revert PreviewNotSupported(); }
    function previewRedeem(uint256) external pure returns (uint256) { revert PreviewNotSupported(); }

    // ── ERC-7540 deposit ──
    function requestDeposit(uint256 assets, address controller, address owner) external returns (uint256) {
        if (owner != msg.sender && !isOperator[owner][msg.sender]) revert NotOwner();
        // One slot per user and direction: allowing an arbitrary controller would let 1 wei block someone else's request.
        if (controller != owner && !isOperator[controller][msg.sender]) revert InvalidController();
        if (assets == 0) revert ZeroAmount();
        // Compliance pre-check: ask the share hook whether this controller may receive shares, before taking funds.
        // Otherwise an unregistered user's money enters the pool and only fails at claim after settlement.
        // `assets` approximates the value; amount-based policies are re-checked at mint.
        uint8 code = IERC1404(_share).detectTransferRestriction(address(0), controller, assets);
        if (code != 0) revert DepositRestricted(code);
        // Capacity gate: the share hook records (vault, controller) cumulative requests and enforces the per-user cap.
        // Lives in the vault because the coordinator has no bytecode headroom. A missing hook or one without
        // consumeCapacity fails the call and passes through, keeping older products compatible.
        {
            (bool hOk, bytes memory hRet) = _share.staticcall(abi.encodeWithSignature("hook()"));
            if (hOk && hRet.length >= 32) {
                address h = abi.decode(hRet, (address));
                if (h != address(0)) {
                    (bool cOk, bytes memory cRet) = h.call(abi.encodeWithSignature("consumeCapacity(address,address,uint256)", address(this), controller, assets));
                    if (cOk && cRet.length >= 32 && !abi.decode(cRet, (bool))) revert OverCapacity();
                }
            }
        }
        // Move assets into coordinator escrow, then register the request.
        IERC20(_asset).safeTransferFrom(owner, manager, assets);
        IVaultCoordinator(manager).requestDeposit(controller, owner, assets);
        emit DepositRequest(controller, owner, REQUEST_ID, msg.sender, assets);
        return REQUEST_ID;
    }

    function deposit(uint256 assets, address receiver, address controller) public returns (uint256 shares) {
        _validateController(controller);
        if (assets != IVaultCoordinator(manager).claimableDepositAssets(address(this), controller)) revert ClaimMismatch();
        shares = IVaultCoordinator(manager).claimDeposit(controller, receiver);
        emit Deposit(controller, receiver, assets, shares);
    }

    function deposit(uint256 assets, address receiver) external returns (uint256) {
        return deposit(assets, receiver, msg.sender);
    }

    function mint(uint256 shares, address receiver, address controller) public returns (uint256 assets) {
        _validateController(controller);
        assets = IVaultCoordinator(manager).claimableDepositAssets(address(this), controller);
        uint256 claimed = IVaultCoordinator(manager).claimDeposit(controller, receiver);
        if (shares != claimed) revert ClaimMismatch();
        emit Deposit(controller, receiver, assets, claimed);
    }

    function mint(uint256 shares, address receiver) external returns (uint256) {
        return mint(shares, receiver, msg.sender);
    }

    function pendingDepositRequest(uint256, address controller) external view returns (uint256 assets) {
        return IVaultCoordinator(manager).pendingDepositRequest(address(this), controller);
    }

    /// @notice ERC-7540: assets of the claimable deposit (the amount originally requested).
    function claimableDepositRequest(uint256, address controller) external view returns (uint256 assets) {
        return IVaultCoordinator(manager).claimableDepositAssets(address(this), controller);
    }

    // ── ERC-7540 redeem ──
    function requestRedeem(uint256 shares, address controller, address owner) external returns (uint256) {
        if (owner != msg.sender && !isOperator[owner][msg.sender]) revert NotOwner();
        if (controller != owner && !isOperator[controller][msg.sender]) revert InvalidController();
        if (shares == 0) revert ZeroAmount();
        // Move shares into coordinator escrow (burned at settlement), then register the request.
        IERC20(_share).safeTransferFrom(owner, manager, shares);
        IVaultCoordinator(manager).requestRedeem(controller, owner, shares);
        emit RedeemRequest(controller, owner, REQUEST_ID, msg.sender, shares);
        return REQUEST_ID;
    }

    function redeem(uint256 shares, address receiver, address controller) public returns (uint256 assets) {
        _validateController(controller);
        if (shares != IVaultCoordinator(manager).claimableRedeemShares(address(this), controller)) revert ClaimMismatch();
        assets = IVaultCoordinator(manager).claimRedeem(controller, receiver);
        emit Withdraw(msg.sender, receiver, controller, assets, shares);
    }

    function withdraw(uint256 assets, address receiver, address controller) public returns (uint256 shares) {
        _validateController(controller);
        shares = IVaultCoordinator(manager).claimableRedeemShares(address(this), controller);
        uint256 paid = IVaultCoordinator(manager).claimRedeem(controller, receiver);
        if (assets != paid) revert ClaimMismatch();
        emit Withdraw(msg.sender, receiver, controller, paid, shares);
    }

    function pendingRedeemRequest(uint256, address controller) external view returns (uint256 shares) {
        return IVaultCoordinator(manager).pendingRedeemRequest(address(this), controller);
    }

    /// @notice ERC-7540: shares of the claimable redeem (escrowed shares pending burn).
    function claimableRedeemRequest(uint256, address controller) external view returns (uint256 shares) {
        return IVaultCoordinator(manager).claimableRedeemShares(address(this), controller);
    }

    // ── request cancellation (only before settlement; direct-cancel style in the spirit of ERC-7887) ──
    event DepositRequestCanceled(address indexed controller, uint256 assets);
    event RedeemRequestCanceled(address indexed controller, uint256 shares);

    function cancelDepositRequest(uint256, address controller) external returns (uint256 assets) {
        _validateController(controller);
        assets = IVaultCoordinator(manager).cancelDeposit(controller);
        emit DepositRequestCanceled(controller, assets);
    }

    function cancelRedeemRequest(uint256, address controller) external returns (uint256 shares) {
        _validateController(controller);
        shares = IVaultCoordinator(manager).cancelRedeem(controller);
        emit RedeemRequestCanceled(controller, shares);
    }

    // ── operator ──
    function setOperator(address operator, bool approved) external returns (bool) {
        isOperator[msg.sender][operator] = approved;
        emit OperatorSet(msg.sender, operator, approved);
        return true;
    }

    // ── ERC-165 (interface IDs specified by ERC-7540/7575) ──
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC165).interfaceId
            || interfaceId == 0xe3bc4e65   // ERC-7540 operator
            || interfaceId == 0xce3bbe50   // ERC-7540 async deposit vault
            || interfaceId == 0x620ee8e4   // ERC-7540 async redeem vault
            || interfaceId == 0x2f0a18c5;  // ERC-7575 vault
    }

    function _validateController(address controller) private view {
        if (controller != msg.sender && !isOperator[controller][msg.sender]) revert NotController();
    }
}
