// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HouseToken} from "../../src/agents/HouseToken.sol";

contract HouseTokenTest is Test {
    HouseToken token;
    address treasury = makeAddr("treasury");
    address agent = makeAddr("agent");

    function setUp() public {
        token = new HouseToken("Casa Azul Scrip", "CASA", treasury);
    }

    function test_treasury_can_mint() public {
        vm.prank(treasury);
        token.mint(agent, 100 ether);
        assertEq(token.balanceOf(agent), 100 ether);
    }

    function test_non_treasury_cannot_mint() public {
        vm.expectRevert(HouseToken.NotTreasury.selector);
        token.mint(agent, 1 ether);
    }

    function test_treasury_can_reclaim() public {
        vm.startPrank(treasury);
        token.mint(agent, 100 ether);
        token.reclaim(agent, 40 ether);
        vm.stopPrank();
        assertEq(token.balanceOf(agent), 60 ether);
    }

    function test_non_treasury_cannot_reclaim() public {
        vm.prank(treasury);
        token.mint(agent, 100 ether);
        vm.prank(agent);
        vm.expectRevert(HouseToken.NotTreasury.selector);
        token.reclaim(agent, 1 ether);
    }
}
