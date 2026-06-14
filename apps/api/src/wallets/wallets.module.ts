import { Module } from '@nestjs/common';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';
import { WalletPolicyService } from './wallet-policy.service';

@Module({
  controllers: [WalletsController],
  providers: [WalletsService, WalletPolicyService],
  exports: [WalletPolicyService],
})
export class WalletsModule {}
