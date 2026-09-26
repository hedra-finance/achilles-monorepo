// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

/// @title  HumanRegistry
/// @notice Binds one verified human to one wallet for a scarce allocation.
///
///         The Senior tranche takes a fixed rate ahead of Junior, so its capacity is the scarce
///         benefit in this product: without a distinctness check one actor can take all of it from
///         many wallets. Verification itself happens off-chain against the World ID protocol; what
///         is recorded here is only the resulting nullifier, so the allocation rule is auditable and
///         survives a restart of whatever performed the verification.
///
///         Deliberately stores no identity: a nullifier is scoped to (relying party, action) and
///         carries nothing about who the person is, only that this is the same person as before.
///
///         Bindings are scoped to an action key — keccak256 of that same action string. Rotating the
///         key starts a clean round: every wallet is unclaimed again, and a person who verified under
///         the old action can verify under the new one. That is what makes the flow rehearsable
///         without burning a fresh World ID, and it is why resetting no longer means redeploying. In
///         production the key is set once and left alone; rotating it re-opens every allocation.
contract HumanRegistry is Initializable {
    /// @notice keccak256 of the World ID action these bindings belong to.
    bytes32 public actionKey;

    mapping(bytes32 action => mapping(uint256 nullifier => address wallet)) internal _walletOf;
    mapping(bytes32 action => mapping(address wallet => uint256 nullifier)) internal _nullifierOf;

    /// @notice Attests verifications. The account that runs the off-chain check against World ID.
    address public verifier;
    address public owner;

    event Claimed(uint256 indexed nullifierHash, address indexed wallet, bytes32 indexed action);
    event VerifierSet(address verifier);
    event ActionKeySet(bytes32 indexed action);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotVerifier();
    error HumanAlreadyClaimed(address existingWallet);
    error WalletAlreadyClaimed(uint256 existingNullifier);
    error ZeroValue();

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }

    constructor() { _disableInitializers(); } // implementation is only used behind UpgradeableProxy

    function initialize(address owner_, address verifier_, bytes32 actionKey_) external initializer {
        if (owner_ == address(0) || verifier_ == address(0)) revert ZeroValue();
        owner = owner_;
        verifier = verifier_;
        actionKey = actionKey_;
        emit OwnershipTransferred(address(0), owner_);
        emit VerifierSet(verifier_);
        emit ActionKeySet(actionKey_);
    }

    function setVerifier(address v) external onlyOwner {
        if (v == address(0)) revert ZeroValue();
        verifier = v;
        emit VerifierSet(v);
    }

    /// @notice Start a fresh round of bindings — everyone is unclaimed under the new key.
    /// @dev    Must equal keccak256(bytes(action)) for the action the verifier checks proofs against,
    ///         or a proof accepted for one action would be recorded against another's slots.
    function setActionKey(bytes32 k) external onlyOwner {
        actionKey = k;
        emit ActionKeySet(k);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroValue();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Record that `wallet` is backed by the human behind `nullifierHash`, for this action.
    /// @dev    Rejects a second claim from either side rather than overwriting: re-pointing a
    ///         nullifier at a fresh wallet would hand the same person a second allocation, which is
    ///         the exact thing this registry exists to prevent.
    function claim(uint256 nullifierHash, address wallet) external {
        if (msg.sender != verifier) revert NotVerifier();
        if (nullifierHash == 0 || wallet == address(0)) revert ZeroValue();
        bytes32 k = actionKey;

        address taken = _walletOf[k][nullifierHash];
        if (taken != address(0)) revert HumanAlreadyClaimed(taken);
        uint256 held = _nullifierOf[k][wallet];
        if (held != 0) revert WalletAlreadyClaimed(held);

        _walletOf[k][nullifierHash] = wallet;
        _nullifierOf[k][wallet] = nullifierHash;
        emit Claimed(nullifierHash, wallet, k);
    }

    // The single-argument getters read the current action on purpose, so a caller never has to know
    // which round it is in. They keep the shape the previous registry exposed.

    /// @notice The wallet a nullifier holds under the current action (zero when free).
    function walletOf(uint256 nullifierHash) external view returns (address) {
        return _walletOf[actionKey][nullifierHash];
    }

    /// @notice The nullifier a wallet holds under the current action (zero when unclaimed).
    function nullifierOf(address wallet) external view returns (uint256) {
        return _nullifierOf[actionKey][wallet];
    }

    /// @notice Whether this wallet is backed by a verified, not-yet-reused human.
    function isVerified(address wallet) external view returns (bool) {
        return _nullifierOf[actionKey][wallet] != 0;
    }

    /// @notice Read a binding under any action, for an operator reconciling a rotation.
    function bindingOf(bytes32 action, uint256 nullifierHash) external view returns (address) {
        return _walletOf[action][nullifierHash];
    }
}
