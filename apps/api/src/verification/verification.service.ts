import { Injectable, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CREService } from '../cre/cre.service';
import { AttesterService } from '../attester/attester.service';
import {
  normalizeAddress,
  buildAttestationHash,
  buildVerificationIdHash,
  dateToSeconds,
  resolveExpiresAt,
} from '../common/utils';
import { SUPPORTED_CLAIM_TYPES, CLAIM_TYPE_HASHES, TENANT_ID } from '../common/constants';
import type { IContractAdapter } from '../contract/contract-adapter.interface';
import { TransactionsService } from '../transactions/transactions.service';
import type { ClaimType, ClaimStatus } from '../common/types';

// Sample AI results used by the demo fallback endpoint.
const MOCK_AI_RESULTS: Record<string, { approved: boolean; confidence: number; reasonCode: string; summary: string }> = {
  KYC_AML_VERIFIED_approved: {
    approved: true,
    confidence: 0.95,
    reasonCode: 'KYC_AND_AML_CLEAR',
    summary: 'The applicant passed identity verification and AML screening.',
  },
  KYC_AML_VERIFIED_rejected: {
    approved: false,
    confidence: 0.93,
    reasonCode: 'AML_RISK_DETECTED',
    summary: 'The applicant did not pass KYC / AML requirements due to risk indicators.',
  },
  ACCREDITED_INVESTOR_approved: {
    approved: true,
    confidence: 0.94,
    reasonCode: 'ACCREDITATION_CONFIRMED',
    summary: 'The applicant meets the accredited investor criteria based on the provided evidence.',
  },
  ACCREDITED_INVESTOR_rejected: {
    approved: false,
    confidence: 0.90,
    reasonCode: 'ACCREDITATION_NOT_CONFIRMED',
    summary: 'The provided evidence does not confirm accredited investor status.',
  },
};

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
    private readonly cre: CREService,
    private readonly attester: AttesterService,
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

    await this.prisma.walletProfile.upsert({
      where: { walletAddress },
      create: { walletAddress, tenantId: TENANT_ID, passportStatus: 'IN_PROGRESS' },
      update: { passportStatus: 'IN_PROGRESS' },
    });

    const session = await this.prisma.verificationSession.create({
      data: {
        walletAddress,
        tenantId: TENANT_ID,
        claimType: claimType as any,
        status: 'PENDING',
        creStatus: 'NOT_STARTED',
      },
    });

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

    return { verificationId: session.id, walletAddress, claimType, status: 'PENDING' };
  }

  // Accepts a document from the frontend, submits it to the Chainlink Confidential AI Attester,
  // and stores the inferenceId. The result arrives asynchronously via /webhooks/ai-attester.
  async startWithDocument(
    rawAddress: string,
    claimType: string,
    documentBase64: string,
    documentName: string,
    documentContentType?: string,
  ): Promise<{ verificationId: string; inferenceId: string; claimType: string; status: string }> {
    if (!SUPPORTED_CLAIM_TYPES.has(claimType)) {
      throw new BadRequestException(`Unsupported claimType: ${claimType}`);
    }

    const walletAddress = normalizeAddress(rawAddress);

    await this.prisma.walletProfile.upsert({
      where: { walletAddress },
      create: { walletAddress, tenantId: TENANT_ID, passportStatus: 'IN_PROGRESS' },
      update: { passportStatus: 'IN_PROGRESS' },
    });

    const session = await this.prisma.verificationSession.create({
      data: {
        walletAddress,
        tenantId: TENANT_ID,
        claimType: claimType as any,
        status: 'PENDING',
        creStatus: 'NOT_STARTED',
      },
    });

    await this.prisma.complianceClaim.upsert({
      where: { walletAddress_claimType: { walletAddress, claimType: claimType as any } },
      create: {
        walletAddress,
        tenantId: TENANT_ID,
        claimType: claimType as any,
        status: 'PENDING',
        verificationId: session.id,
      },
      update: { status: 'PENDING', verificationId: session.id },
    });

    const inferenceId = await this.attester.submitInference({
      verificationId: session.id,
      walletAddress,
      claimType,
      documentBase64,
      documentName,
      documentContentType,
    });

    await this.prisma.verificationSession.update({
      where: { id: session.id },
      data: { inferenceId },
    });

    return { verificationId: session.id, inferenceId, claimType, status: 'queued' };
  }

  // Demo fallback: injects a saved sample AI result when AI Attester Playground is unavailable.
  // Mirrors the webhook pipeline so the same CRE / onchain flow is exercised.
  async injectMockAiResult(
    verificationId: string,
    approved: boolean,
  ): Promise<{ injected: boolean; verificationId: string; claimType: string; approved: boolean }> {
    const session = await this.prisma.verificationSession.findUnique({
      where: { id: verificationId },
    });
    if (!session) throw new NotFoundException(`Verification session not found: ${verificationId}`);

    const claimType = session.claimType as string;
    const key = `${claimType}_${approved ? 'approved' : 'rejected'}`;
    const mock = MOCK_AI_RESULTS[key] ?? {
      approved,
      confidence: 0.90,
      reasonCode: 'DEMO_RESULT',
      summary: 'Demo simulation result.',
    };

    const attestationHash = buildAttestationHash({
      verificationId,
      walletAddress: session.walletAddress,
      claimType,
      ...mock,
    });

    const expiresAt = resolveExpiresAt();

    await this.prisma.verificationSession.update({
      where: { id: verificationId },
      data: {
        status: 'PROCESSING',
        approved: mock.approved,
        confidence: mock.confidence,
        reasonCode: mock.reasonCode,
        summary: mock.summary,
        attestationHash,
        expiresAt,
        webhookReceivedAt: new Date(),
        creStatus: 'NOT_STARTED',
      },
    });

    await this.prisma.complianceClaim.upsert({
      where: {
        walletAddress_claimType: {
          walletAddress: session.walletAddress,
          claimType: session.claimType as any,
        },
      },
      create: {
        walletAddress: session.walletAddress,
        tenantId: TENANT_ID,
        claimType: session.claimType as any,
        status: 'PROCESSING',
        approved: mock.approved,
        confidence: mock.confidence,
        reasonCode: mock.reasonCode,
        summary: mock.summary,
        attestationHash,
        verificationId,
        expiresAt,
      },
      update: {
        status: 'PROCESSING',
        approved: mock.approved,
        confidence: mock.confidence,
        reasonCode: mock.reasonCode,
        summary: mock.summary,
        attestationHash,
        verificationId,
        expiresAt,
      },
    });

    // Trigger CRE the same way the real webhook does — verificationId only
    await this.cre.triggerWorkflow(verificationId);

    await this.prisma.verificationSession.update({
      where: { id: verificationId },
      data: { creStatus: 'TRIGGERED', creTriggeredAt: new Date() },
    });

    return { injected: true, verificationId, claimType, approved: mock.approved };
  }

  // Fallback triggered by frontend when CRE pipeline did not complete automatically.
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
    const attestationHash = (session.attestationHash ??
      buildAttestationHash({ verificationId, walletAddress, claimType: session.claimType, approved })) as `0x${string}`;
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
