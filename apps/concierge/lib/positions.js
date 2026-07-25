import { decodeEventLog, encodeAbiParameters, keccak256, toEventSelector } from 'viem';

// v4-core PoolManager events (IPoolManager.sol)
export const MODIFY_LIQUIDITY_EVENT = {
  type: 'event',
  name: 'ModifyLiquidity',
  inputs: [
    { name: 'id', type: 'bytes32', indexed: true },
    { name: 'sender', type: 'address', indexed: true },
    { name: 'tickLower', type: 'int24', indexed: false },
    { name: 'tickUpper', type: 'int24', indexed: false },
    { name: 'liquidityDelta', type: 'int256', indexed: false },
    { name: 'salt', type: 'bytes32', indexed: false },
  ],
};

export const SWAP_EVENT = {
  type: 'event',
  name: 'Swap',
  inputs: [
    { name: 'id', type: 'bytes32', indexed: true },
    { name: 'sender', type: 'address', indexed: true },
    { name: 'amount0', type: 'int128', indexed: false },
    { name: 'amount1', type: 'int128', indexed: false },
    { name: 'sqrtPriceX96', type: 'uint160', indexed: false },
    { name: 'liquidity', type: 'uint128', indexed: false },
    { name: 'tick', type: 'int24', indexed: false },
    { name: 'fee', type: 'uint24', indexed: false },
  ],
};

export const MODIFY_LIQUIDITY_TOPIC = toEventSelector(MODIFY_LIQUIDITY_EVENT);
export const SWAP_TOPIC = toEventSelector(SWAP_EVENT);

// poolId = keccak256(abi.encode(PoolKey))
export function poolIdOf(key) {
  return keccak256(
    encodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            { name: 'currency0', type: 'address' },
            { name: 'currency1', type: 'address' },
            { name: 'fee', type: 'uint24' },
            { name: 'tickSpacing', type: 'int24' },
            { name: 'hooks', type: 'address' },
          ],
        },
      ],
      [key],
    ),
  );
}

// Sums ModifyLiquidity deltas: per pool (totals) and per (pool, salt) position.
export function aggregateLiquidity(logs) {
  const totals = new Map();
  const positions = new Map();
  for (const log of logs) {
    if (log.topics?.[0] !== MODIFY_LIQUIDITY_TOPIC) continue;
    const { args } = decodeEventLog({ abi: [MODIFY_LIQUIDITY_EVENT], data: log.data, topics: log.topics });
    const id = args.id.toLowerCase();
    const salt = args.salt.toLowerCase();
    totals.set(id, (totals.get(id) ?? 0n) + args.liquidityDelta);
    const key = `${id}|${salt}`;
    positions.set(key, (positions.get(key) ?? 0n) + args.liquidityDelta);
  }
  return { totals, positions };
}

// Latest price per pool from Swap events: (sqrtPriceX96 / 2^96)^2
export function lastPrices(logs) {
  const prices = new Map();
  for (const log of logs) {
    if (log.topics?.[0] !== SWAP_TOPIC) continue;
    const { args } = decodeEventLog({ abi: [SWAP_EVENT], data: log.data, topics: log.topics });
    const ratio = Number(args.sqrtPriceX96) / 2 ** 96;
    prices.set(args.id.toLowerCase(), ratio * ratio);
  }
  return prices;
}
