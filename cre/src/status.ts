import type { PassportStatus } from './types.js';

// Matches the PassportStatus enum order in CompliancePassport.sol:
// NONE=0, IN_PROGRESS=1, LIMITED=2, GREEN=3, RED=4, REVOKED=5, EXPIRED=6
const PASSPORT_STATUS_MAP: PassportStatus[] = [
  'NONE',
  'IN_PROGRESS',
  'LIMITED',
  'GREEN',
  'RED',
  'REVOKED',
  'EXPIRED',
];

export function onchainStatusToString(statusIndex: number): PassportStatus {
  return PASSPORT_STATUS_MAP[statusIndex] ?? 'NONE';
}
