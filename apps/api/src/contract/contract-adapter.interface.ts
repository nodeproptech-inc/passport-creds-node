import type { PassportStatus } from '../common/types';

export interface SubmitClaimParams {
  walletAddress: string;
  claimTypeHash: `0x${string}`;
  approved: boolean;
  verificationIdHash: `0x${string}`;
  attestationHash: `0x${string}`;
  expiresAt: number;
}

export interface SubmitClaimResult {
  transactionHash: string;
}

export interface SyncPassportResult {
  transactionHash: string;
  tokenId: number;
  status: PassportStatus;
}

export interface AccessSummaryOnchain {
  canAccessDealRoom: boolean;
  canAccessInvestorArea: boolean;
  canInvest: boolean;
  passportStatus: PassportStatus;
}

export interface IContractAdapter {
  submitClaim(params: SubmitClaimParams): Promise<SubmitClaimResult>;
  syncPassport(walletAddress: string): Promise<SyncPassportResult>;
  getAccessSummary(walletAddress: string): Promise<AccessSummaryOnchain>;
}
