import type { CREVerificationResult } from './types.js';

const SUPPORTED_CLAIM_TYPES = new Set(['KYC_AML_VERIFIED', 'ACCREDITED_INVESTOR']);

export function validateVerificationResult(result: CREVerificationResult): void {
  if (!result.verificationId) {
    throw new Error('Validation failed: verificationId is missing');
  }

  if (!result.walletAddress || !/^0x[0-9a-fA-F]{40}$/.test(result.walletAddress)) {
    throw new Error(`Validation failed: invalid walletAddress "${result.walletAddress}"`);
  }

  if (!SUPPORTED_CLAIM_TYPES.has(result.claimType)) {
    throw new Error(`Validation failed: unsupported claimType "${result.claimType}"`);
  }

  if (typeof result.approved !== 'boolean') {
    throw new Error('Validation failed: approved must be a boolean');
  }

  if (!result.attestationHash) {
    throw new Error('Validation failed: attestationHash is missing');
  }

  if (!result.expiresAt || typeof result.expiresAt !== 'number') {
    throw new Error('Validation failed: expiresAt is missing or not a number');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (result.expiresAt <= nowSeconds) {
    throw new Error(
      `Validation failed: expiresAt ${result.expiresAt} is in the past (now: ${nowSeconds})`
    );
  }

  const expectedStatus = result.approved ? 'VERIFIED' : 'FAILED';
  if (result.claimStatus !== expectedStatus) {
    throw new Error(
      `Validation failed: claimStatus "${result.claimStatus}" does not match approved=${result.approved} (expected "${expectedStatus}")`
    );
  }
}
