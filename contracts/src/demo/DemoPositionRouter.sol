// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CurrencyLibrary, Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IPoolManager, ModifyLiquidityParams} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolTestBase} from "@uniswap/v4-core/src/test/PoolTestBase.sol";
import {CurrencySettler} from "@uniswap/v4-core/test/utils/CurrencySettler.sol";

/**
 * @title DemoPositionRouter
 * @notice Owner-aware liquidity router for the hook demo.
 *
 * The stock v4 PoolModifyLiquidityTest router keys positions by a caller-supplied
 * salt, so on a shared deployment any caller can withdraw another wallet's position
 * by passing that wallet's (publicly derivable) salt. This router closes that hole:
 * the salt is always derived from msg.sender, so a caller can only ever touch their
 * own position. Demo-grade otherwise — no swap support, no claims accounting.
 */
contract DemoPositionRouter is PoolTestBase {
    using CurrencySettler for Currency;

    error NotPoolManager();

    struct CallbackData {
        address sender;
        PoolKey key;
        ModifyLiquidityParams params;
        bytes hookData;
    }

    constructor(IPoolManager _manager) PoolTestBase(_manager) {}

    /**
     * @notice Adds (positive delta) or removes (negative delta) liquidity for the
     *         caller's own position in the given range.
     */
    function modifyLiquidity(
        PoolKey memory key,
        int24 tickLower,
        int24 tickUpper,
        int256 liquidityDelta,
        bytes memory hookData
    ) external payable returns (BalanceDelta delta) {
        ModifyLiquidityParams memory params = ModifyLiquidityParams({
            tickLower: tickLower,
            tickUpper: tickUpper,
            liquidityDelta: liquidityDelta,
            salt: bytes32(uint256(uint160(msg.sender)))
        });
        delta = abi.decode(
            manager.unlock(abi.encode(CallbackData(msg.sender, key, params, hookData))), (BalanceDelta)
        );
    }

    function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
        if (msg.sender != address(manager)) revert NotPoolManager();

        CallbackData memory data = abi.decode(rawData, (CallbackData));
        (BalanceDelta delta,) = manager.modifyLiquidity(data.key, data.params, data.hookData);

        (,, int256 delta0) = _fetchBalances(data.key.currency0, data.sender, address(this));
        (,, int256 delta1) = _fetchBalances(data.key.currency1, data.sender, address(this));

        if (delta0 < 0) data.key.currency0.settle(manager, data.sender, uint256(-delta0), false);
        if (delta1 < 0) data.key.currency1.settle(manager, data.sender, uint256(-delta1), false);
        if (delta0 > 0) data.key.currency0.take(manager, data.sender, uint256(delta0), false);
        if (delta1 > 0) data.key.currency1.take(manager, data.sender, uint256(delta1), false);

        return abi.encode(delta);
    }
}
