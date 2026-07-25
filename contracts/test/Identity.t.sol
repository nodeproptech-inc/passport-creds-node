// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Identity} from "../src/Identity.sol";
import {KeyPurpose, ClaimTopics} from "../src/libraries/Types.sol";

/// Minimal mocks so Identity can be tested before the real IssuerRegistry/ClaimIssuer exist.
contract MockIssuerRegistry {
    mapping(address => mapping(uint256 => bool)) public trusted;
    function setTrusted(address issuer, uint256 topic, bool ok) external { trusted[issuer][topic] = ok; }
    function isTrusted(address issuer, uint256 topic) external view returns (bool) { return trusted[issuer][topic]; }
    function issuersForTopic(uint256) external pure returns (address[] memory) { return new address[](0); }
}

contract MockClaimIssuer {
    bool public valid = true;
    function setValid(bool v) external { valid = v; }
    function isClaimValid(address, uint256, bytes calldata, bytes calldata) external view returns (bool) {
        return valid;
    }
}

contract IdentityTest is Test {
    Identity id;
    MockIssuerRegistry reg;
    MockClaimIssuer issuer;

    address owner = address(0xBEEF);
    address stranger = address(0xCAFE);

    uint256 kyc; // claim topic, set in setUp from ClaimTopics
    bytes sig = hex"01";
    bytes data = hex"02";

    function setUp() public {
        kyc = ClaimTopics.KYC_VERIFIED;
        reg = new MockIssuerRegistry();
        issuer = new MockClaimIssuer();
        id = new Identity(owner, address(reg));
        reg.setTrusted(address(issuer), kyc, true);
    }

    function test_owner_seeded_as_management() public view {
        // MANAGEMENT satisfies any purpose → owner passes CLAIM
        assertTrue(id.keyHasPurpose(id.keyForAddress(owner), KeyPurpose.CLAIM));
        assertFalse(id.keyHasPurpose(id.keyForAddress(stranger), KeyPurpose.CLAIM));
    }

    function test_getClaim_empty() public view {
        (bool exists,,) = id.getClaim(kyc, address(issuer));
        assertFalse(exists);
    }

    function test_submitClaim_by_owner_lands() public {
        vm.prank(owner);
        id.submitClaim(kyc, address(issuer), sig, data);
        (bool exists, bytes memory s, bytes memory d) = id.getClaim(kyc, address(issuer));
        assertTrue(exists);
        assertEq(s, sig);
        assertEq(d, data);
    }

    function test_submitClaim_nonOwner_reverts() public {
        vm.prank(stranger);
        vm.expectRevert(Identity.NoClaimKey.selector);
        id.submitClaim(kyc, address(issuer), sig, data);
    }

    function test_submitClaim_untrustedIssuer_reverts() public {
        MockClaimIssuer rogue = new MockClaimIssuer(); // not trusted in the registry
        vm.prank(owner);
        vm.expectRevert(Identity.UntrustedIssuer.selector);
        id.submitClaim(kyc, address(rogue), sig, data);
    }

    function test_submitClaim_badSignature_reverts() public {
        issuer.setValid(false);
        vm.prank(owner);
        vm.expectRevert(Identity.BadSignature.selector);
        id.submitClaim(kyc, address(issuer), sig, data);
    }

    function test_revokeClaim_holder_ok_and_hides_claim() public {
        vm.prank(owner);
        id.submitClaim(kyc, address(issuer), sig, data);
        vm.prank(owner);
        id.revokeClaim(kyc, address(issuer));
        (bool exists,,) = id.getClaim(kyc, address(issuer));
        assertFalse(exists); // holder-side removal hides it from the gate
    }

    function test_revokeClaim_stranger_reverts() public {
        vm.prank(owner);
        id.submitClaim(kyc, address(issuer), sig, data);
        vm.prank(stranger);
        vm.expectRevert(Identity.NoClaimKey.selector);
        id.revokeClaim(kyc, address(issuer));
    }

    /// Re-submitting the SAME (topic, issuer) updates in place and does NOT consume an extra
    /// cap slot (prevents accidental TopicCap lockout).
    function test_resubmit_same_pair_updates_in_place_no_cap_growth() public {
        vm.startPrank(owner);
        id.submitClaim(kyc, address(issuer), sig, hex"aa");
        id.submitClaim(kyc, address(issuer), sig, hex"bb"); // re-submit same pair
        vm.stopPrank();
        (bool exists,, bytes memory d) = id.getClaim(kyc, address(issuer));
        assertTrue(exists);
        assertEq(d, hex"bb"); // updated in place

        // the re-submit consumed no extra slot: exactly (cap-1) new issuers still fit, then it caps
        uint256 cap = id.MAX_CLAIMS_PER_TOPIC();
        for (uint256 i = 1; i < cap; ++i) {
            MockClaimIssuer mi = new MockClaimIssuer();
            reg.setTrusted(address(mi), kyc, true);
            vm.prank(owner);
            id.submitClaim(kyc, address(mi), sig, data);
        }
        MockClaimIssuer extra = new MockClaimIssuer();
        reg.setTrusted(address(extra), kyc, true);
        vm.prank(owner);
        vm.expectRevert(Identity.TopicCap.selector);
        id.submitClaim(kyc, address(extra), sig, data);
    }

    function test_revokeClaim_nonexistent_reverts() public {
        vm.prank(owner);
        vm.expectRevert(Identity.NoClaimToRevoke.selector);
        id.revokeClaim(kyc, address(issuer)); // never submitted
    }

    /// revokeClaim frees a cap slot: at MAX, revoking one lets a new issuer's claim land.
    function test_revoke_frees_cap_slot() public {
        uint256 cap = id.MAX_CLAIMS_PER_TOPIC();
        address first;
        for (uint256 i; i < cap; ++i) {
            MockClaimIssuer mi = new MockClaimIssuer();
            reg.setTrusted(address(mi), kyc, true);
            if (i == 0) first = address(mi);
            vm.prank(owner);
            id.submitClaim(kyc, address(mi), sig, data);
        }
        // at cap: a new issuer reverts
        MockClaimIssuer extra = new MockClaimIssuer();
        reg.setTrusted(address(extra), kyc, true);
        vm.prank(owner);
        vm.expectRevert(Identity.TopicCap.selector);
        id.submitClaim(kyc, address(extra), sig, data);
        // revoke one → frees the slot → the new issuer now fits
        vm.prank(owner);
        id.revokeClaim(kyc, first);
        vm.prank(owner);
        id.submitClaim(kyc, address(extra), sig, data);
        (bool exists,,) = id.getClaim(kyc, address(extra));
        assertTrue(exists);
    }

    /// MAX_CLAIMS_PER_TOPIC griefing cap: the (cap+1)-th trusted issuer's claim reverts.
    function test_maxClaimsPerTopic_cap() public {
        uint256 cap = id.MAX_CLAIMS_PER_TOPIC();
        for (uint256 i; i < cap; ++i) {
            MockClaimIssuer mi = new MockClaimIssuer();
            reg.setTrusted(address(mi), kyc, true);
            vm.prank(owner);
            id.submitClaim(kyc, address(mi), sig, data);
        }
        // one more trusted issuer over the cap → TopicCap
        MockClaimIssuer extra = new MockClaimIssuer();
        reg.setTrusted(address(extra), kyc, true);
        vm.prank(owner);
        vm.expectRevert(Identity.TopicCap.selector);
        id.submitClaim(kyc, address(extra), sig, data);
    }
}
