import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CLAIM_LABELS, TENANT_ID } from '../common/constants';
import { calculatePassportStatus, calculateAccess, normalizeAddress } from '../common/utils';
import type {
  PassportState,
  ComplianceClaimState,
  PassportBadge,
  TransactionRecord,
  ClaimType,
  ClaimStatus,
  ContractName,
  TransactionStatus,
} from '../common/types';

@Injectable()
export class PassportService {
  constructor(private readonly prisma: PrismaService) {}

  async getPassportState(rawAddress: string): Promise<PassportState> {
    const walletAddress = normalizeAddress(rawAddress);

    const profile = await this.prisma.walletProfile.findUnique({
      where: { walletAddress },
      include: {
        claims: { orderBy: { updatedAt: 'desc' } },
        transactions: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!profile) {
      return this._emptyState(walletAddress);
    }

    const claims: ComplianceClaimState[] = profile.claims.map((c) => ({
      walletAddress: c.walletAddress,
      claimType: c.claimType as ClaimType,
      status: c.status as ClaimStatus,
      approved: c.approved,
      confidence: c.confidence,
      reasonCode: c.reasonCode,
      summary: c.summary,
      attestationHash: c.attestationHash,
      verificationId: c.verificationId,
      transactionHash: c.transactionHash,
      expiresAt: c.expiresAt,
      updatedAt: c.updatedAt,
    }));

    const transactions: TransactionRecord[] = profile.transactions.map((t) => ({
      id: t.id,
      walletAddress: t.walletAddress,
      verificationId: t.verificationId,
      contractName: t.contractName as ContractName,
      action: t.action,
      transactionHash: t.transactionHash,
      status: t.status as TransactionStatus,
      createdAt: t.createdAt,
    }));

    const passportStatus = calculatePassportStatus(claims);
    const access = calculateAccess(passportStatus);

    const badges: PassportBadge[] = (['KYC_AML_VERIFIED', 'ACCREDITED_INVESTOR'] as ClaimType[]).map(
      (claimType) => {
        const claim = claims.find((c) => c.claimType === claimType);
        return {
          label: CLAIM_LABELS[claimType],
          claimType,
          status: claim?.status ?? 'UNVERIFIED',
        };
      },
    );

    return {
      walletAddress: profile.walletAddress,
      status: passportStatus,
      passportTokenId: profile.passportTokenId,
      passportTxHash: profile.passportTxHash,
      claims,
      badges,
      transactions,
      ...access,
    };
  }

  async upsertProfile(walletAddress: string): Promise<void> {
    await this.prisma.walletProfile.upsert({
      where: { walletAddress },
      create: { walletAddress, tenantId: TENANT_ID },
      update: {},
    });
  }

  async updatePassportStatus(walletAddress: string): Promise<void> {
    const claims = await this.prisma.complianceClaim.findMany({ where: { walletAddress } });

    const claimStates: ComplianceClaimState[] = claims.map((c) => ({
      walletAddress: c.walletAddress,
      claimType: c.claimType as ClaimType,
      status: c.status as ClaimStatus,
      approved: c.approved,
      confidence: c.confidence,
      reasonCode: c.reasonCode,
      summary: c.summary,
      attestationHash: c.attestationHash,
      verificationId: c.verificationId,
      transactionHash: c.transactionHash,
      expiresAt: c.expiresAt,
      updatedAt: c.updatedAt,
    }));

    const passportStatus = calculatePassportStatus(claimStates);

    await this.prisma.walletProfile.update({
      where: { walletAddress },
      data: { passportStatus: passportStatus as any },
    });
  }

  private _emptyState(walletAddress: string): PassportState {
    const badges: PassportBadge[] = (['KYC_AML_VERIFIED', 'ACCREDITED_INVESTOR'] as ClaimType[]).map(
      (claimType) => ({
        label: CLAIM_LABELS[claimType],
        claimType,
        status: 'UNVERIFIED' as ClaimStatus,
      }),
    );

    return {
      walletAddress,
      status: 'NONE',
      passportTokenId: null,
      passportTxHash: null,
      claims: [],
      badges,
      transactions: [],
      canAccessDealRoom: false,
      canAccessInvestorArea: false,
      canInvest: false,
    };
  }
}
