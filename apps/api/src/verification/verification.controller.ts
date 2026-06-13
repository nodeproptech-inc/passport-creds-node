import { Controller, Post, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { VerificationService } from './verification.service';

@Controller('verification')
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Post('start')
  async start(@Body() body: { walletAddress: string; claimType: string }) {
    return this.verification.startVerification(body.walletAddress, body.claimType);
  }

  @Post(':verificationId/sync-onchain')
  @HttpCode(HttpStatus.OK)
  async syncOnchain(@Param('verificationId') verificationId: string) {
    return this.verification.syncOnchain(verificationId);
  }
}
