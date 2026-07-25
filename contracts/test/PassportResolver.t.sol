// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PassportResolver} from "../src/ens/PassportResolver.sol";

/// Minimal gate mock: eligibility is a settable flag, matching
/// isEligible(address identity, uint256 policyId) returns (bool, bytes32).
contract MockGate {
    bool public eligible = true;

    function setEligible(bool v) external {
        eligible = v;
    }

    function isEligible(address, uint256) external view returns (bool, bytes32) {
        if (eligible) return (true, bytes32("OK"));
        return (false, bytes32("REVOKED"));
    }
}

contract PassportResolverTest is Test {
    PassportResolver resolver;
    MockGate gate;

    address controller = address(0xC0FFEE);
    address identity = address(0xBEEF);
    uint256 policyId = 1;

    bytes32 parentNode = keccak256("brandx.eth");
    bytes32 node = keccak256("alice.brandx.eth");

    function setUp() public {
        resolver = new PassportResolver();
        gate = new MockGate();
        resolver.setTenant(parentNode, address(gate), policyId, controller);
        vm.prank(controller);
        resolver.setIdentity(node, parentNode, identity);
    }

    function test_status_green_when_eligible() public view {
        assertEq(resolver.text(node, "compliance.status"), "GREEN");
    }

    function test_status_flips_to_revoked_on_gate_flip() public {
        // the ENS money moment: no tx on the name, revocation flips the read
        gate.setEligible(false);
        assertEq(resolver.text(node, "compliance.status"), "REVOKED");
    }

    function test_status_none_for_unset_node() public view {
        bytes32 unknown = keccak256("nobody.brandx.eth");
        assertEq(resolver.text(unknown, "compliance.status"), "NONE");
    }

    function test_setIdentity_reverts_for_non_controller() public {
        bytes32 node2 = keccak256("bob.brandx.eth");
        vm.prank(address(0xBAD));
        vm.expectRevert(PassportResolver.NotController.selector);
        resolver.setIdentity(node2, parentNode, identity);
    }

    function test_identity_text_is_hex_address() public view {
        // identity == address(0xBEEF) -> lowercase 0x-prefixed 20-byte hex
        string memory got = resolver.text(node, "compliance.identity");
        assertEq(got, "0x000000000000000000000000000000000000beef");
    }

    function test_supportsInterface() public view {
        assertTrue(resolver.supportsInterface(0x59d1d43c)); // ITextResolver.text
        assertTrue(resolver.supportsInterface(0x01ffc9a7)); // ERC-165
        assertFalse(resolver.supportsInterface(0xffffffff));
    }

    function test_setTenant_takeover_reverts() public {
        // parentNode already has a controller (set in setUp); a different sender cannot overwrite it
        vm.prank(address(0xBAD));
        vm.expectRevert(PassportResolver.NotController.selector);
        resolver.setTenant(parentNode, address(gate), policyId, address(0xBAD));
    }

    function test_setTenant_controller_can_update() public {
        // the current controller can update the tenant config on the same parentNode
        uint256 newPolicyId = 99;
        vm.prank(controller);
        resolver.setTenant(parentNode, address(gate), newPolicyId, controller);

        (, uint256 gotPolicyId,) = resolver.tenantOf(parentNode);
        assertEq(gotPolicyId, newPolicyId);
    }

    function test_two_tenants_resolve_independently() public {
        // second tenant with its own gate, flipped off
        MockGate gate2 = new MockGate();
        gate2.setEligible(false);
        bytes32 parent2 = keccak256("acme.eth");
        bytes32 node2 = keccak256("carol.acme.eth");
        resolver.setTenant(parent2, address(gate2), policyId, controller);
        vm.prank(controller);
        resolver.setIdentity(node2, parent2, identity);

        assertEq(resolver.text(node, "compliance.status"), "GREEN");
        assertEq(resolver.text(node2, "compliance.status"), "REVOKED");
    }
}
