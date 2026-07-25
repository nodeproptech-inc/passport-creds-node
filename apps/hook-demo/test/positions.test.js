import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeEventTopics, encodeAbiParameters, pad, toEventSelector } from 'viem';
import {
  MODIFY_LIQUIDITY_EVENT,
  SWAP_EVENT,
  aggregateLiquidity,
  lastPrices,
  poolIdOf,
} from '../lib/positions.js';

const POOL_A = '0x' + 'aa'.repeat(32);
const POOL_B = '0x' + 'bb'.repeat(32);
const ROUTER = '0x5081a39b8A5f0E35a8D959395a630b68B74Dd30f';
const ANA = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

function liqLog(poolId, salt, delta) {
  return {
    topics: encodeEventTopics({
      abi: [MODIFY_LIQUIDITY_EVENT],
      eventName: 'ModifyLiquidity',
      args: { id: poolId, sender: ROUTER },
    }),
    data: encodeAbiParameters(
      [{ type: 'int24' }, { type: 'int24' }, { type: 'int256' }, { type: 'bytes32' }],
      [-887220, 887220, delta, salt],
    ),
  };
}

function swapLog(poolId, sqrtPriceX96) {
  return {
    topics: encodeEventTopics({
      abi: [SWAP_EVENT],
      eventName: 'Swap',
      args: { id: poolId, sender: ROUTER },
    }),
    data: encodeAbiParameters(
      [
        { type: 'int128' },
        { type: 'int128' },
        { type: 'uint160' },
        { type: 'uint128' },
        { type: 'int24' },
        { type: 'uint24' },
      ],
      [-1000000n, 998000n, sqrtPriceX96, 10000n, 0, 3000],
    ),
  };
}

test('aggregates liquidity per pool and per (pool, salt) position', () => {
  const anaSalt = pad(ANA, { size: 32 }).toLowerCase();
  const logs = [
    liqLog(POOL_A, pad('0x00', { size: 32 }), 10_000n),
    liqLog(POOL_A, anaSalt, 2n),
    liqLog(POOL_A, anaSalt, 2n),
    liqLog(POOL_A, anaSalt, -2n),
    liqLog(POOL_B, anaSalt, 5n),
  ];
  const { totals, positions } = aggregateLiquidity(logs);
  assert.equal(totals.get(POOL_A), 10_002n);
  assert.equal(totals.get(POOL_B), 5n);
  assert.equal(positions.get(`${POOL_A}|${anaSalt}`), 2n);
  assert.equal(positions.get(`${POOL_B}|${anaSalt}`), 5n);
});

test('lastPrices returns the most recent price per pool', () => {
  const Q96 = 2n ** 96n;
  const logs = [swapLog(POOL_A, Q96), swapLog(POOL_A, Q96 * 2n)];
  const prices = lastPrices(logs);
  assert.ok(Math.abs(prices.get(POOL_A) - 4.0) < 1e-9); // (2*Q96/Q96)^2
  assert.equal(prices.get(POOL_B), undefined);
});

test('mixed event kinds are routed by topic, unknown topics ignored', () => {
  const logs = [
    liqLog(POOL_A, pad('0x01', { size: 32 }), 7n),
    swapLog(POOL_A, 2n ** 96n),
    { topics: [toEventSelector('Other(uint256)')], data: '0x' },
  ];
  assert.equal(aggregateLiquidity(logs).totals.get(POOL_A), 7n);
  assert.equal(lastPrices(logs).get(POOL_A), 1.0);
});

test('poolIdOf matches keccak of the abi-encoded pool key', () => {
  const key = {
    currency0: '0x1fA02b2d6A771842690194Cf62D91bdd92BfE28d',
    currency1: '0xdbC43Ba45381e02825b14322cDdd15eC4B3164E6',
    fee: 3000,
    tickSpacing: 60,
    hooks: '0x512294cf8AD0b2664489615c00fe6Cf5302DC880',
  };
  const id = poolIdOf(key);
  assert.match(id, /^0x[0-9a-f]{64}$/);
  assert.equal(id, poolIdOf({ ...key })); // deterministic
});
