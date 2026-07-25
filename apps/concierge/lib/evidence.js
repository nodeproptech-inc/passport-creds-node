import { keccak256, toHex } from 'viem';

// JSON-safe stand-in for values JSON.stringify can't natively serialize
// (ticket amounts arrive as bigint wei).
function toJsonSafe(_key, value) {
  return typeof value === 'bigint' ? value.toString() : value;
}

// Deterministic JSON string for a decision (or decision+ticket) object: keys
// sorted alphabetically so the same content hashes identically regardless of
// how the object was built. Used as the pre-image for evidenceHash.
export function canonicalEvidence(decision) {
  const sorted = {};
  for (const key of Object.keys(decision).sort()) {
    sorted[key] = decision[key];
  }
  return JSON.stringify(sorted, toJsonSafe);
}

// keccak256 of the canonical evidence string — the on-chain-anchorable
// fingerprint of a concierge decision.
export function evidenceHash(decision) {
  return keccak256(toHex(canonicalEvidence(decision)));
}
