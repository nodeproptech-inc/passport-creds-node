import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { WalletPolicyService } from './wallet-policy.service';
import { SetupPrivyWalletDto } from './dto/setup-privy-wallet.dto';
import { UpdateTransferLimitDto } from './dto/update-transfer-limit.dto';
import { TransferIntentDto } from './dto/transfer-intent.dto';
import { normalizeAddress } from '../common/utils';

@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly wallets: WalletsService,
    private readonly policy: WalletPolicyService,
  ) {}

  @Post('privy/setup')
  @HttpCode(HttpStatus.OK)
  async setupPrivyWallet(@Body() dto: SetupPrivyWalletDto) {
    return this.wallets.setupPrivyWallet(dto.privyUserId, dto.walletAddress);
  }

  @Get(':walletAddress/policy')
  async getPolicy(@Param('walletAddress') walletAddress: string) {
    return this.policy.getPolicy(normalizeAddress(walletAddress));
  }

  @Patch(':walletAddress/policy/transfer-limit')
  async updateTransferLimit(
    @Param('walletAddress') walletAddress: string,
    @Body() dto: UpdateTransferLimitDto,
  ) {
    return this.policy.updateTransferLimit(normalizeAddress(walletAddress), dto.dailyLimitUsd);
  }

  @Post(':walletAddress/transfer-intent')
  @HttpCode(HttpStatus.OK)
  async transferIntent(
    @Param('walletAddress') walletAddress: string,
    @Body() dto: TransferIntentDto,
  ) {
    return this.policy.checkTransferIntent(normalizeAddress(walletAddress), dto.amountUsd);
  }
}
