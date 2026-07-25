// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager, SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

/// The slice of HouseTreasury the hook needs.
interface IHouseTreasuryStanding {
    function isAgentInGoodStanding(address wallet) external view returns (bool, bytes32);
    function isCompliantOwner(address wallet) external view returns (bool);
    function agentPerTxCap() external view returns (uint256);
}

/**
 * @title MandateHook
 * @notice Gates a house's CASA/mUSD budget pool. Compliant owners may LP and trade;
 *         the house's agent may swap (liquify its budget) while in good standing and
 *         within its per-transaction cap. Everyone else is refused. Exit is never
 *         gated. Actor arrives via hookData (see ComplianceHook — same trust caveat).
 */
contract MandateHook is BaseHook {
    error NotAuthorized(address wallet, bytes32 reasonCode);

    IHouseTreasuryStanding public immutable TREASURY;

    constructor(IPoolManager poolManager, IHouseTreasuryStanding treasury) BaseHook(poolManager) {
        TREASURY = treasury;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: true,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function _beforeSwap(address sender, PoolKey calldata, SwapParams calldata params, bytes calldata hookData)
        internal
        view
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        address actor = _actor(sender, hookData);
        if (!TREASURY.isCompliantOwner(actor)) {
            (bool ok, bytes32 reason) = TREASURY.isAgentInGoodStanding(actor);
            if (!ok) revert NotAuthorized(actor, reason);
            uint256 magnitude = params.amountSpecified < 0
                ? uint256(-params.amountSpecified)
                : uint256(params.amountSpecified);
            if (magnitude > TREASURY.agentPerTxCap()) revert NotAuthorized(actor, "OVER_PER_TX_CAP");
        }
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function _beforeAddLiquidity(address sender, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata hookData)
        internal
        view
        override
        returns (bytes4)
    {
        address actor = _actor(sender, hookData);
        if (!TREASURY.isCompliantOwner(actor)) revert NotAuthorized(actor, "NOT_OWNER");
        return BaseHook.beforeAddLiquidity.selector;
    }

    function _actor(address sender, bytes calldata hookData) internal pure returns (address) {
        return hookData.length == 32 ? abi.decode(hookData, (address)) : sender;
    }
}
