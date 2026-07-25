// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EligibilityGate} from "../src/EligibilityGate.sol";
import {ClaimTopics} from "../src/libraries/Types.sol";

contract MockRegistry {
    function issuersForTopic(uint256) external pure returns (address[] memory) {
        return new address[](0);
    }
}

contract EligibilityGateTest is Test {
    address internal admin = address(0xA11CE);

    function test_eoa_identity_returns_no_identity() public {
        EligibilityGate gate = new EligibilityGate(admin, address(new MockRegistry()));

        uint256[] memory topics = new uint256[](1);
        topics[0] = ClaimTopics.KYC_VERIFIED;

        vm.prank(admin);
        gate.setPolicy(1, topics);

        (bool ok, bytes32 reason) = gate.isEligible(address(0xE0A), 1);
        assertFalse(ok);
        assertEq(reason, bytes32("NO_IDENTITY"));
    }

    function test_zero_registry_reverts() public {
        vm.expectRevert(EligibilityGate.ZeroIssuerRegistry.selector);
        new EligibilityGate(admin, address(0));
    }

    /// An unset policy must FAIL-CLOSED (deny), never allow-all. identity=address(this) is a
    /// contract so it passes the code.length check and reaches the empty-policy branch.
    function test_unset_policy_denies() public {
        EligibilityGate gate = new EligibilityGate(admin, address(new MockRegistry()));
        (bool ok, bytes32 reason) = gate.isEligible(address(this), 999);
        assertFalse(ok);
        assertEq(reason, bytes32("NO_POLICY"));
    }
}
