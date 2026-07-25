// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GatedERC20} from "../src/GatedERC20.sol";

/// Minimal mocks so GatedERC20 can be tested without the real Gate/Factory stack.
/// MockResolver maps wallet -> identity; MockGate holds a settable eligibility map keyed by identity.
contract MockResolver {
    mapping(address => address) public identityOfWallet;

    function setIdentity(address wallet, address identity) external {
        identityOfWallet[wallet] = identity;
    }
}

contract MockGate {
    mapping(address => bool) public eligible; // identity => eligible
    bytes32 public constant REASON_MISSING = bytes32("MISSING_KYC");
    bytes32 public constant REASON_NO_IDENTITY = bytes32("NO_IDENTITY");

    function setEligible(address identity, bool ok) external {
        eligible[identity] = ok;
    }

    function isEligible(address identity, uint256) external view returns (bool, bytes32) {
        if (identity == address(0)) return (false, REASON_NO_IDENTITY);
        if (eligible[identity]) return (true, bytes32("OK"));
        return (false, REASON_MISSING);
    }
}

contract GatedERC20Test is Test {
    GatedERC20 token;
    MockResolver resolver;
    MockGate gate;

    uint256 constant POLICY_ID = 1;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA401);

    // identities behind each wallet
    address aliceId = address(0x1A);
    address bobId = address(0x1B);
    address carolId = address(0x1C);

    function setUp() public {
        resolver = new MockResolver();
        gate = new MockGate();

        resolver.setIdentity(alice, aliceId);
        resolver.setIdentity(bob, bobId);
        resolver.setIdentity(carol, carolId);

        // alice and bob are eligible; carol is not
        gate.setEligible(aliceId, true);
        gate.setEligible(bobId, true);
        gate.setEligible(carolId, false);

        token = new GatedERC20("Gated", "GTD", address(gate), address(resolver), POLICY_ID, address(this));
    }

    // ---- mint ----

    function test_mint_toEligible_works() public {
        token.mint(alice, 100);
        assertEq(token.balanceOf(alice), 100);
        assertEq(token.totalSupply(), 100);
    }

    function test_mint_toNonEligible_reverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(GatedERC20.NotEligible.selector, carol, bytes32("MISSING_KYC"))
        );
        token.mint(carol, 100);
    }

    // ---- transfer ----

    function test_transfer_eligibleToEligible_works() public {
        token.mint(alice, 100);
        vm.prank(alice);
        token.transfer(bob, 40);
        assertEq(token.balanceOf(alice), 60);
        assertEq(token.balanceOf(bob), 40);
    }

    function test_transfer_revertsWhenFromNotEligible() public {
        // alice holds tokens, then loses eligibility -> her transfer must fail (the money moment)
        token.mint(alice, 100);
        gate.setEligible(aliceId, false);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(GatedERC20.NotEligible.selector, alice, bytes32("MISSING_KYC"))
        );
        token.transfer(bob, 40);

        // balances untouched
        assertEq(token.balanceOf(alice), 100);
        assertEq(token.balanceOf(bob), 0);
    }

    function test_transfer_revertsWhenToNotEligible() public {
        token.mint(alice, 100);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(GatedERC20.NotEligible.selector, carol, bytes32("MISSING_KYC"))
        );
        token.transfer(carol, 40);

        assertEq(token.balanceOf(alice), 100);
        assertEq(token.balanceOf(carol), 0);
    }

    // ---- burn (free exit) ----

    function test_burn_allowedEvenWhenHolderNotEligible() public {
        token.mint(alice, 100);
        // alice loses eligibility: she can no longer transfer, but exit must stay free
        gate.setEligible(aliceId, false);

        // sanity: transfer is now blocked
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(GatedERC20.NotEligible.selector, alice, bytes32("MISSING_KYC"))
        );
        token.transfer(bob, 1);

        // burn still succeeds -> we never trap funds (holder burns their own tokens)
        vm.prank(alice);
        token.burn(60);

        assertEq(token.balanceOf(alice), 40);
        assertEq(token.totalSupply(), 40);
    }

    // ---- mint access control ----

    function test_mint_onlyMinter_reverts() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert();
        token.mint(address(0xBEEF), 1);
    }
}
