import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeErrorResult, stringToHex } from 'viem';
import { decodeNotCompliant, WRAPPED_ERROR_ABI, NOT_COMPLIANT_ABI } from '../lib/decode.js';

const HOOK = '0x512294cf8AD0b2664489615c00fe6Cf5302DC880';
const WALLET = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const BEFORE_SWAP_SELECTOR = '0x575e24b4';

function wrapped(reason) {
  const inner = encodeErrorResult({
    abi: NOT_COMPLIANT_ABI,
    errorName: 'NotCompliant',
    args: [WALLET, stringToHex(reason, { size: 32 })],
  });
  return encodeErrorResult({
    abi: WRAPPED_ERROR_ABI,
    errorName: 'WrappedError',
    args: [HOOK, BEFORE_SWAP_SELECTOR, inner, '0xa9e35b2f'],
  });
}

test('decodes a v4-wrapped NotCompliant revert into wallet + reason', () => {
  assert.deepEqual(decodeNotCompliant(wrapped('MISSING_KYC')), {
    wallet: WALLET,
    reason: 'MISSING_KYC',
  });
});

test('decodes a bare NotCompliant revert', () => {
  const inner = encodeErrorResult({
    abi: NOT_COMPLIANT_ABI,
    errorName: 'NotCompliant',
    args: [WALLET, stringToHex('NO_IDENTITY', { size: 32 })],
  });
  assert.deepEqual(decodeNotCompliant(inner), { wallet: WALLET, reason: 'NO_IDENTITY' });
});

test('returns null for unrelated revert data or missing input', () => {
  assert.equal(decodeNotCompliant('0x08c379a0'), null);
  assert.equal(decodeNotCompliant(undefined), null);
});

test('finds revert data nested in viem error objects (data or raw)', () => {
  const viaData = new Error('reverted');
  viaData.cause = { cause: { data: wrapped('MISSING_ACCREDITED') } };
  assert.deepEqual(decodeNotCompliant(viaData), { wallet: WALLET, reason: 'MISSING_ACCREDITED' });

  const viaRaw = new Error('reverted');
  viaRaw.cause = { raw: wrapped('NO_POLICY') };
  assert.deepEqual(decodeNotCompliant(viaRaw), { wallet: WALLET, reason: 'NO_POLICY' });
});
