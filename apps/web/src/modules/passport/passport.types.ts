export type PassportStatus =
  | 'NONE'
  | 'IN_PROGRESS'
  | 'LIMITED'
  | 'GREEN'
  | 'RED'
  | 'REVOKED'
  | 'EXPIRED';

export type ClaimType = 'KYC_AML_VERIFIED' | 'ACCREDITED_INVESTOR';

export type ClaimStatus =
  | 'UNVERIFIED'
  | 'PENDING'
  | 'PROCESSING'
  | 'VERIFIED'
  | 'FAILED'
  | 'EXPIRED'
  | 'REVOKED';

export type ComplianceClaim = {
  claimType: ClaimType;
  status: ClaimStatus;
  approved: boolean;
  confidence?: number;
  reasonCode?: string;
  summary?: string;
  attestationHash?: string;
  verificationId?: string;
  transactionHash?: string;
  expiresAt?: string;
  updatedAt?: string;
};

export type PassportBadge = {
  label: string;
  claimType: ClaimType;
  status: ClaimStatus;
};

export type TransactionItem = {
  id: string;
  contractName: 'ClaimRegistry' | 'CompliancePassport' | 'AccessGate';
  action: string;
  transactionHash?: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'SIMULATED';
  createdAt: string;
};

export type PassportState = {
  walletAddress: string;
  status: PassportStatus;
  passportTokenId?: string | null;
  passportTxHash?: string | null;
  claims: ComplianceClaim[];
  badges: PassportBadge[];
  transactions: TransactionItem[];
  canAccessDealRoom: boolean;
  canAccessInvestorArea: boolean;
  canInvest: boolean;
};

export type StartVerificationResult = {
  verificationId: string;
  claimType: ClaimType;
  status: 'PENDING';
};
