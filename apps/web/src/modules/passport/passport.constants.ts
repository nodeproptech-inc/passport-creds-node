export const PRODUCT_NAME = 'PassportCreds by Node';
export const PRODUCT_SHORT = 'PassportCreds';
export const TENANT_ID = 'node-proptech';
export const TENANT_NAME = 'Node PropTech';
export const RESOURCE_ID = 'node-oklahoma-deal-room';
export const RESOURCE_NAME = 'Oklahoma Real Estate Deal Room';

export const CLAIM_LABELS = {
  KYC_AML_VERIFIED: 'KYC / AML Verified',
  ACCREDITED_INVESTOR: 'Accredited Investor',
} as const;

export const PASSPORT_STATUS_LABELS = {
  NONE: 'No Passport',
  IN_PROGRESS: 'In Progress',
  LIMITED: 'Limited',
  GREEN: 'Full Access',
  RED: 'Blocked',
  REVOKED: 'Revoked',
  EXPIRED: 'Expired',
} as const;

export const CLAIM_STATUS_LABELS = {
  UNVERIFIED: 'Unverified',
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  VERIFIED: 'Verified',
  FAILED: 'Failed',
  EXPIRED: 'Expired',
  REVOKED: 'Revoked',
} as const;
