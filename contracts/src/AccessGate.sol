// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IClaimRegistry} from "./interfaces/IClaimRegistry.sol";
import {ICompliancePassport} from "./interfaces/ICompliancePassport.sol";
import {IAccessGate} from "./interfaces/IAccessGate.sol";

/**
 * @title AccessGate
 * @notice Read-only contract that applications use to check wallet access rights.
 *
 * Does not store any state. Reads ClaimRegistry and CompliancePassport on every call.
 * Does not need to be updated after verifications — it reflects the current onchain state.
 *
 * Access rules:
 *   canAccessDealRoom   — KYC_AML_VERIFIED valid + passport is LIMITED or GREEN
 *   canAccessInvestorArea — KYC_AML_VERIFIED valid + ACCREDITED_INVESTOR valid + passport GREEN
 *   canInvest           — same as canAccessInvestorArea (no real investment flow in hackathon)
 */
contract AccessGate is IAccessGate {
    IClaimRegistry public immutable CLAIM_REGISTRY;
    ICompliancePassport public immutable COMPLIANCE_PASSPORT;

    bytes32 private constant KYC_AML_VERIFIED = keccak256("KYC_AML_VERIFIED");
    bytes32 private constant ACCREDITED_INVESTOR = keccak256("ACCREDITED_INVESTOR");

    constructor(address claimRegistryAddress, address compliancePassportAddress) {
        CLAIM_REGISTRY = IClaimRegistry(claimRegistryAddress);
        COMPLIANCE_PASSPORT = ICompliancePassport(compliancePassportAddress);
    }

    /**
     * @notice Returns true when the wallet has a valid KYC/AML claim and a LIMITED or GREEN passport.
     */
    function canAccessDealRoom(address user) public view override returns (bool) {
        if (!CLAIM_REGISTRY.hasValidClaim(user, KYC_AML_VERIFIED)) return false;

        ICompliancePassport.PassportStatus status = COMPLIANCE_PASSPORT.statusOf(user);
        return status == ICompliancePassport.PassportStatus.LIMITED
            || status == ICompliancePassport.PassportStatus.GREEN;
    }

    /**
     * @notice Returns true when both KYC/AML and Accredited Investor claims are valid
     *         and the passport is GREEN.
     */
    function canAccessInvestorArea(address user) public view override returns (bool) {
        if (!CLAIM_REGISTRY.hasValidClaim(user, KYC_AML_VERIFIED)) return false;
        if (!CLAIM_REGISTRY.hasValidClaim(user, ACCREDITED_INVESTOR)) return false;
        return COMPLIANCE_PASSPORT.statusOf(user) == ICompliancePassport.PassportStatus.GREEN;
    }

    /**
     * @notice Same as canAccessInvestorArea — no real investment flow in the hackathon.
     */
    function canInvest(address user) external view override returns (bool) {
        return canAccessInvestorArea(user);
    }

    /**
     * @notice Returns all access flags and passport status in a single read call.
     * @dev Preferred by frontend and CRE to minimize RPC calls.
     */
    function getAccessSummary(address user)
        external
        view
        override
        returns (AccessSummary memory)
    {
        return AccessSummary({
            canAccessDealRoom: canAccessDealRoom(user),
            canAccessInvestorArea: canAccessInvestorArea(user),
            canInvest: canAccessInvestorArea(user),
            passportStatus: COMPLIANCE_PASSPORT.statusOf(user)
        });
    }
}
