import { keccak256, toBytes } from 'viem';

export const TENANT_ID = process.env.TENANT_ID ?? 'node-proptech';

export const PRODUCT_NAME = 'PassportCreds by Node';

// Supported claim types as bytes32 keccak256 hashes — must match ClaimRegistry.sol
export const CLAIM_TYPE_HASHES = {
  KYC_AML_VERIFIED: keccak256(toBytes('KYC_AML_VERIFIED')),
  ACCREDITED_INVESTOR: keccak256(toBytes('ACCREDITED_INVESTOR')),
} as const;

export const SUPPORTED_CLAIM_TYPES = new Set(['KYC_AML_VERIFIED', 'ACCREDITED_INVESTOR']);

export const CLAIM_LABELS: Record<string, string> = {
  KYC_AML_VERIFIED: 'KYC / AML Verified',
  ACCREDITED_INVESTOR: 'Accredited Investor',
};

// Number of days before a claim expires (if not set by the AI Attester)
export const DEFAULT_CLAIM_EXPIRY_DAYS = 365;
