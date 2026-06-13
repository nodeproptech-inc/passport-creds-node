import { keccak256, toBytes, toHex } from 'viem';
import type { ClaimType } from './types.js';

export function claimTypeToBytes32(claimType: ClaimType): `0x${string}` {
  return keccak256(toBytes(claimType));
}

export function hashVerificationId(verificationId: string): `0x${string}` {
  return keccak256(toBytes(verificationId));
}

export function hashAttestationString(attestationHash: string): `0x${string}` {
  if (attestationHash.startsWith('0x') && attestationHash.length === 66) {
    return attestationHash as `0x${string}`;
  }
  return toHex(attestationHash.padEnd(32, '\0').slice(0, 32)) as `0x${string}`;
}
