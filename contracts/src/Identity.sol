// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {KeyPurpose, IClaimIssuer} from "./libraries/Types.sol";

/**
 * @title Identity  (ONCHAINID-style: ERC-734 keys + ERC-735 claims)
 * @notice One identity contract PER USER. The user's wallet is the MANAGEMENT key.
 *
 * ⭐ MODEL B ("no privileged writer"):
 *   - The ISSUER only SIGNS off-chain (EIP-712). It never holds a key here, never writes.
 *   - The HOLDER (a CLAIM/MANAGEMENT key on THEIR OWN identity) submits the signed claim.
 *   - Trust = the signature, re-verified at write via IClaimIssuer.isClaimValid.
 *   => nobody can write to another user's identity → griefing closed at the key gate.
 *
 * Griefing defenses (why the eligibility loop can't be bricked):
 *   - claimId = keccak(issuer, topic)  → one slot per (issuer, topic); re-issue updates in place.
 *   - MAX_CLAIMS_PER_TOPIC             → hard cap on the per-topic set.
 *   - only trusted issuers land         → checked at write.
 *
 * Zero PII on-chain: `data` holds only a hash/reference.
 */
contract Identity {
    // --- ERC-734 keys ---
    // key = keccak256(abi.encode(addr)) => purposes held
    mapping(bytes32 => uint256[]) private _keyPurposes;

    // --- ERC-735 claims ---
    struct Claim {
        uint256 topic;
        address issuer;     // the trusted issuer CONTRACT
        bytes   signature;  // issuer's EIP-712 signature
        bytes   data;       // abi.encode(dataHash, expiresAt, nonce) — signed; NEVER PII
        bool    exists;
    }
    mapping(uint256 => mapping(address => Claim)) private _claim; // topic => issuer => claim
    mapping(uint256 => uint256) private _countByTopic;
    uint256 public constant MAX_CLAIMS_PER_TOPIC = 16;

    address public immutable issuerRegistry; // knows which issuers are trusted per topic

    event KeyAdded(bytes32 indexed key, uint256 indexed purpose);
    event ClaimAdded(bytes32 indexed claimId, uint256 indexed topic, address indexed issuer);
    event ClaimRevoked(uint256 indexed topic, address indexed issuer);

    error NoClaimKey();
    error UntrustedIssuer();
    error BadSignature();
    error TopicCap();
    error NoClaimToRevoke();
    error ZeroOwner();
    error ZeroIssuerRegistry();

    /// @param ownerWallet the user — seeded as MANAGEMENT (and thus effectively CLAIM, see keyHasPurpose)
    constructor(address ownerWallet, address issuerRegistry_) {
        if (ownerWallet == address(0)) revert ZeroOwner();
        if (issuerRegistry_ == address(0)) revert ZeroIssuerRegistry();
        issuerRegistry = issuerRegistry_;
        _keyPurposes[keyForAddress(ownerWallet)].push(KeyPurpose.MANAGEMENT);
        emit KeyAdded(keyForAddress(ownerWallet), KeyPurpose.MANAGEMENT);
    }

    function keyForAddress(address a) public pure returns (bytes32) {
        return keccak256(abi.encode(a));
    }

    /// @notice MANAGEMENT satisfies ANY purpose (canonical ONCHAINID behavior).
    function keyHasPurpose(bytes32 key, uint256 purpose) public view returns (bool) {
        uint256[] storage ps = _keyPurposes[key];
        for (uint256 i; i < ps.length; ++i) {
            if (ps[i] == purpose || ps[i] == KeyPurpose.MANAGEMENT) return true;
        }
        return false;
    }

    // --- ERC-735 write (Model B) ---

    /// @dev Expiry & nonce live INSIDE the signed `data` (abi.encode(dataHash, expiresAt, nonce));
    ///      the ClaimIssuer decodes and enforces them in isClaimValid — no separate param here,
    ///      so a caller can't pass an expiry that diverges from what the issuer signed.
    function submitClaim(
        uint256 topic,
        address issuer,
        bytes calldata sig,
        bytes calldata data
    ) external returns (bytes32 claimId) {
        // (1) only the owner writes to their own identity
        if (!keyHasPurpose(keyForAddress(msg.sender), KeyPurpose.CLAIM)) revert NoClaimKey();
        // (2) issuer must be trusted for this topic
        if (!IIssuerRegistry(issuerRegistry).isTrusted(issuer, topic)) revert UntrustedIssuer();
        // (3) the issuer signature must validate, bound to THIS identity (anti-replay)
        if (!IClaimIssuer(issuer).isClaimValid(address(this), topic, sig, data)) revert BadSignature();

        Claim storage c = _claim[topic][issuer];
        if (!c.exists) {
            if (_countByTopic[topic] >= MAX_CLAIMS_PER_TOPIC) revert TopicCap();
            _countByTopic[topic] += 1;
        }
        c.topic = topic; c.issuer = issuer; c.signature = sig; c.data = data;
        c.exists = true;

        claimId = keccak256(abi.encode(issuer, topic));
        emit ClaimAdded(claimId, topic, issuer);
    }

    /// @notice Holder-side voluntary removal. NOT the compliance lever — platform revocation
    ///         is the issuer's (ClaimIssuer.setRevoked), re-checked at read by the gate.
    /// @dev Model B: ONLY the holder (a CLAIM/MANAGEMENT key on their own identity) may remove.
    ///      The issuer is NOT a privileged writer here — it cannot hide a holder's claim.
    function revokeClaim(uint256 topic, address issuer) external {
        // same missing-CLAIM-key condition as submitClaim → same error (NoClaimKey)
        if (!keyHasPurpose(keyForAddress(msg.sender), KeyPurpose.CLAIM)) revert NoClaimKey();
        if (!_claim[topic][issuer].exists) revert NoClaimToRevoke(); // nothing to remove
        delete _claim[topic][issuer]; // full removal — frees the per-topic cap slot
        _countByTopic[topic] -= 1;
        emit ClaimRevoked(topic, issuer);
    }

    // --- reads (used by EligibilityGate) ---

    /// @notice Used by the gate. `exists` is false if there's no claim OR the holder locally
    ///         removed it (revokeClaim). Platform revocation is checked separately by the issuer.
    function getClaim(uint256 topic, address issuer)
        external view returns (bool exists, bytes memory sig, bytes memory data)
    {
        Claim storage c = _claim[topic][issuer];
        if (!c.exists) return (false, bytes(""), bytes(""));
        return (true, c.signature, c.data);
    }
}

interface IIssuerRegistry {
    function isTrusted(address issuer, uint256 topic) external view returns (bool);
    function issuersForTopic(uint256 topic) external view returns (address[] memory);
}
