import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeAddress, calculatePassportStatus, calculateAccess } from '../common/utils';
import type { AccessResult, ClaimType, ClaimStatus, ComplianceClaimState } from '../common/types';

@Controller('access')
export class AccessController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('check')
  async checkAccess(
    @Query('walletAddress') walletAddress: string,
    @Query('resourceId') resourceId?: string,
  ): Promise<AccessResult> {
    const address = normalizeAddress(walletAddress);

    const claims = await this.prisma.complianceClaim.findMany({
      where: { walletAddress: address },
    });

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
    const access = calculateAccess(passportStatus);

    const allowed = resourceId === 'node-oklahoma-deal-room'
      ? access.canAccessDealRoom
      : access.canAccessDealRoom;

    let reason: string;
    if (passportStatus === 'GREEN') {
      reason = 'All required claims are verified.';
    } else if (passportStatus === 'LIMITED') {
      reason = 'Deal Room access granted. Accredited Investor badge is missing.';
    } else if (passportStatus === 'RED') {
      reason = 'Critical compliance claim failed.';
    } else if (passportStatus === 'IN_PROGRESS') {
      reason = 'Verification is in progress. Access not yet determined.';
    } else {
      reason = 'No verified compliance claims found.';
    }

    return {
      allowed,
      passportStatus,
      ...access,
      reason,
    };
  }
}
