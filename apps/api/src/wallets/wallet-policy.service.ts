import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const NO_KYC_DAILY_50 = 'NO_KYC_DAILY_50';
const KYC_USER_CONFIGURABLE = 'KYC_USER_CONFIGURABLE';
const BLOCKED = 'BLOCKED';
const NO_KYC_CAP = 50;

@Injectable()
export class WalletPolicyService {
  private readonly logger = new Logger(WalletPolicyService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ensurePolicy(walletAddress: string): Promise<void> {
    try {
      await this.prisma.walletTransferPolicy.upsert({
        where: { walletAddress },
        create: { walletAddress, policyStatus: NO_KYC_DAILY_50, dailyLimitUsd: NO_KYC_CAP },
        update: {},
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Concurrent create — record already exists, safe to ignore
        return;
      }
      throw err;
    }
  }

  async getPolicy(walletAddress: string) {
    await this.ensurePolicy(walletAddress);
    let policy = await this.prisma.walletTransferPolicy.findUnique({ where: { walletAddress } });

    // Auto-upgrade stale NO_KYC_DAILY_50 policies for wallets that already have KYC verified
    if (policy?.policyStatus === NO_KYC_DAILY_50) {
      const kycClaim = await this.prisma.complianceClaim.findFirst({
        where: { walletAddress, claimType: 'KYC_AML_VERIFIED', status: 'VERIFIED' },
      });
      if (kycClaim) {
        await this.prisma.walletTransferPolicy.update({
          where: { walletAddress },
          data: { policyStatus: KYC_USER_CONFIGURABLE },
        });
        policy = await this.prisma.walletTransferPolicy.findUnique({ where: { walletAddress } });
      }
    }

    return {
      policyStatus: policy!.policyStatus,
      dailyLimitUsd: policy!.dailyLimitUsd,
      limitToken: policy!.limitToken,
      canModifyLimit: policy!.policyStatus === KYC_USER_CONFIGURABLE,
    };
  }

  async updateTransferLimit(walletAddress: string, dailyLimitUsd: number) {
    const policy = await this.prisma.walletTransferPolicy.findUnique({ where: { walletAddress } });
    if (!policy || policy.policyStatus !== KYC_USER_CONFIGURABLE) {
      throw new BadRequestException('Transfer limit can only be set after KYC/AML verification');
    }
    const updated = await this.prisma.walletTransferPolicy.update({
      where: { walletAddress },
      data: { dailyLimitUsd },
    });
    return { policyStatus: updated.policyStatus, dailyLimitUsd: updated.dailyLimitUsd };
  }

  async checkTransferIntent(walletAddress: string, amountUsd: number) {
    await this.ensurePolicy(walletAddress);
    const policy = await this.prisma.walletTransferPolicy.findUnique({ where: { walletAddress } });
    if (!policy) {
      return { allowed: false, reason: 'No transfer policy found', policyStatus: NO_KYC_DAILY_50, dailyLimitUsd: NO_KYC_CAP };
    }

    if (policy.policyStatus === BLOCKED) {
      await this.logDecision(walletAddress, false, 'Wallet is blocked due to compliance status', amountUsd, 0, policy);
      return { allowed: false, reason: 'Wallet is blocked due to compliance status', policyStatus: BLOCKED, dailyLimitUsd: 0 };
    }

    const dailySpent = await this.getDailySpent(walletAddress);
    const effectiveLimit = policy.policyStatus === NO_KYC_DAILY_50 ? NO_KYC_CAP : policy.dailyLimitUsd;
    const wouldExceed = dailySpent + amountUsd > effectiveLimit;

    if (wouldExceed) {
      const reason = policy.policyStatus === NO_KYC_DAILY_50
        ? `No KYC/AML — daily limit is ${NO_KYC_CAP} USDC. Complete verification to increase your limit.`
        : `Daily limit of ${effectiveLimit} USDC would be exceeded (${dailySpent.toFixed(2)} USDC spent today)`;
      await this.logDecision(walletAddress, false, reason, amountUsd, dailySpent, policy);
      return { allowed: false, reason, policyStatus: policy.policyStatus, dailyLimitUsd: effectiveLimit };
    }

    const reason = 'Transfer approved';
    await this.logDecision(walletAddress, true, reason, amountUsd, dailySpent, policy);
    return { allowed: true, reason, policyStatus: policy.policyStatus, dailyLimitUsd: effectiveLimit };
  }

  async upgradeAfterKyc(walletAddress: string): Promise<void> {
    const policy = await this.prisma.walletTransferPolicy.findUnique({ where: { walletAddress } });
    if (policy && policy.policyStatus === NO_KYC_DAILY_50) {
      await this.prisma.walletTransferPolicy.update({
        where: { walletAddress },
        data: { policyStatus: KYC_USER_CONFIGURABLE },
      });
      this.logger.log(`Transfer policy upgraded to KYC_USER_CONFIGURABLE for ${walletAddress}`);
    }
  }

  async blockWallet(walletAddress: string): Promise<void> {
    await this.prisma.walletTransferPolicy.upsert({
      where: { walletAddress },
      create: { walletAddress, policyStatus: BLOCKED, dailyLimitUsd: 0 },
      update: { policyStatus: BLOCKED, dailyLimitUsd: 0 },
    });
    this.logger.log(`Transfer policy set to BLOCKED for ${walletAddress}`);
  }

  private async getDailySpent(walletAddress: string): Promise<number> {
    const windowStart = new Date();
    windowStart.setUTCHours(0, 0, 0, 0);
    const decisions = await this.prisma.walletTransferPolicyDecision.findMany({
      where: { walletAddress, allowed: true, createdAt: { gte: windowStart } },
    });
    return decisions.reduce((sum, d) => sum + d.requestedAmountUsd, 0);
  }

  private async logDecision(
    walletAddress: string,
    allowed: boolean,
    reason: string,
    requestedAmountUsd: number,
    dailySpentUsd: number,
    policy: { policyStatus: string; dailyLimitUsd: number },
  ): Promise<void> {
    await this.prisma.walletTransferPolicyDecision.create({
      data: {
        walletAddress,
        allowed,
        reason,
        requestedAmountUsd,
        dailySpentUsd,
        dailyLimitUsd: policy.dailyLimitUsd,
        policyStatus: policy.policyStatus,
      },
    });
  }
}
