// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IssuerRegistry} from "../src/IssuerRegistry.sol";
import {ClaimTopics} from "../src/libraries/Types.sol";

contract IssuerRegistryTest is Test {
    IssuerRegistry reg;
    address admin = address(0xA11CE);
    address stranger = address(0xCAFE);
    address issuerA = address(0xAA);
    address issuerB = address(0xBB);
    address issuerC = address(0xCC);
    uint256 kyc;

    function setUp() public {
        kyc = ClaimTopics.KYC_VERIFIED;
        reg = new IssuerRegistry(admin);
    }

    function test_setTrusted_adds() public {
        vm.prank(admin);
        reg.setTrusted(issuerA, kyc, true);
        assertTrue(reg.isTrusted(issuerA, kyc));
        address[] memory list = reg.issuersForTopic(kyc);
        assertEq(list.length, 1);
        assertEq(list[0], issuerA);
    }

    function test_setTrusted_removes() public {
        vm.startPrank(admin);
        reg.setTrusted(issuerA, kyc, true);
        reg.setTrusted(issuerA, kyc, false);
        vm.stopPrank();
        assertFalse(reg.isTrusted(issuerA, kyc));
        assertEq(reg.issuersForTopic(kyc).length, 0);
    }

    function test_swapPop_keeps_set_consistent() public {
        vm.startPrank(admin);
        reg.setTrusted(issuerA, kyc, true);
        reg.setTrusted(issuerB, kyc, true);
        reg.setTrusted(issuerC, kyc, true);
        reg.setTrusted(issuerB, kyc, false); // remove the middle one
        vm.stopPrank();
        assertEq(reg.issuersForTopic(kyc).length, 2);
        assertFalse(reg.isTrusted(issuerB, kyc));
        assertTrue(reg.isTrusted(issuerA, kyc));
        assertTrue(reg.isTrusted(issuerC, kyc));
    }

    function test_nonAdmin_reverts() public {
        vm.prank(stranger);
        vm.expectRevert();
        reg.setTrusted(issuerA, kyc, true);
    }
}
