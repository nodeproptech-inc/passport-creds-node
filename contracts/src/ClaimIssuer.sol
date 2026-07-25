// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IClaimIssuer} from "./libraries/Types.sol";

/**
 * @title ClaimIssuer
 * @notice Signs claims (EIP-712) and is the AUTHORITY on their validity — re-verified at READ time
 *         by the gate. The holder owns their identity (Model B), but NOT claim validity.
 *
 * Revocation levers (the granularity is your choice):
 *   - per-user:  setRevoked(identity, topic, true)  → revoked[identity][topic]  (surgical — one user)
 *   - global:    setSigner(signer, false)           → invalidates EVERY claim that signer produced (key compromise)
 *   (de-trusting a whole issuer for a topic is a separate lever on the IssuerRegistry)
 *
 * The revocation is a LATCH the issuer holds — not a soft per-signature kill:
 *   - while revoked[identity][topic] == true, NO new claim for that topic can land
 *     (isClaimValid is checked at submitClaim), so the holder cannot self-heal by re-submitting.
 *   - re-verification is issuer-gated: the issuer re-approves → setRevoked(id, topic, false)
 *     → signs a fresh claim → holder submits. The user can never clear the latch themselves.
 *   This is STRONGER than canonical by-signature revocation (which a fresh signature bypasses).
 */
contract ClaimIssuer is IClaimIssuer, AccessControl, EIP712 {
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    bytes32 private constant CLAIM_TYPEHASH = keccak256(
        "Claim(address identity,uint256 topic,bytes32 dataHash,uint64 expiresAt,bytes32 nonce)"
    );

    mapping(address => bool) public isAuthorizedSigner;              // global lever
    mapping(address => mapping(uint256 => bool)) public revoked;     // identity => topic => revoked (per-user)

    event SignerSet(address indexed signer, bool ok);
    event RevocationSet(address indexed identity, uint256 indexed topic, bool revoked);

    error ZeroAdmin();
    error ZeroSigner();

    constructor(address admin, address signer) EIP712("PassportKitClaim", "1") {
        if (admin == address(0)) revert ZeroAdmin();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(AGENT_ROLE, admin);
        if (signer != address(0)) { isAuthorizedSigner[signer] = true; emit SignerSet(signer, true); }
    }

    function setSigner(address signer, bool ok) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (ok && signer == address(0)) revert ZeroSigner();
        isAuthorizedSigner[signer] = ok;
        emit SignerSet(signer, ok);
    }

    /// @notice Per-user revocation LATCH. The backend only needs (identity, topic) — no stored signatures.
    ///         setRevoked(id, topic, true)  = revoke (money moment); blocks re-submission of that topic.
    ///         setRevoked(id, topic, false) = re-open for re-verification (issuer re-approval only).
    ///         Only the issuer (AGENT_ROLE) flips it — the holder can never clear their own latch.
    function setRevoked(address identity, uint256 topic, bool value) external onlyRole(AGENT_ROLE) {
        revoked[identity][topic] = value;
        emit RevocationSet(identity, topic, value);
    }

    /// @notice Called at WRITE (Identity.submitClaim) AND at READ (EligibilityGate). Same authority.
    ///         So re-adding a revoked claim fails at write, and the gate refuses it at read.
    function isClaimValid(address identity, uint256 topic, bytes calldata sig, bytes calldata data)
        external view override returns (bool)
    {
        if (revoked[identity][topic]) return false;                 // ← per-user revocation
        // total validator: malformed encoding -> invalid, not a revert
        if (data.length != 96) return false; // abi.encode(bytes32,uint64,bytes32) == 3 words
        (bytes32 dataHash, uint64 expiresAt, bytes32 nonce) = abi.decode(data, (bytes32, uint64, bytes32));
        if (dataHash == bytes32(0)) return false;
        if (expiresAt != 0 && block.timestamp > expiresAt) return false;
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(_digest(identity, topic, dataHash, expiresAt, nonce), sig);
        if (err != ECDSA.RecoverError.NoError) return false; // malformed sig -> invalid, not a revert
        return isAuthorizedSigner[signer];                          // ← global lever
    }

    function _digest(address identity, uint256 topic, bytes32 dataHash, uint64 expiresAt, bytes32 nonce)
        internal view returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(CLAIM_TYPEHASH, identity, topic, dataHash, expiresAt, nonce))
        );
    }
}
