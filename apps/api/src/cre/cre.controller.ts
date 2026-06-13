import { Controller, Get, Post, Param, Body, HttpCode, HttpStatus, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';
import { normalizeAddress, calculatePassportStatus } from '../common/utils';
import type { CREWorkflowResult, ClaimType, ClaimStatus, ComplianceClaimState } from '../common/types';

// Endpoints consumed only by the CRE node — not exposed to the public frontend.
@Controller('cre')
export class CREController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
  ) {}

  // CRE calls this to get sanitized verification result before writing onchain.
  // Returns only claim decision data — no raw documents, no PII.
  @Get('verification-result/:verificationId')
  async getVerificationResult(@Param('verificationId') verificationId: string) {
    const session = await this.prisma.verificationSession.findUnique({
      where: { id: verificationId },
    });

    if (!session) throw new NotFoundException(`Verification not found: ${verificationId}`);

    const claimStatus: ClaimStatus = session.approved ? 'VERIFIED' : 'FAILED';

    return {
      verificationId: session.id,
      walletAddress: session.walletAddress,
      claimType: session.claimType,
      approved: session.approved ?? false,
      claimStatus,
      attestationHash: session.attestationHash ?? null,
      expiresAt: session.expiresAt ? Math.floor(session.expiresAt.getTime() / 1000) : null,
    };
  }

  // CRE calls this after it writes the claim and syncs the passport onchain.
  @Post('workflow-result')
  @HttpCode(HttpStatus.OK)
  async receiveWorkflowResult(@Body() body: CREWorkflowResult) {
    const walletAddress = normalizeAddress(body.walletAddress);
    const { verificationId, claimType, approved, claimRegistryTxHash, passportTxHash } = body;
    const now = new Date();

    const claimStatus: ClaimStatus = approved ? 'VERIFIED' : 'FAILED';
    const txStatus = claimRegistryTxHash?.startsWith('0x') ? 'SIMULATED' : 'CONFIRMED';

    // Update the ComplianceClaim to its final status
    await this.prisma.complianceClaim.updateMany({
      where: { walletAddress, claimType: claimType as any },
      data: {
        status: claimStatus as any,
        transactionHash: claimRegistryTxHash ?? null,
        approved,
        verifiedAt: claimStatus === 'VERIFIED' ? now : null,
        failedAt: claimStatus === 'FAILED' ? now : null,
      },
    });

    // Save ClaimRegistry transaction record
    await this.transactions.save({
      walletAddress,
      verificationId,
      claimType,
      contractName: 'ClaimRegistry',
      action: `${claimType} = ${claimStatus}`,
      transactionHash: claimRegistryTxHash,
      status: txStatus,
    });

    // Save CompliancePassport transaction record if available
    if (passportTxHash) {
      await this.transactions.save({
        walletAddress,
        verificationId,
        claimType,
        contractName: 'CompliancePassport',
        action: 'syncPassport',
        transactionHash: passportTxHash,
        status: txStatus,
      });
    }

    // Recalculate passport status from all current claims (source of truth is DB)
    const allClaims = await this.prisma.complianceClaim.findMany({ where: { walletAddress } });
    const claimStates: ComplianceClaimState[] = allClaims.map((c) => ({
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

    const recalculated = calculatePassportStatus(claimStates);

    await this.prisma.walletProfile.update({
      where: { walletAddress },
      data: {
        passportStatus: recalculated as any,
        passportTxHash: passportTxHash ?? claimRegistryTxHash ?? null,
      },
    });

    // Update the verification session to COMPLETED
    await this.prisma.verificationSession.update({
      where: { id: verificationId },
      data: {
        status: 'COMPLETED',
        creStatus: 'COMPLETED',
        transactionHash: claimRegistryTxHash ?? null,
        creCompletedAt: now,
        completedAt: now,
      },
    });

    return { received: true, verificationId, passportStatus: recalculated };
  }
}
