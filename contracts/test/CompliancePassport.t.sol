// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClaimRegistry} from "../src/ClaimRegistry.sol";
import {CompliancePassport} from "../src/CompliancePassport.sol";
import {ICompliancePassport} from "../src/interfaces/ICompliancePassport.sol";
import {IClaimRegistry} from "../src/interfaces/IClaimRegistry.sol";

contract CompliancePassportTest is Test {
    ClaimRegistry registry;
    CompliancePassport passport;

    address admin = makeAddr("admin");
    address updater = makeAddr("updater");
    address user = makeAddr("user");

    bytes32 constant KYC = keccak256("KYC_AML_VERIFIED");
    bytes32 constant ACC = keccak256("ACCREDITED_INVESTOR");
    bytes32 constant ATTEST = keccak256("attest");
    uint64 FUTURE;

    function setUp() public {
        FUTURE = uint64(block.timestamp + 365 days);
        registry = new ClaimRegistry(admin);
        passport = new CompliancePassport(admin, address(registry));

        vm.startPrank(admin);
        registry.grantRole(registry.CRE_UPDATER_ROLE(), updater);
        passport.grantRole(passport.CRE_UPDATER_ROLE(), updater);
        vm.stopPrank();
    }

    // --- helpers ---

    function _submitKYC(bool approved) internal {
        vm.prank(updater);
        registry.submitClaim(user, KYC, approved, keccak256("ver_kyc"), ATTEST, FUTURE);
    }

    function _submitACC(bool approved) internal {
        vm.prank(updater);
        registry.submitClaim(user, ACC, approved, keccak256("ver_acc"), ATTEST, FUTURE);
    }

    function _sync() internal returns (uint256 tokenId, ICompliancePassport.PassportStatus status) {
        vm.prank(updater);
        return passport.syncPassport(user);
    }

    // --- syncPassport ---

    function test_syncPassport_mints_on_first_call() public {
        _submitKYC(true);
        (uint256 tokenId, ICompliancePassport.PassportStatus status) = _sync();

        assertEq(tokenId, 1);
        assertEq(uint8(status), uint8(ICompliancePassport.PassportStatus.LIMITED));
        assertEq(passport.ownerOf(1), user);
    }

    function test_syncPassport_updates_on_second_call() public {
        _submitKYC(true);
        _sync();

        _submitACC(true);
        (, ICompliancePassport.PassportStatus status) = _sync();

        assertEq(uint8(status), uint8(ICompliancePassport.PassportStatus.GREEN));
    }

    function test_syncPassport_reverts_non_updater() public {
        vm.prank(user);
        vm.expectRevert();
        passport.syncPassport(user);
    }

    // --- computeStatus ---

    function test_computeStatus_none_when_no_claims() public view {
        assertEq(uint8(passport.computeStatus(user)), uint8(ICompliancePassport.PassportStatus.NONE));
    }

    function test_computeStatus_limited_after_kyc_only() public {
        _submitKYC(true);
        assertEq(uint8(passport.computeStatus(user)), uint8(ICompliancePassport.PassportStatus.LIMITED));
    }

    function test_computeStatus_green_after_both_claims() public {
        _submitKYC(true);
        _submitACC(true);
        assertEq(uint8(passport.computeStatus(user)), uint8(ICompliancePassport.PassportStatus.GREEN));
    }

    function test_computeStatus_red_after_kyc_failed() public {
        _submitKYC(false);
        assertEq(uint8(passport.computeStatus(user)), uint8(ICompliancePassport.PassportStatus.RED));
    }

    function test_computeStatus_limited_when_accredited_failed_but_kyc_verified() public {
        _submitKYC(true);
        _submitACC(false);
        // Failed accreditation alone does not make the passport RED
        assertEq(uint8(passport.computeStatus(user)), uint8(ICompliancePassport.PassportStatus.LIMITED));
    }

    // --- soulbound / non-transferable ---

    function test_token_is_locked() public {
        _submitKYC(true);
        (uint256 tokenId,) = _sync();
        assertTrue(passport.locked(tokenId));
    }

    function test_transfer_reverts() public {
        _submitKYC(true);
        _sync();

        vm.prank(user);
        vm.expectRevert("CompliancePassport: soulbound, transfers disabled");
        passport.transferFrom(user, makeAddr("other"), 1);
    }

    // --- revokePassport ---

    function test_revokePassport_sets_revoked_status() public {
        _submitKYC(true);
        _sync();

        vm.prank(admin);
        passport.revokePassport(user);

        assertEq(uint8(passport.statusOf(user)), uint8(ICompliancePassport.PassportStatus.REVOKED));
        assertTrue(passport.revokedWallet(user));
    }

    function test_revokePassport_reverts_non_admin() public {
        _submitKYC(true);
        _sync();

        vm.prank(updater);
        vm.expectRevert();
        passport.revokePassport(user);
    }

    // --- ERC5192 interface support ---

    function test_supportsInterface_erc5192() public view {
        assertTrue(passport.supportsInterface(0xb45a3c0e));
    }

    function test_supportsInterface_erc721() public view {
        assertTrue(passport.supportsInterface(0x80ac58cd));
    }
}
