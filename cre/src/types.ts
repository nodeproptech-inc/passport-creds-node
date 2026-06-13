export type ClaimType = 'KYC_AML_VERIFIED' | 'ACCREDITED_INVESTOR';

export type PassportStatus =
  | 'NONE'
  | 'IN_PROGRESS'
  | 'LIMITED'
  | 'GREEN'
  | 'RED'
  | 'REVOKED'
  | 'EXPIRED';

export type CREVerificationResult = {
  verificationId: string;
  walletAddress: string;
  claimType: ClaimType;
  approved: boolean;
  claimStatus: 'VERIFIED' | 'FAILED';
  attestationHash: string;
  expiresAt: number;
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

export type AccessSummary = {
  canAccessDealRoom: boolean;
  canAccessInvestorArea: boolean;
  canInvest: boolean;
  passportStatus: PassportStatus;
};
