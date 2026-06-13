import { Controller, Post, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { VerificationService } from './verification.service';

@Controller('verification')
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Post('start')
  async start(@Body() body: { walletAddress: string; claimType: string }) {
    return this.verification.startVerification(body.walletAddress, body.claimType);
  }

  // Demo fallback: injects a saved sample AI result without going through the AI Attester.
  // Used when AI Attester Playground is unavailable during the demo.
  @Post(':verificationId/mock-ai-result')
  @HttpCode(HttpStatus.OK)
  async mockAiResult(
    @Param('verificationId') verificationId: string,
    @Body() body: { approved?: boolean; scenario?: string },
  ) {
    return this.verification.injectMockAiResult(verificationId, body.approved ?? true);
  }

  @Post(':verificationId/sync-onchain')
  @HttpCode(HttpStatus.OK)
  async syncOnchain(@Param('verificationId') verificationId: string) {
    return this.verification.syncOnchain(verificationId);
  }
}
