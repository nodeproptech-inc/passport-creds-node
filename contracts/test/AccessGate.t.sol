// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClaimRegistry} from "../src/ClaimRegistry.sol";
import {CompliancePassport} from "../src/CompliancePassport.sol";
import {AccessGate} from "../src/AccessGate.sol";
import {ICompliancePassport} from "../src/interfaces/ICompliancePassport.sol";

contract AccessGateTest is Test {
    ClaimRegistry registry;
    CompliancePassport passport;
    AccessGate gate;

    address admin = makeAddr("admin");
    address updater = makeAddr("updater");
    address user = makeAddr("user");

    bytes32 constant ATTEST = keccak256("attest");
    uint64 FUTURE;

    function setUp() public {
        FUTURE = uint64(block.timestamp + 365 days);
        registry = new ClaimRegistry(admin);
        passport = new CompliancePassport(admin, address(registry));
        gate = new AccessGate(address(registry), address(passport));

        vm.startPrank(admin);
        registry.grantRole(registry.CRE_UPDATER_ROLE(), updater);
        passport.grantRole(passport.CRE_UPDATER_ROLE(), updater);
        vm.stopPrank();
    }

    // --- helpers ---

    function _submitAndSync(bool kyc, bool acc) internal {
        vm.startPrank(updater);
        if (kyc) {
            registry.submitClaim(user, keccak256("KYC_AML_VERIFIED"), true, keccak256("v1"), ATTEST, FUTURE);
        } else {
            registry.submitClaim(user, keccak256("KYC_AML_VERIFIED"), false, keccak256("v1"), ATTEST, FUTURE);
        }
        passport.syncPassport(user);

        if (acc) {
            registry.submitClaim(user, keccak256("ACCREDITED_INVESTOR"), true, keccak256("v2"), ATTEST, FUTURE);
            passport.syncPassport(user);
        }
        vm.stopPrank();
    }

    // --- canAccessDealRoom ---

    function test_dealRoom_blocked_when_no_claims() public view {
        assertFalse(gate.canAccessDealRoom(user));
    }

    function test_dealRoom_allowed_when_kyc_verified_limited() public {
        vm.prank(updater);
        registry.submitClaim(user, keccak256("KYC_AML_VERIFIED"), true, keccak256("v1"), ATTEST, FUTURE);
        vm.prank(updater);
        passport.syncPassport(user);

        assertTrue(gate.canAccessDealRoom(user));
    }

    function test_dealRoom_allowed_when_passport_green() public {
        _submitAndSync(true, true);
        assertTrue(gate.canAccessDealRoom(user));
    }

    function test_dealRoom_blocked_when_kyc_failed() public {
        _submitAndSync(false, false);
        assertFalse(gate.canAccessDealRoom(user));
    }

    // --- canAccessInvestorArea ---

    function test_investor_blocked_when_only_kyc() public {
        vm.prank(updater);
        registry.submitClaim(user, keccak256("KYC_AML_VERIFIED"), true, keccak256("v1"), ATTEST, FUTURE);
        vm.prank(updater);
        passport.syncPassport(user);

        assertFalse(gate.canAccessInvestorArea(user));
    }

    function test_investor_allowed_when_both_verified_and_green() public {
        _submitAndSync(true, true);
        assertTrue(gate.canAccessInvestorArea(user));
    }

    function test_investor_blocked_when_kyc_failed() public {
        _submitAndSync(false, false);
        assertFalse(gate.canAccessInvestorArea(user));
    }

    // --- canInvest ---

    function test_canInvest_same_as_investor_area() public {
        _submitAndSync(true, true);
        assertEq(gate.canInvest(user), gate.canAccessInvestorArea(user));
    }

    // --- getAccessSummary ---

    function test_getAccessSummary_no_claims() public view {
        AccessGate.AccessSummary memory s = gate.getAccessSummary(user);
        assertFalse(s.canAccessDealRoom);
        assertFalse(s.canAccessInvestorArea);
        assertFalse(s.canInvest);
        assertEq(uint8(s.passportStatus), uint8(ICompliancePassport.PassportStatus.NONE));
    }

    function test_getAccessSummary_limited() public {
        vm.prank(updater);
        registry.submitClaim(user, keccak256("KYC_AML_VERIFIED"), true, keccak256("v1"), ATTEST, FUTURE);
        vm.prank(updater);
        passport.syncPassport(user);

        AccessGate.AccessSummary memory s = gate.getAccessSummary(user);
        assertTrue(s.canAccessDealRoom);
        assertFalse(s.canAccessInvestorArea);
        assertFalse(s.canInvest);
        assertEq(uint8(s.passportStatus), uint8(ICompliancePassport.PassportStatus.LIMITED));
    }

    function test_getAccessSummary_green() public {
        _submitAndSync(true, true);

        AccessGate.AccessSummary memory s = gate.getAccessSummary(user);
        assertTrue(s.canAccessDealRoom);
        assertTrue(s.canAccessInvestorArea);
        assertTrue(s.canInvest);
        assertEq(uint8(s.passportStatus), uint8(ICompliancePassport.PassportStatus.GREEN));
    }

    // --- accreditation failure is not full RED ---

    function test_accreditation_failed_but_kyc_verified_deals_room_still_open() public {
        vm.startPrank(updater);
        registry.submitClaim(user, keccak256("KYC_AML_VERIFIED"), true, keccak256("v1"), ATTEST, FUTURE);
        passport.syncPassport(user);
        registry.submitClaim(user, keccak256("ACCREDITED_INVESTOR"), false, keccak256("v2"), ATTEST, FUTURE);
        passport.syncPassport(user);
        vm.stopPrank();

        assertTrue(gate.canAccessDealRoom(user));
        assertFalse(gate.canAccessInvestorArea(user));
    }
}
