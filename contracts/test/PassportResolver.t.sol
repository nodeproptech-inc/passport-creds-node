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

/// Minimal IdentityFactory mock: a settable wallet -> identity map (matches identityOfWallet).
contract MockFactory {
    mapping(address => address) public identityOfWallet;

    function link(address wallet, address id) external {
        identityOfWallet[wallet] = id;
    }
}

/// Minimal ScoreRegistry mock: a settable wallet -> score map (matches scoreOf).
contract MockScore {
    mapping(address => uint256) public scoreOf;

    function set(address wallet, uint256 s) external {
        scoreOf[wallet] = s;
    }
}

contract PassportResolverTest is Test {
    PassportResolver resolver;
    MockGate gate;
    MockFactory factory;
    MockScore score;

    address controller = address(0xC0FFEE);
    address identity = address(0xBEEF);
    address agent = address(0xA6E17);
    uint256 policyId = 1;

    bytes32 parentNode = keccak256("brandx.eth");
    bytes32 node = keccak256("alice.brandx.eth");

    function setUp() public {
        factory = new MockFactory();
        score = new MockScore();
        resolver = new PassportResolver(address(factory), address(score));
        gate = new MockGate();
        resolver.setTenant(parentNode, address(gate), policyId, controller);
        vm.prank(controller);
        resolver.setIdentity(node, parentNode, identity);
    }

    // --- agent reputation (agent.reputation[<agent>], from ScoreRegistry) ---

    function test_reputation_returns_score_when_linked() public {
        factory.link(agent, identity);
        score.set(agent, 87);
        assertEq(resolver.text(node, resolver.agentReputationKey(agent)), "87");
    }

    function test_reputation_returns_zero_when_linked_no_score() public {
        factory.link(agent, identity);
        assertEq(resolver.text(node, resolver.agentReputationKey(agent)), "0");
    }

    function test_reputation_empty_when_not_linked() public {
        score.set(agent, 87); // score set, but agent not linked to this name
        assertEq(resolver.text(node, resolver.agentReputationKey(agent)), "");
    }

    function test_reputation_empty_when_no_registry() public {
        // a resolver deployed without a score registry disables the record
        PassportResolver noScore = new PassportResolver(address(factory), address(0));
        noScore.setTenant(parentNode, address(gate), policyId, controller);
        vm.prank(controller);
        noScore.setIdentity(node, parentNode, identity);
        factory.link(agent, identity);
        assertEq(noScore.text(node, noScore.agentReputationKey(agent)), "");
    }

    // --- ENSIP-25: agent-registration computed live ---

    function test_agentRegistration_returns_1_when_linked() public {
        factory.link(agent, identity); // linkAgent(agent -> alice's identity)
        assertEq(resolver.text(node, resolver.agentRegistrationKey(agent)), "1");
    }

    function test_agentRegistration_empty_when_not_linked() public view {
        assertEq(resolver.text(node, resolver.agentRegistrationKey(agent)), "");
    }

    function test_agentRegistration_empty_after_unlink() public {
        factory.link(agent, identity);
        assertEq(resolver.text(node, resolver.agentRegistrationKey(agent)), "1");
        factory.link(agent, address(0)); // unlinkAgent
        assertEq(resolver.text(node, resolver.agentRegistrationKey(agent)), "");
    }

    function test_agentRegistration_empty_when_linked_to_other_identity() public {
        factory.link(agent, address(0xD00D)); // linked, but to a different person
        assertEq(resolver.text(node, resolver.agentRegistrationKey(agent)), "");
    }

    function test_agentRegistration_empty_for_node_without_identity() public {
        factory.link(agent, identity);
        bytes32 unknown = keccak256("nobody.brandx.eth");
        assertEq(resolver.text(unknown, resolver.agentRegistrationKey(agent)), "");
    }

    function test_agentRegistration_empty_wrong_registry() public {
        factory.link(agent, identity);
        // Same shape, but a bogus registry field -> must not match (prefix/length differ).
        string memory bad =
            "agent-registration[0xdeadbeef][0x00000000000000000000000000000000000a6e17]";
        assertEq(resolver.text(node, bad), "");
    }

    function test_agentRegistration_empty_malformed_key() public {
        factory.link(agent, identity);
        assertEq(resolver.text(node, "agent-registration[]"), "");
        assertEq(resolver.text(node, "agent-registration[x][y]"), "");
    }

    function test_agentRegistration_case_insensitive() public {
        factory.link(agent, identity);
        // A client that emits the whole key uppercased must still verify.
        string memory upper = _uc(resolver.agentRegistrationKey(agent));
        assertEq(resolver.text(node, upper), "1");
    }

    function _uc(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        for (uint256 i; i < b.length; ++i) {
            uint8 c = uint8(b[i]);
            if (c >= 97 && c <= 122) b[i] = bytes1(c - 32); // a-z -> A-Z
        }
        return string(b);
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
