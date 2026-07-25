// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PassportSubnameRegistrar} from "../src/ens/PassportSubnameRegistrar.sol";
import {PassportResolver} from "../src/ens/PassportResolver.sol";

/// Records the setSubnodeRecord call and returns a deterministic node
/// (the same formula the real NameWrapper uses). Fields are stored individually
/// because auto-generated struct getters omit dynamic (string) members.
contract MockNameWrapper {
    bool public called;
    bytes32 public lastParentNode;
    string public lastLabel;
    address public lastOwner;
    address public lastResolver;
    uint64 public lastTtl;
    uint32 public lastFuses;
    uint64 public lastExpiry;

    function setSubnodeRecord(
        bytes32 parentNode,
        string calldata label,
        address owner,
        address resolver,
        uint64 ttl,
        uint32 fuses,
        uint64 expiry
    ) external returns (bytes32 node) {
        called = true;
        lastParentNode = parentNode;
        lastLabel = label;
        lastOwner = owner;
        lastResolver = resolver;
        lastTtl = ttl;
        lastFuses = fuses;
        lastExpiry = expiry;
        return keccak256(abi.encodePacked(parentNode, keccak256(bytes(label))));
    }
}

/// Minimal IIdentityLookup so the resolver constructor's code.length check passes.
contract MockLookup {
    function identityOfWallet(address) external pure returns (address) {
        return address(0);
    }
}

contract PassportSubnameRegistrarTest is Test {
    MockNameWrapper wrapper;
    PassportResolver resolver;
    PassportSubnameRegistrar registrar;

    bytes32 parentNode = keccak256("brandx.eth");
    address userWallet = address(0xA11CE);
    address identity = address(0xBEEF);
    uint256 policyId = 1;

    function setUp() public {
        wrapper = new MockNameWrapper();
        resolver = new PassportResolver(address(new MockLookup()), address(0)); // factory unused here; no score registry
        registrar = new PassportSubnameRegistrar(address(wrapper), address(resolver), address(this));
        // registrar is the tenant's controller so resolver.setIdentity is authorized
        resolver.setTenant(parentNode, address(0xDEAD), policyId, address(registrar));
    }

    function test_issueSubname_calls_wrapper_with_right_args() public {
        string memory label = "alice";
        registrar.issueSubname(parentNode, label, userWallet, identity);

        assertTrue(wrapper.called());
        assertEq(wrapper.lastParentNode(), parentNode);
        assertEq(wrapper.lastLabel(), label);
        assertEq(wrapper.lastOwner(), userWallet);
        assertEq(wrapper.lastResolver(), address(resolver));
        assertEq(uint256(wrapper.lastTtl()), 0);
        assertEq(uint256(wrapper.lastFuses()), uint256(registrar.FUSES()));
        assertEq(uint256(wrapper.lastExpiry()), uint256(registrar.EXPIRY()));
    }

    function test_issueSubname_binds_node_to_identity() public {
        bytes32 node = registrar.issueSubname(parentNode, "alice", userWallet, identity);

        bytes32 expected = keccak256(abi.encodePacked(parentNode, keccak256(bytes("alice"))));
        assertEq(node, expected);
        assertEq(resolver.identityOf(node), identity);
        assertEq(resolver.parentOf(node), parentNode);
    }

    function test_issueSubname_reverts_if_registrar_not_controller() public {
        // a parent whose controller is NOT the registrar -> resolver.setIdentity reverts
        bytes32 otherParent = keccak256("acme.eth");
        resolver.setTenant(otherParent, address(0xDEAD), policyId, address(0xCAFE));
        vm.expectRevert(PassportResolver.NotController.selector);
        registrar.issueSubname(otherParent, "bob", userWallet, identity);
    }

    function test_issueSubname_onlyIssuer_reverts() public {
        vm.prank(address(0xBAD));
        vm.expectRevert();
        registrar.issueSubname(parentNode, "x", userWallet, identity);
    }
}
