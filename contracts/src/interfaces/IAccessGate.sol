// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICompliancePassport} from "./ICompliancePassport.sol";

interface IAccessGate {
    // Returned by getAccessSummary — lets callers read everything in one call.
    struct AccessSummary {
        bool canAccessDealRoom;
        bool canAccessInvestorArea;
        bool canInvest;
        ICompliancePassport.PassportStatus passportStatus;
    }

    // True when KYC_AML_VERIFIED is valid and passport is LIMITED or GREEN.
    function canAccessDealRoom(address user) external view returns (bool);

    // True when both KYC_AML_VERIFIED and ACCREDITED_INVESTOR are valid and passport is GREEN.
    function canAccessInvestorArea(address user) external view returns (bool);

    // Same as canAccessInvestorArea for the hackathon — no real investment flow.
    function canInvest(address user) external view returns (bool);

    // Convenience function — returns all access flags and passport status in one read.
    function getAccessSummary(address user) external view returns (AccessSummary memory);
}
