import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeErrorResult, stringToHex } from 'viem';
import { decodeRefusal, WRAPPED_ERROR_ABI, NOT_AUTHORIZED_ABI, NOT_COMPLIANT_ABI } from '../lib/decode.js';

const HOOK = '0x92dC477C694802993d99cd89AAFc3E44C7Df0880'; // MandateHook
const WALLET = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'; // concierge agent
const BEFORE_SWAP_SELECTOR = '0x575e24b4';

function wrappedNotAuthorized(reason) {
  const inner = encodeErrorResult({
    abi: NOT_AUTHORIZED_ABI,
    errorName: 'NotAuthorized',
    args: [WALLET, stringToHex(reason, { size: 32 })],
  });
  return encodeErrorResult({
    abi: WRAPPED_ERROR_ABI,
    errorName: 'WrappedError',
    args: [HOOK, BEFORE_SWAP_SELECTOR, inner, '0xa9e35b2f'],
  });
}

test('decodes a v4-wrapped NotAuthorized revert into wallet + reason', () => {
  assert.deepEqual(decodeRefusal(wrappedNotAuthorized('OVER_PER_TX_CAP')), {
    wallet: WALLET,
    reason: 'OVER_PER_TX_CAP',
  });
});

test('decodes a bare NotCompliant revert', () => {
  const inner = encodeErrorResult({
    abi: NOT_COMPLIANT_ABI,
    errorName: 'NotCompliant',
    args: [WALLET, stringToHex('PASSPORT_REVOKED', { size: 32 })],
  });
  assert.deepEqual(decodeRefusal(inner), { wallet: WALLET, reason: 'PASSPORT_REVOKED' });
});

test('decodes a bare NotAuthorized revert', () => {
  const inner = encodeErrorResult({
    abi: NOT_AUTHORIZED_ABI,
    errorName: 'NotAuthorized',
    args: [WALLET, stringToHex('NOT_OWNER', { size: 32 })],
  });
  assert.deepEqual(decodeRefusal(inner), { wallet: WALLET, reason: 'NOT_OWNER' });
});

test('decodes a v4-wrapped NotCompliant revert into wallet + reason', () => {
  const inner = encodeErrorResult({
    abi: NOT_COMPLIANT_ABI,
    errorName: 'NotCompliant',
    args: [WALLET, stringToHex('KYC_MISSING', { size: 32 })],
  });
  const wrapped = encodeErrorResult({
    abi: WRAPPED_ERROR_ABI,
    errorName: 'WrappedError',
    args: [HOOK, BEFORE_SWAP_SELECTOR, inner, '0xa9e35b2f'],
  });
  assert.deepEqual(decodeRefusal(wrapped), { wallet: WALLET, reason: 'KYC_MISSING' });
});

test('returns null for unrelated revert data or missing input', () => {
  assert.equal(decodeRefusal('0x08c379a0'), null);
  assert.equal(decodeRefusal(undefined), null);
});

test('finds revert data nested in viem error objects (data or raw)', () => {
  const viaData = new Error('reverted');
  viaData.cause = { cause: { data: wrappedNotAuthorized('MANDATE_REVOKED') } };
  assert.deepEqual(decodeRefusal(viaData), { wallet: WALLET, reason: 'MANDATE_REVOKED' });

  const viaRaw = new Error('reverted');
  viaRaw.cause = { raw: wrappedNotAuthorized('OWNER_NOT_COMPLIANT') };
  assert.deepEqual(decodeRefusal(viaRaw), { wallet: WALLET, reason: 'OWNER_NOT_COMPLIANT' });
});
