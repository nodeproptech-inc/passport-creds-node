// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClaimRegistry} from "../src/ClaimRegistry.sol";
import {IClaimRegistry} from "../src/interfaces/IClaimRegistry.sol";

contract ClaimRegistryTest is Test {
    ClaimRegistry registry;

    address admin = makeAddr("admin");
    address updater = makeAddr("updater");
    address user = makeAddr("user");

    bytes32 constant KYC = keccak256("KYC_AML_VERIFIED");
    bytes32 constant ACC = keccak256("ACCREDITED_INVESTOR");

    bytes32 constant VER_HASH_1 = keccak256("ver_001");
    bytes32 constant VER_HASH_2 = keccak256("ver_002");
    bytes32 constant ATTEST_HASH = keccak256("attest_001");
    uint64 FUTURE;

    function setUp() public {
        FUTURE = uint64(block.timestamp + 365 days);
        registry = new ClaimRegistry(admin);
        vm.startPrank(admin);
        registry.grantRole(registry.CRE_UPDATER_ROLE(), updater);
        vm.stopPrank();
    }

    // --- submitClaim ---

    function test_submitClaim_kyc_approved() public {
        vm.prank(updater);
        registry.submitClaim(user, KYC, true, VER_HASH_1, ATTEST_HASH, FUTURE);

        IClaimRegistry.Claim memory c = registry.getClaim(user, KYC);
        assertEq(uint8(c.status), uint8(IClaimRegistry.ClaimStatus.VERIFIED));
        assertTrue(c.approved);
        assertEq(c.attestationHash, ATTEST_HASH);
        assertEq(c.verificationIdHash, VER_HASH_1);
    }

    function test_submitClaim_kyc_failed() public {
        vm.prank(updater);
        registry.submitClaim(user, KYC, false, VER_HASH_1, ATTEST_HASH, FUTURE);

        assertEq(uint8(registry.getClaimStatus(user, KYC)), uint8(IClaimRegistry.ClaimStatus.FAILED));
    }

    function test_submitClaim_accredited_approved() public {
        vm.prank(updater);
        registry.submitClaim(user, ACC, true, VER_HASH_1, ATTEST_HASH, FUTURE);

        assertTrue(registry.hasValidClaim(user, ACC));
    }

    function test_submitClaim_reverts_non_updater() public {
        vm.prank(user);
        vm.expectRevert();
        registry.submitClaim(user, KYC, true, VER_HASH_1, ATTEST_HASH, FUTURE);
    }

    function test_submitClaim_reverts_duplicate_verificationId() public {
        vm.startPrank(updater);
        registry.submitClaim(user, KYC, true, VER_HASH_1, ATTEST_HASH, FUTURE);

        vm.expectRevert("ClaimRegistry: verificationId already used");
        registry.submitClaim(user, KYC, true, VER_HASH_1, ATTEST_HASH, FUTURE);
        vm.stopPrank();
    }

    function test_submitClaim_reverts_unsupported_claim_type() public {
        vm.prank(updater);
        vm.expectRevert("ClaimRegistry: unsupported claim type");
        registry.submitClaim(user, keccak256("UNKNOWN_CLAIM"), true, VER_HASH_1, ATTEST_HASH, FUTURE);
    }

    function test_submitClaim_reverts_zero_address() public {
        vm.prank(updater);
        vm.expectRevert("ClaimRegistry: zero address");
        registry.submitClaim(address(0), KYC, true, VER_HASH_1, ATTEST_HASH, FUTURE);
    }

    function test_submitClaim_reverts_missing_attestation_hash() public {
        vm.prank(updater);
        vm.expectRevert("ClaimRegistry: missing attestation hash");
        registry.submitClaim(user, KYC, true, VER_HASH_1, bytes32(0), FUTURE);
    }

    function test_submitClaim_emits_ClaimUpdated() public {
        vm.prank(updater);
        vm.expectEmit(true, true, true, true);
        emit IClaimRegistry.ClaimUpdated(
            user, KYC, IClaimRegistry.ClaimStatus.VERIFIED, true, VER_HASH_1, ATTEST_HASH, FUTURE
        );
        registry.submitClaim(user, KYC, true, VER_HASH_1, ATTEST_HASH, FUTURE);
    }

    // --- hasValidClaim ---

    function test_hasValidClaim_true_for_verified_non_expired() public {
        vm.prank(updater);
        registry.submitClaim(user, KYC, true, VER_HASH_1, ATTEST_HASH, FUTURE);

        assertTrue(registry.hasValidClaim(user, KYC));
    }

    function test_hasValidClaim_false_for_failed_claim() public {
        vm.prank(updater);
        registry.submitClaim(user, KYC, false, VER_HASH_1, ATTEST_HASH, FUTURE);

        assertFalse(registry.hasValidClaim(user, KYC));
    }

    function test_hasValidClaim_false_for_expired_claim() public {
        // Submit with an expiry 1 second in the future, then warp past it
        uint64 expiresAt = uint64(block.timestamp + 1);
        vm.startPrank(updater);
        registry.submitClaim(user, KYC, true, VER_HASH_1, ATTEST_HASH, expiresAt);
        vm.stopPrank();

        vm.warp(block.timestamp + 2);
        assertFalse(registry.hasValidClaim(user, KYC));
    }

    function test_hasValidClaim_true_when_no_expiry() public {
        vm.prank(updater);
        registry.submitClaim(user, KYC, true, VER_HASH_1, ATTEST_HASH, 0);

        assertTrue(registry.hasValidClaim(user, KYC));
    }

    // --- revokeClaim ---

    function test_revokeClaim_sets_status_revoked() public {
        vm.prank(updater);
        registry.submitClaim(user, KYC, true, VER_HASH_1, ATTEST_HASH, FUTURE);

        vm.prank(admin);
        registry.revokeClaim(user, KYC);

        assertEq(uint8(registry.getClaimStatus(user, KYC)), uint8(IClaimRegistry.ClaimStatus.REVOKED));
        assertFalse(registry.hasValidClaim(user, KYC));
    }

    function test_revokeClaim_emits_ClaimRevoked() public {
        vm.prank(updater);
        registry.submitClaim(user, KYC, true, VER_HASH_1, ATTEST_HASH, FUTURE);

        vm.prank(admin);
        vm.expectEmit(true, true, false, false);
        emit IClaimRegistry.ClaimRevoked(user, KYC);
        registry.revokeClaim(user, KYC);
    }

    function test_revokeClaim_reverts_non_admin() public {
        vm.prank(updater);
        registry.submitClaim(user, KYC, true, VER_HASH_1, ATTEST_HASH, FUTURE);

        vm.prank(updater);
        vm.expectRevert();
        registry.revokeClaim(user, KYC);
    }

    // --- can submit different claims per user ---

    function test_two_claims_per_user() public {
        vm.startPrank(updater);
        registry.submitClaim(user, KYC, true, VER_HASH_1, ATTEST_HASH, FUTURE);
        registry.submitClaim(user, ACC, true, VER_HASH_2, ATTEST_HASH, FUTURE);
        vm.stopPrank();

        assertTrue(registry.hasValidClaim(user, KYC));
        assertTrue(registry.hasValidClaim(user, ACC));
    }
}
