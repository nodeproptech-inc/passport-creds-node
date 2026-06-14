import { Injectable, BadRequestException, Logger } from '@nestjs/common';
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
    await this.prisma.walletTransferPolicy.upsert({
      where: { walletAddress },
      create: { walletAddress, policyStatus: NO_KYC_DAILY_50, dailyLimitUsd: NO_KYC_CAP },
      update: {},
    });
  }

  async getPolicy(walletAddress: string) {
    const policy = await this.prisma.walletTransferPolicy.findUnique({
      where: { walletAddress },
    });
    if (!policy) {
      await this.ensurePolicy(walletAddress);
      return { policyStatus: NO_KYC_DAILY_50, dailyLimitUsd: NO_KYC_CAP, limitToken: 'USDC', canModifyLimit: false };
    }
    return {
      policyStatus: policy.policyStatus,
      dailyLimitUsd: policy.dailyLimitUsd,
      limitToken: policy.limitToken,
      canModifyLimit: policy.policyStatus === KYC_USER_CONFIGURABLE,
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
