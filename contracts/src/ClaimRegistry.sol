// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IClaimRegistry} from "./interfaces/IClaimRegistry.sol";

/**
 * @title ClaimRegistry
 * @notice Stores verified compliance claims for each wallet.
 *
 * CRE is the only authorized writer (CRE_UPDATER_ROLE). It submits claims after fetching
 * a sanitized verification result from the backend. Raw documents and PII never touch this contract.
 *
 * Replay protection: each verificationIdHash can only be used once.
 *
 * Supported claim types (bytes32 keccak256 hashes):
 *   KYC_AML_VERIFIED     = keccak256("KYC_AML_VERIFIED")
 *   ACCREDITED_INVESTOR  = keccak256("ACCREDITED_INVESTOR")
 */
contract ClaimRegistry is IClaimRegistry, AccessControl {
    bytes32 public constant CRE_UPDATER_ROLE = keccak256("CRE_UPDATER_ROLE");
    bytes32 public constant ISSUER_ADMIN_ROLE = keccak256("ISSUER_ADMIN_ROLE");

    bytes32 public constant KYC_AML_VERIFIED = keccak256("KYC_AML_VERIFIED");
    bytes32 public constant ACCREDITED_INVESTOR = keccak256("ACCREDITED_INVESTOR");

    // user => claimType => Claim
    mapping(address => mapping(bytes32 => Claim)) private _claims;

    // Tracks used verificationId hashes to prevent replay attacks
    mapping(bytes32 => bool) public processedVerificationIds;

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ISSUER_ADMIN_ROLE, admin);
    }

    /**
     * @notice Submits a verified or failed claim from CRE.
     * @dev Only callable by CRE_UPDATER_ROLE. Reverts on duplicate verificationIdHash.
     * @param user          Wallet being verified.
     * @param claimType     keccak256 of the claim string (e.g. KYC_AML_VERIFIED).
     * @param approved      Whether the AI Attester approved the claim.
     * @param verificationIdHash keccak256 of the backend verificationId — replay protection.
     * @param attestationHash    Hash of the attested AI output — the onchain evidence reference.
     * @param expiresAt     Unix timestamp when this claim expires. 0 means no expiry.
     */
    function submitClaim(
        address user,
        bytes32 claimType,
        bool approved,
        bytes32 verificationIdHash,
        bytes32 attestationHash,
        uint64 expiresAt
    ) external override onlyRole(CRE_UPDATER_ROLE) {
        require(user != address(0), "ClaimRegistry: zero address");
        require(_isSupportedClaimType(claimType), "ClaimRegistry: unsupported claim type");
        require(!processedVerificationIds[verificationIdHash], "ClaimRegistry: verificationId already used");
        require(attestationHash != bytes32(0), "ClaimRegistry: missing attestation hash");

        processedVerificationIds[verificationIdHash] = true;

        ClaimStatus status = approved ? ClaimStatus.VERIFIED : ClaimStatus.FAILED;

        _claims[user][claimType] = Claim({
            status: status,
            approved: approved,
            issuer: msg.sender,
            attestationHash: attestationHash,
            verificationIdHash: verificationIdHash,
            expiresAt: expiresAt,
            updatedAt: uint64(block.timestamp)
        });

        emit ClaimUpdated(user, claimType, status, approved, verificationIdHash, attestationHash, expiresAt);
    }

    /**
     * @notice Revokes a claim. Only ISSUER_ADMIN_ROLE.
     */
    function revokeClaim(address user, bytes32 claimType)
        external
        override
        onlyRole(ISSUER_ADMIN_ROLE)
    {
        require(_claims[user][claimType].updatedAt != 0, "ClaimRegistry: claim does not exist");

        _claims[user][claimType].status = ClaimStatus.REVOKED;
        _claims[user][claimType].approved = false;
        _claims[user][claimType].updatedAt = uint64(block.timestamp);

        emit ClaimRevoked(user, claimType);
    }

    /**
     * @notice Returns the full Claim struct for a user and claim type.
     */
    function getClaim(address user, bytes32 claimType)
        external
        view
        override
        returns (Claim memory)
    {
        return _claims[user][claimType];
    }

    /**
     * @notice Returns the current status of a claim.
     */
    function getClaimStatus(address user, bytes32 claimType)
        external
        view
        override
        returns (ClaimStatus)
    {
        return _claims[user][claimType].status;
    }

    /**
     * @notice Returns true if the claim is VERIFIED and not expired.
     * @dev Used by CompliancePassport and AccessGate to check eligibility.
     */
    function hasValidClaim(address user, bytes32 claimType)
        public
        view
        override
        returns (bool)
    {
        Claim storage c = _claims[user][claimType];
        if (c.status != ClaimStatus.VERIFIED) return false;
        if (c.expiresAt != 0 && block.timestamp > c.expiresAt) return false;
        return true;
    }

    // --- Internal ---

    function _isSupportedClaimType(bytes32 claimType) internal pure returns (bool) {
        return claimType == KYC_AML_VERIFIED || claimType == ACCREDITED_INVESTOR;
    }
}
