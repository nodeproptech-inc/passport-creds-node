import { decodeErrorResult, getAddress, hexToString } from 'viem';

// ComplianceHook.NotCompliant(address wallet, bytes32 reasonCode)
export const NOT_COMPLIANT_ABI = [
  {
    type: 'error',
    name: 'NotCompliant',
    inputs: [
      { name: 'wallet', type: 'address' },
      { name: 'reasonCode', type: 'bytes32' },
    ],
  },
];

// v4-core CustomRevert.WrappedError — how hook reverts surface from the PoolManager
export const WRAPPED_ERROR_ABI = [
  {
    type: 'error',
    name: 'WrappedError',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'selector', type: 'bytes4' },
      { name: 'reason', type: 'bytes' },
      { name: 'details', type: 'bytes' },
    ],
  },
];

function findHexData(err) {
  let cur = err;
  for (let depth = 0; cur && depth < 8; depth++) {
    for (const key of ['data', 'raw']) {
      const v = cur[key];
      if (typeof v === 'string' && v.startsWith('0x') && v.length >= 10) return v;
    }
    cur = cur.cause;
  }
  return null;
}

// Accepts raw revert data (hex) or a thrown viem error. Returns
// { wallet, reason } for a (possibly wrapped) NotCompliant revert, else null.
export function decodeNotCompliant(input) {
  const data = typeof input === 'string' ? input : findHexData(input);
  if (typeof data !== 'string' || !data.startsWith('0x')) return null;

  try {
    const wrapped = decodeErrorResult({ abi: WRAPPED_ERROR_ABI, data });
    return decodeNotCompliant(wrapped.args[2]);
  } catch {}

  try {
    const inner = decodeErrorResult({ abi: NOT_COMPLIANT_ABI, data });
    return {
      wallet: getAddress(inner.args[0]),
      reason: hexToString(inner.args[1]).replace(/\0+$/g, ''),
    };
  } catch {}

  return null;
}
