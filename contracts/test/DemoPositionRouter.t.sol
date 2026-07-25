// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {DemoPositionRouter} from "../src/demo/DemoPositionRouter.sol";

/**
 * The shared v4 test router keys positions by caller-supplied salt, which lets any
 * caller withdraw another wallet's position. DemoPositionRouter derives the salt
 * from msg.sender — these tests pin that property.
 */
contract DemoPositionRouterTest is Test {
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    PoolManager poolManager;
    DemoPositionRouter router;
    MockERC20 token0;
    MockERC20 token1;
    PoolKey poolKey;

    address alice = makeAddr("alice");
    address mallory = makeAddr("mallory");

    function setUp() public {
        poolManager = new PoolManager(address(this));
        router = new DemoPositionRouter(poolManager);

        MockERC20 tokenA = new MockERC20("Token A", "A", 18);
        MockERC20 tokenB = new MockERC20("Token B", "B", 18);
        (token0, token1) = address(tokenA) < address(tokenB) ? (tokenA, tokenB) : (tokenB, tokenA);

        for (uint256 i = 0; i < 2; i++) {
            address user = i == 0 ? alice : mallory;
            token0.mint(user, 1_000 ether);
            token1.mint(user, 1_000 ether);
            vm.startPrank(user);
            token0.approve(address(router), type(uint256).max);
            token1.approve(address(router), type(uint256).max);
            vm.stopPrank();
        }

        poolKey = PoolKey(Currency.wrap(address(token0)), Currency.wrap(address(token1)), 3000, 60, IHooks(address(0)));
        poolManager.initialize(poolKey, SQRT_PRICE_1_1);
    }

    function test_caller_can_add_and_exit_own_position() public {
        vm.startPrank(alice);
        router.modifyLiquidity(poolKey, -887220, 887220, 10e18, "");
        uint256 balanceBefore = token0.balanceOf(alice);
        router.modifyLiquidity(poolKey, -887220, 887220, -10e18, "");
        vm.stopPrank();

        assertGt(token0.balanceOf(alice), balanceBefore);
    }

    function test_caller_cannot_exit_anothers_position() public {
        vm.prank(alice);
        router.modifyLiquidity(poolKey, -887220, 887220, 10e18, "");

        // mallory has no position through this router — her salt is her own address,
        // so a withdrawal attempt hits an empty position and reverts
        vm.prank(mallory);
        vm.expectRevert();
        router.modifyLiquidity(poolKey, -887220, 887220, -5e18, "");

        // alice's position is intact: she can still withdraw everything
        vm.prank(alice);
        router.modifyLiquidity(poolKey, -887220, 887220, -10e18, "");
    }
}
