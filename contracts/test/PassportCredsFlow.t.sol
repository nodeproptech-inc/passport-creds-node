// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClaimRegistry} from "../src/ClaimRegistry.sol";
import {CompliancePassport} from "../src/CompliancePassport.sol";
import {AccessGate} from "../src/AccessGate.sol";
import {ICompliancePassport} from "../src/interfaces/ICompliancePassport.sol";
import {IClaimRegistry} from "../src/interfaces/IClaimRegistry.sol";

/**
 * End-to-end test covering the full PassportCreds demo flow.
 *
 * Mirrors what CRE does after fetching a sanitized verification result:
 *   1. ClaimRegistry.submitClaim(KYC_AML_VERIFIED, approved=true)
 *   2. CompliancePassport.syncPassport(user)           → passport = LIMITED
 *   3. AccessGate.canAccessDealRoom(user)              → true
 *   4. ClaimRegistry.submitClaim(ACCREDITED_INVESTOR, approved=true)
 *   5. CompliancePassport.syncPassport(user)           → passport = GREEN
 *   6. AccessGate.canAccessInvestorArea(user)          → true
 */
contract PassportCredsFlowTest is Test {
    ClaimRegistry registry;
    CompliancePassport passport;
    AccessGate gate;

    address admin = makeAddr("admin");
    address cre = makeAddr("cre");     // simulates the CRE operator wallet
    address user = makeAddr("user");

    bytes32 constant KYC = keccak256("KYC_AML_VERIFIED");
    bytes32 constant ACC = keccak256("ACCREDITED_INVESTOR");
    bytes32 constant ATTEST_KYC = keccak256("attest_kyc_001");
    bytes32 constant ATTEST_ACC = keccak256("attest_acc_001");
    bytes32 constant VER_KYC = keccak256("ver_kyc_001");
    bytes32 constant VER_ACC = keccak256("ver_acc_001");
    uint64 EXPIRY;

    function setUp() public {
        EXPIRY = uint64(block.timestamp + 365 days);
        registry = new ClaimRegistry(admin);
        passport = new CompliancePassport(admin, address(registry));
        gate = new AccessGate(address(registry), address(passport));

        vm.startPrank(admin);
        registry.grantRole(registry.CRE_UPDATER_ROLE(), cre);
        passport.grantRole(passport.CRE_UPDATER_ROLE(), cre);
        vm.stopPrank();
    }

    function test_full_happy_path() public {
        // --- Step 1: CRE submits KYC/AML claim ---
        vm.prank(cre);
        registry.submitClaim(user, KYC, true, VER_KYC, ATTEST_KYC, EXPIRY);

        assertEq(
            uint8(registry.getClaimStatus(user, KYC)),
            uint8(IClaimRegistry.ClaimStatus.VERIFIED)
        );

        // --- Step 2: CRE syncs passport ---
        vm.prank(cre);
        (uint256 tokenId, ICompliancePassport.PassportStatus status) = passport.syncPassport(user);

        assertEq(tokenId, 1);
        assertEq(uint8(status), uint8(ICompliancePassport.PassportStatus.LIMITED));
        assertEq(passport.ownerOf(1), user);

        // --- Step 3: AccessGate check after KYC only ---
        assertTrue(gate.canAccessDealRoom(user));
        assertFalse(gate.canAccessInvestorArea(user));
        assertFalse(gate.canInvest(user));

        // --- Step 4: CRE submits Accredited Investor claim ---
        vm.prank(cre);
        registry.submitClaim(user, ACC, true, VER_ACC, ATTEST_ACC, EXPIRY);

        assertEq(
            uint8(registry.getClaimStatus(user, ACC)),
            uint8(IClaimRegistry.ClaimStatus.VERIFIED)
        );

        // --- Step 5: CRE syncs passport again ---
        vm.prank(cre);
        (, ICompliancePassport.PassportStatus statusAfter) = passport.syncPassport(user);

        assertEq(uint8(statusAfter), uint8(ICompliancePassport.PassportStatus.GREEN));

        // --- Step 6: AccessGate grants full access ---
        assertTrue(gate.canAccessDealRoom(user));
        assertTrue(gate.canAccessInvestorArea(user));
        assertTrue(gate.canInvest(user));

        // Token ID unchanged — same passport updated, not re-minted
        assertEq(passport.tokenIdOf(user), 1);

        // getAccessSummary confirms everything
        AccessGate.AccessSummary memory summary = gate.getAccessSummary(user);
        assertTrue(summary.canAccessDealRoom);
        assertTrue(summary.canAccessInvestorArea);
        assertTrue(summary.canInvest);
        assertEq(uint8(summary.passportStatus), uint8(ICompliancePassport.PassportStatus.GREEN));
    }

    function test_kyc_failed_blocks_all_access() public {
        vm.prank(cre);
        registry.submitClaim(user, KYC, false, VER_KYC, ATTEST_KYC, EXPIRY);

        vm.prank(cre);
        (, ICompliancePassport.PassportStatus status) = passport.syncPassport(user);

        assertEq(uint8(status), uint8(ICompliancePassport.PassportStatus.RED));
        assertFalse(gate.canAccessDealRoom(user));
        assertFalse(gate.canAccessInvestorArea(user));
    }

    function test_accreditation_failed_keeps_deal_room_open() public {
        // KYC passes
        vm.prank(cre);
        registry.submitClaim(user, KYC, true, VER_KYC, ATTEST_KYC, EXPIRY);
        vm.prank(cre);
        passport.syncPassport(user);

        // Accreditation fails
        vm.prank(cre);
        registry.submitClaim(user, ACC, false, VER_ACC, ATTEST_ACC, EXPIRY);
        vm.prank(cre);
        (, ICompliancePassport.PassportStatus status) = passport.syncPassport(user);

        // Passport stays LIMITED — not RED
        assertEq(uint8(status), uint8(ICompliancePassport.PassportStatus.LIMITED));
        assertTrue(gate.canAccessDealRoom(user));
        assertFalse(gate.canAccessInvestorArea(user));
    }

    function test_passport_is_soulbound() public {
        vm.prank(cre);
        registry.submitClaim(user, KYC, true, VER_KYC, ATTEST_KYC, EXPIRY);
        vm.prank(cre);
        passport.syncPassport(user);

        assertTrue(passport.locked(1));

        vm.prank(user);
        vm.expectRevert("CompliancePassport: soulbound, transfers disabled");
        passport.transferFrom(user, makeAddr("thief"), 1);
    }

    function test_replay_attack_rejected() public {
        vm.prank(cre);
        registry.submitClaim(user, KYC, true, VER_KYC, ATTEST_KYC, EXPIRY);

        vm.prank(cre);
        vm.expectRevert("ClaimRegistry: verificationId already used");
        registry.submitClaim(user, KYC, true, VER_KYC, ATTEST_KYC, EXPIRY);
    }
}
