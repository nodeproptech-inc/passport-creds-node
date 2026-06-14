import { Controller, Post, Body, Headers, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import type { AIAttesterWebhookPayload } from '../common/types';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('ai-attester')
  @HttpCode(HttpStatus.OK)
  async aiAttesterWebhook(
    @Headers('x-webhook-secret') secret: string | undefined,
    @Query('verificationId') verificationId: string | undefined,
    @Body() payload: AIAttesterWebhookPayload,
  ) {
    this.webhooks.validateSecret(secret);
    return this.webhooks.handleAiAttesterWebhook(payload, verificationId);
  }
}
