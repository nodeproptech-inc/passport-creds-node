import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WalletPolicyService } from './wallet-policy.service';
import { normalizeAddress } from '../common/utils';
import { TENANT_ID } from '../common/constants';

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: WalletPolicyService,
  ) {}

  async setupPrivyWallet(privyUserId: string, rawWalletAddress: string) {
    const walletAddress = normalizeAddress(rawWalletAddress);

    const profile = await this.prisma.walletProfile.upsert({
      where: { walletAddress },
      create: {
        walletAddress,
        tenantId: TENANT_ID,
        walletProvider: 'PRIVY_EMBEDDED',
        privyUserId,
      },
      update: {
        walletProvider: 'PRIVY_EMBEDDED',
        privyUserId,
      },
    });

    await this.policy.ensurePolicy(walletAddress);
    const policyState = await this.policy.getPolicy(walletAddress);

    this.logger.log(`Privy wallet registered: ${walletAddress} (privyUserId=${privyUserId})`);

    return {
      walletAddress: profile.walletAddress,
      privyUserId: profile.privyUserId,
      walletProvider: profile.walletProvider,
      passportStatus: profile.passportStatus,
      policy: policyState,
    };
  }
}
