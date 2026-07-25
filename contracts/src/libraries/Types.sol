// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice Shared vocabulary used across every contract + backend + frontend.
///         Keeping it in one place is what makes the whole system consistent.

/// ERC-734 key purposes. MANAGEMENT satisfies any purpose (see Identity.keyHasPurpose).
library KeyPurpose {
    uint256 internal constant MANAGEMENT = 1;
    uint256 internal constant ACTION     = 2;
    uint256 internal constant CLAIM      = 3;
}

/// ERC-735 claim topics as uint256(keccak256(name)) — stable, collision-resistant, traceable.
library ClaimTopics {
    uint256 internal constant KYC_VERIFIED        = uint256(keccak256("KYC_VERIFIED"));
    uint256 internal constant PROOF_OF_PERSONHOOD = uint256(keccak256("PROOF_OF_PERSONHOOD"));
    uint256 internal constant ACCREDITED_INVESTOR = uint256(keccak256("ACCREDITED_INVESTOR"));
}

/// Reason codes returned by EligibilityGate (bytes32 so they're cheap + surfaced in reverts/UI).
library Reason {
    bytes32 internal constant OK                  = bytes32(0);
    bytes32 internal constant NO_IDENTITY         = "NO_IDENTITY";
    bytes32 internal constant MISSING_KYC         = "MISSING_KYC";
    bytes32 internal constant MISSING_PERSONHOOD  = "MISSING_PERSONHOOD";
    bytes32 internal constant MISSING_ACCREDITED  = "MISSING_ACCREDITED";
}

/// Minimal interface the Identity + EligibilityGate rely on from the issuer.
interface IClaimIssuer {
    function isClaimValid(address identity, uint256 topic, bytes calldata sig, bytes calldata data)
        external view returns (bool);
}
