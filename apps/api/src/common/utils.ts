import crypto from 'crypto';
import { keccak256, toBytes, isAddress, getAddress } from 'viem';
import { BadRequestException } from '@nestjs/common';
import { DEFAULT_CLAIM_EXPIRY_DAYS } from './constants';
import type { ClaimStatus, PassportStatus, ComplianceClaimState } from './types';

export function buildAttestationHash(input: object): string {
  return `0x${crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex')}`;
}

export function buildVerificationIdHash(verificationId: string): `0x${string}` {
  return keccak256(toBytes(verificationId));
}

export function normalizeAddress(raw: string): string {
  if (!isAddress(raw)) {
    throw new BadRequestException(`Invalid Ethereum address: ${raw}`);
  }
  return getAddress(raw);
}

export function resolveExpiresAt(expiresAtIso?: string): Date {
  if (expiresAtIso) {
    const d = new Date(expiresAtIso);
    if (!isNaN(d.getTime())) return d;
  }
  const d = new Date();
  d.setDate(d.getDate() + DEFAULT_CLAIM_EXPIRY_DAYS);
  return d;
}

export function dateToSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

// Calculates the passport status from the current set of compliance claims.
// Matches the rules defined in docs/03a-database-schema.md section 11.
export function calculatePassportStatus(claims: ComplianceClaimState[]): PassportStatus {
  const kycAml = claims.find((c) => c.claimType === 'KYC_AML_VERIFIED');
  const accredited = claims.find((c) => c.claimType === 'ACCREDITED_INVESTOR');

  if (!kycAml && !accredited) return 'NONE';

  const isPending = (s: ClaimStatus | undefined) => s === 'PENDING' || s === 'PROCESSING';

  if (isPending(kycAml?.status) || isPending(accredited?.status)) return 'IN_PROGRESS';

  if (kycAml?.status === 'FAILED' || kycAml?.status === 'REVOKED') return 'RED';

  if (kycAml?.status === 'VERIFIED' && accredited?.status === 'VERIFIED') return 'GREEN';

  if (kycAml?.status === 'VERIFIED') return 'LIMITED';

  return 'NONE';
}

// Derives access permissions from passport status.
// Matches the rules defined in docs/03a-database-schema.md section 12.
export function calculateAccess(status: PassportStatus) {
  return {
    canAccessDealRoom: status === 'LIMITED' || status === 'GREEN',
    canAccessInvestorArea: status === 'GREEN',
    canInvest: status === 'GREEN',
  };
}
