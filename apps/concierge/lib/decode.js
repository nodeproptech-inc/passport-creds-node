import { decodeErrorResult, getAddress, hexToString } from 'viem';

// MandateHook.NotAuthorized(address wallet, bytes32 reasonCode) — agent-side
// mandate refusal (over per-tx cap, no mandate, owner not compliant, ...).
export const NOT_AUTHORIZED_ABI = [
  {
    type: 'error',
    name: 'NotAuthorized',
    inputs: [
      { name: 'wallet', type: 'address' },
      { name: 'reasonCode', type: 'bytes32' },
    ],
  },
];

// ComplianceHook.NotCompliant(address wallet, bytes32 reasonCode) — owner-side
// compliance refusal (KYC missing/expired, passport revoked, ...).
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

function decodeWithAbi(data, abi) {
  try {
    const decoded = decodeErrorResult({ abi, data });
    return {
      wallet: getAddress(decoded.args[0]),
      reason: hexToString(decoded.args[1]).replace(/\0+$/g, ''),
    };
  } catch {
    return null;
  }
}

// Accepts raw revert data (hex) or a thrown viem error. Returns
// { wallet, reason } for a (possibly wrapped) NotAuthorized or NotCompliant
// revert, else null.
export function decodeRefusal(input) {
  const data = typeof input === 'string' ? input : findHexData(input);
  if (typeof data !== 'string' || !data.startsWith('0x')) return null;

  try {
    const wrapped = decodeErrorResult({ abi: WRAPPED_ERROR_ABI, data });
    return decodeRefusal(wrapped.args[2]);
  } catch {}

  return decodeWithAbi(data, NOT_AUTHORIZED_ABI) ?? decodeWithAbi(data, NOT_COMPLIANT_ABI);
}
