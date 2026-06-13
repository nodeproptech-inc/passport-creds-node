export type ClaimType = 'KYC_AML_VERIFIED' | 'ACCREDITED_INVESTOR';

export type ClaimStatus =
  | 'UNVERIFIED'
  | 'PENDING'
  | 'PROCESSING'
  | 'VERIFIED'
  | 'FAILED'
  | 'EXPIRED'
  | 'REVOKED';

export type PassportStatus =
  | 'NONE'
  | 'IN_PROGRESS'
  | 'LIMITED'
  | 'GREEN'
  | 'RED'
  | 'REVOKED'
  | 'EXPIRED';

export type VerificationStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type CREStatus =
  | 'NOT_STARTED'
  | 'TRIGGERED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED';

export type TransactionStatus = 'PENDING' | 'CONFIRMED' | 'FAILED' | 'SIMULATED';

export type ContractName = 'ClaimRegistry' | 'CompliancePassport' | 'AccessGate';

export type AIAttesterResult = {
  claimType: ClaimType;
  approved: boolean;
  confidence: number;
  reasonCode: string;
  summary: string;
  attestationId?: string;
  attestationHash?: string;
};

export type ComplianceClaimState = {
  walletAddress: string;
  claimType: ClaimType;
  status: ClaimStatus;
  approved: boolean;
  confidence?: number | null;
  reasonCode?: string | null;
  summary?: string | null;
  attestationHash?: string | null;
  verificationId?: string | null;
  transactionHash?: string | null;
  expiresAt?: Date | null;
  updatedAt: Date;
};

export type PassportBadge = {
  label: string;
  claimType: ClaimType;
  status: ClaimStatus;
};

export type TransactionRecord = {
  id: string;
  walletAddress: string;
  verificationId?: string | null;
  contractName: ContractName;
  action: string;
  transactionHash?: string | null;
  status: TransactionStatus;
  createdAt: Date;
};

export type PassportState = {
  walletAddress: string;
  status: PassportStatus;
  passportTokenId?: string | null;
  passportTxHash?: string | null;
  claims: ComplianceClaimState[];
  badges: PassportBadge[];
  transactions: TransactionRecord[];
  canAccessDealRoom: boolean;
  canAccessInvestorArea: boolean;
  canInvest: boolean;
};

export type AccessResult = {
  allowed: boolean;
  passportStatus: PassportStatus;
  canAccessDealRoom: boolean;
  canAccessInvestorArea: boolean;
  canInvest: boolean;
  reason: string;
};

export type AIAttesterWebhookPayload = {
  verificationId: string;
  walletAddress: string;
  claimType: string;
  approved: boolean;
  confidence: number;
  reasonCode: string;
  summary: string;
  attestationId?: string;
  attestationHash?: string;
  expiresAt?: string;
};

export type CREVerificationResult = {
  verificationId: string;
  walletAddress: string;
  claimType: ClaimType;
  approved: boolean;
  claimStatus: ClaimStatus;
  attestationHash: string;
  expiresAt: number | null;
};

export type CREWorkflowResult = {
  success: boolean;
  verificationId: string;
  walletAddress: string;
  claimType: ClaimType;
  approved: boolean;
  claimRegistryTxHash?: string;
  passportTxHash?: string;
  passportStatus?: PassportStatus;
  accessSummary?: {
    canAccessDealRoom: boolean;
    canAccessInvestorArea: boolean;
    canInvest: boolean;
  };
  error?: string;
};
