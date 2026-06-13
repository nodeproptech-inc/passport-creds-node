// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IClaimRegistry {
    // Lifecycle of a claim written onchain.
    // PENDING and PROCESSING are backend-only states — the chain only receives final attested outputs.
    enum ClaimStatus {
        UNVERIFIED,
        VERIFIED,
        FAILED,
        EXPIRED,
        REVOKED
    }

    struct Claim {
        ClaimStatus status;
        bool approved;
        address issuer;
        bytes32 attestationHash;
        bytes32 verificationIdHash;
        uint64 expiresAt;
        uint64 updatedAt;
    }

    event ClaimUpdated(
        address indexed user,
        bytes32 indexed claimType,
        ClaimStatus status,
        bool approved,
        bytes32 indexed verificationIdHash,
        bytes32 attestationHash,
        uint64 expiresAt
    );

    event ClaimRevoked(address indexed user, bytes32 indexed claimType);

    function submitClaim(
        address user,
        bytes32 claimType,
        bool approved,
        bytes32 verificationIdHash,
        bytes32 attestationHash,
        uint64 expiresAt
    ) external;

    function revokeClaim(address user, bytes32 claimType) external;

    function getClaim(address user, bytes32 claimType) external view returns (Claim memory);

    function getClaimStatus(address user, bytes32 claimType) external view returns (ClaimStatus);

    function hasValidClaim(address user, bytes32 claimType) external view returns (bool);
}
