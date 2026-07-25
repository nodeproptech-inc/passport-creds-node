import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, toHex } from 'viem';
import { canonicalEvidence, evidenceHash } from '../lib/evidence.js';

const decision = {
  ticketId: 1,
  vendor: 'plumber',
  amount: 120n * 10n ** 18n,
  category: 'plumbing',
  action: 'pay',
  rationale: '120.0 mUSD within per-tx cap 200.0 and budget 500.0',
  confidence: 0.9,
};

test('canonicalEvidence sorts keys alphabetically regardless of insertion order', () => {
  const reordered = {
    vendor: decision.vendor,
    action: decision.action,
    ticketId: decision.ticketId,
    confidence: decision.confidence,
    amount: decision.amount,
    rationale: decision.rationale,
    category: decision.category,
  };
  assert.equal(canonicalEvidence(decision), canonicalEvidence(reordered));
});

test('canonicalEvidence emits keys in the exact alphabetical order', () => {
  const keys = Object.keys(JSON.parse(canonicalEvidence(decision)));
  assert.deepEqual(keys, ['action', 'amount', 'category', 'confidence', 'rationale', 'ticketId', 'vendor']);
});

test('evidenceHash is stable for the same object regardless of key insertion order', () => {
  const a = { action: 'pay', amount: 1n, category: 'plumbing', confidence: 1, rationale: 'r', ticketId: 1, vendor: 'v' };
  const b = { vendor: 'v', ticketId: 1, rationale: 'r', confidence: 1, category: 'plumbing', amount: 1n, action: 'pay' };
  assert.equal(evidenceHash(a), evidenceHash(b));
});

test('evidenceHash changes when any single field changes', () => {
  const base = evidenceHash(decision);
  const variants = {
    action: 'reject',
    vendor: 'other-vendor',
    amount: 121n * 10n ** 18n,
    category: 'cleaning',
    rationale: 'a different rationale entirely',
    confidence: 0.1,
    ticketId: 2,
  };
  for (const [key, changedValue] of Object.entries(variants)) {
    const mutated = { ...decision, [key]: changedValue };
    assert.notEqual(evidenceHash(mutated), base, `changing '${key}' should change the hash`);
  }
});

test('evidenceHash matches keccak256(toHex(canonicalEvidence(d))) from viem', () => {
  assert.equal(evidenceHash(decision), keccak256(toHex(canonicalEvidence(decision))));
});
