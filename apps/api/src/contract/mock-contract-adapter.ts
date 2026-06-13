import { Injectable, Logger } from '@nestjs/common';
import type { PassportStatus } from '../common/types';
import type {
  IContractAdapter,
  SubmitClaimParams,
  SubmitClaimResult,
  SyncPassportResult,
  AccessSummaryOnchain,
} from './contract-adapter.interface';

// Simulates onchain writes without a real RPC connection.
// Used when DEMO_MODE=true so the demo runs without a funded wallet or live node.
@Injectable()
export class MockContractAdapter implements IContractAdapter {
  private readonly logger = new Logger(MockContractAdapter.name);

  private readonly claims = new Map<string, { approved: boolean; claimTypeHash: string }[]>();
  private readonly passports = new Map<string, { tokenId: number; status: PassportStatus }>();
  private tokenIdCounter = 1;

  async submitClaim(params: SubmitClaimParams): Promise<SubmitClaimResult> {
    this.logger.log(`[MOCK] submitClaim wallet=${params.walletAddress} approved=${params.approved}`);

    const existing = this.claims.get(params.walletAddress) ?? [];
    existing.push({ approved: params.approved, claimTypeHash: params.claimTypeHash });
    this.claims.set(params.walletAddress, existing);

    const transactionHash = `0xMOCK_CLAIM_${Date.now().toString(16)}`;
    return { transactionHash };
  }

  async syncPassport(walletAddress: string): Promise<SyncPassportResult> {
    this.logger.log(`[MOCK] syncPassport wallet=${walletAddress}`);

    const existing = this.passports.get(walletAddress);
    const tokenId = existing?.tokenId ?? this.tokenIdCounter++;
    const status = this._computeMockStatus(walletAddress);

    this.passports.set(walletAddress, { tokenId, status });

    const transactionHash = `0xMOCK_PASSPORT_${Date.now().toString(16)}`;
    return { transactionHash, tokenId, status };
  }

  async getAccessSummary(walletAddress: string): Promise<AccessSummaryOnchain> {
    const passport = this.passports.get(walletAddress);
    const status: PassportStatus = passport?.status ?? 'NONE';

    return {
      canAccessDealRoom: status === 'LIMITED' || status === 'GREEN',
      canAccessInvestorArea: status === 'GREEN',
      canInvest: status === 'GREEN',
      passportStatus: status,
    };
  }

  private _computeMockStatus(walletAddress: string): PassportStatus {
    const claims = this.claims.get(walletAddress) ?? [];
    if (claims.length === 0) return 'NONE';

    const kyc = claims.find((c) => c.claimTypeHash.includes('KYC'));
    const acc = claims.find((c) => c.claimTypeHash.includes('ACC'));

    if (!kyc) return 'NONE';
    if (!kyc.approved) return 'RED';
    if (acc?.approved) return 'GREEN';
    return 'LIMITED';
  }
}
