// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ScoreRegistry} from "../src/ScoreRegistry.sol";

contract ScoreRegistryTest is Test {
    ScoreRegistry reg;
    address admin = address(0xAD1);
    address agent = address(0xA6E17);

    event ScoreSet(address indexed agent, uint256 score);

    function setUp() public {
        reg = new ScoreRegistry(admin);
    }

    function test_scorer_can_set_score() public {
        vm.prank(admin);
        reg.setScore(agent, 42);
        assertEq(reg.scoreOf(agent), 42);
    }

    function test_non_scorer_reverts() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(); // AccessControlUnauthorizedAccount
        reg.setScore(agent, 42);
    }

    function test_constructor_zero_admin_reverts() public {
        vm.expectRevert(ScoreRegistry.ZeroAdmin.selector);
        new ScoreRegistry(address(0));
    }

    function test_setScore_emits() public {
        vm.expectEmit(true, false, false, true);
        emit ScoreSet(agent, 42);
        vm.prank(admin);
        reg.setScore(agent, 42);
    }
}
