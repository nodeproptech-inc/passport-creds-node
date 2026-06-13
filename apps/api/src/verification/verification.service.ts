import { Injectable, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeAddress, buildAttestationHash, buildVerificationIdHash, dateToSeconds, calculatePassportStatus } from '../common/utils';
import { SUPPORTED_CLAIM_TYPES, CLAIM_TYPE_HASHES, TENANT_ID } from '../common/constants';
import type { IContractAdapter } from '../contract/contract-adapter.interface';
import { TransactionsService } from '../transactions/transactions.service';
import type { ClaimType, ClaimStatus, ComplianceClaimState } from '../common/types';

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
    @Inject('CONTRACT_ADAPTER') private readonly contracts: IContractAdapter,
  ) {}

  async startVerification(
    rawAddress: string,
    claimType: string,
  ): Promise<{ verificationId: string; walletAddress: string; claimType: string; status: string }> {
    if (!SUPPORTED_CLAIM_TYPES.has(claimType)) {
      throw new BadRequestException(`Unsupported claimType: ${claimType}`);
    }

    const walletAddress = normalizeAddress(rawAddress);

    // Ensure wallet profile exists
    await this.prisma.walletProfile.upsert({
      where: { walletAddress },
      create: { walletAddress, tenantId: TENANT_ID, passportStatus: 'IN_PROGRESS' },
      update: { passportStatus: 'IN_PROGRESS' },
    });

    // Create a new verification session
    const session = await this.prisma.verificationSession.create({
      data: {
        walletAddress,
        tenantId: TENANT_ID,
        claimType: claimType as any,
        status: 'PENDING',
        creStatus: 'NOT_STARTED',
      },
    });

    // Mark or create the ComplianceClaim as PENDING
    await this.prisma.complianceClaim.upsert({
      where: { walletAddress_claimType: { walletAddress, claimType: claimType as any } },
      create: {
        walletAddress,
        tenantId: TENANT_ID,
        claimType: claimType as any,
        status: 'PENDING',
        verificationId: session.id,
      },
      update: {
        status: 'PENDING',
        verificationId: session.id,
      },
    });

    return {
      verificationId: session.id,
      walletAddress,
      claimType,
      status: 'PENDING',
    };
  }

  // Fallback triggered by frontend when the CRE pipeline did not complete automatically.
  // Reads the stored verification result and writes it onchain directly.
  async syncOnchain(verificationId: string): Promise<{
    success: boolean;
    verificationId: string;
    transactionHash: string;
    simulated: boolean;
  }> {
    const session = await this.prisma.verificationSession.findUnique({
      where: { id: verificationId },
    });

    if (!session) throw new NotFoundException(`Verification not found: ${verificationId}`);

    if (session.status === 'PENDING') {
      throw new BadRequestException('AI Attester result not yet received for this verification');
    }

    const walletAddress = session.walletAddress;
    const approved = session.approved ?? false;
    const claimTypeHash = CLAIM_TYPE_HASHES[session.claimType as ClaimType];
    const attestationHash = buildAttestationHash({
      verificationId,
      walletAddress,
      claimType: session.claimType,
      approved,
    }) as `0x${string}`;
    const verificationIdHash = buildVerificationIdHash(verificationId);
    const expiresAt = session.expiresAt ? dateToSeconds(session.expiresAt) : 0;

    const claimResult = await this.contracts.submitClaim({
      walletAddress,
      claimTypeHash,
      approved,
      verificationIdHash,
      attestationHash,
      expiresAt,
    });

    await this.transactions.save({
      walletAddress,
      verificationId,
      claimType: session.claimType,
      contractName: 'ClaimRegistry',
      action: `${session.claimType} = ${approved ? 'VERIFIED' : 'FAILED'}`,
      transactionHash: claimResult.transactionHash,
      status: 'CONFIRMED',
    });

    const claimStatus: ClaimStatus = approved ? 'VERIFIED' : 'FAILED';
    const now = new Date();

    await this.prisma.complianceClaim.upsert({
      where: { walletAddress_claimType: { walletAddress, claimType: session.claimType as any } },
      create: {
        walletAddress,
        tenantId: TENANT_ID,
        claimType: session.claimType as any,
        status: claimStatus as any,
        approved,
        verificationId,
        transactionHash: claimResult.transactionHash,
        attestationHash,
        verifiedAt: approved ? now : null,
        failedAt: approved ? null : now,
      },
      update: {
        status: claimStatus as any,
        approved,
        transactionHash: claimResult.transactionHash,
        attestationHash,
        verifiedAt: approved ? now : null,
        failedAt: approved ? null : now,
      },
    });

    const passportResult = await this.contracts.syncPassport(walletAddress);

    await this.transactions.save({
      walletAddress,
      verificationId,
      contractName: 'CompliancePassport',
      action: `Passport status updated to ${passportResult.status}`,
      transactionHash: passportResult.transactionHash,
      status: 'CONFIRMED',
    });

    await this.prisma.walletProfile.update({
      where: { walletAddress },
      data: {
        passportStatus: passportResult.status as any,
        passportTokenId: String(passportResult.tokenId),
        passportTxHash: passportResult.transactionHash,
      },
    });

    await this.prisma.verificationSession.update({
      where: { id: verificationId },
      data: {
        status: 'COMPLETED',
        creStatus: 'COMPLETED',
        transactionHash: claimResult.transactionHash,
        completedAt: now,
      },
    });

    return {
      success: true,
      verificationId,
      transactionHash: claimResult.transactionHash,
      simulated: process.env.DEMO_MODE === 'true',
    };
  }
}
