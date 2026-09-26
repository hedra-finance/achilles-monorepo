// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

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
contract HumanRegistry {
    /// @notice Nullifier of the human who claimed this slot -> the wallet that claimed it.
    mapping(uint256 => address) public walletOf;
    /// @notice Wallet -> the nullifier it was claimed with. Zero when unclaimed.
    mapping(address => uint256) public nullifierOf;

    /// @notice Attests verifications. The account that runs the off-chain check against World ID.
    address public verifier;
    address public owner;

    event Claimed(uint256 indexed nullifierHash, address indexed wallet);
    event VerifierSet(address verifier);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotVerifier();
    error HumanAlreadyClaimed(address existingWallet);
    error WalletAlreadyClaimed(uint256 existingNullifier);
    error ZeroValue();

    constructor(address verifier_) {
        owner = msg.sender;
        verifier = verifier_;
        emit OwnershipTransferred(address(0), msg.sender);
        emit VerifierSet(verifier_);
    }

    function setVerifier(address v) external {
        if (msg.sender != owner) revert NotOwner();
        verifier = v;
        emit VerifierSet(v);
    }

    function transferOwnership(address newOwner) external {
        if (msg.sender != owner) revert NotOwner();
        if (newOwner == address(0)) revert ZeroValue();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Record that `wallet` is backed by the human behind `nullifierHash`.
    /// @dev    Rejects a second claim from either side rather than overwriting: re-pointing a
    ///         nullifier at a fresh wallet would hand the same person a second allocation, which is
    ///         the exact thing this registry exists to prevent.
    function claim(uint256 nullifierHash, address wallet) external {
        if (msg.sender != verifier) revert NotVerifier();
        if (nullifierHash == 0 || wallet == address(0)) revert ZeroValue();

        address taken = walletOf[nullifierHash];
        if (taken != address(0)) revert HumanAlreadyClaimed(taken);
        uint256 held = nullifierOf[wallet];
        if (held != 0) revert WalletAlreadyClaimed(held);

        walletOf[nullifierHash] = wallet;
        nullifierOf[wallet] = nullifierHash;
        emit Claimed(nullifierHash, wallet);
    }

    /// @notice Whether this wallet is backed by a verified, not-yet-reused human.
    function isVerified(address wallet) external view returns (bool) {
        return nullifierOf[wallet] != 0;
    }
}
