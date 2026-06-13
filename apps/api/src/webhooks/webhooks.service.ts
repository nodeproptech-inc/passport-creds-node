import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CREService } from '../cre/cre.service';
import { normalizeAddress, resolveExpiresAt, buildAttestationHash } from '../common/utils';
import { SUPPORTED_CLAIM_TYPES, TENANT_ID } from '../common/constants';
import type { AIAttesterWebhookPayload } from '../common/types';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly webhookSecret = process.env.WEBHOOK_SECRET ?? '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly cre: CREService,
  ) {}

  validateSecret(secret: string | undefined): void {
    if (this.webhookSecret && secret !== this.webhookSecret) {
      throw new UnauthorizedException('Invalid webhook secret');
    }
  }

  async handleAiAttesterWebhook(
    payload: AIAttesterWebhookPayload,
  ): Promise<{ received: boolean; verificationId: string; claimType: string; creTriggered: boolean }> {
    const {
      verificationId,
      claimType,
      approved,
      confidence,
      reasonCode,
      summary,
      attestationId,
    } = payload;

    // Payload validation
    if (!verificationId) throw new BadRequestException('Missing verificationId');
    if (!claimType || !SUPPORTED_CLAIM_TYPES.has(claimType)) {
      throw new BadRequestException(`Unsupported claimType: ${claimType}`);
    }
    if (typeof approved !== 'boolean') throw new BadRequestException('approved must be boolean');
    if (typeof confidence !== 'number') throw new BadRequestException('confidence must be number');

    const walletAddress = normalizeAddress(payload.walletAddress);
    const expiresAt = resolveExpiresAt(payload.expiresAt);

    this.logger.log(
      `Webhook received: verificationId=${verificationId} claimType=${claimType} approved=${approved}`,
    );

    // Confirm the session exists and the wallet matches
    const session = await this.prisma.verificationSession.findUnique({
      where: { id: verificationId },
    });
    if (!session) throw new NotFoundException(`Verification session not found: ${verificationId}`);
    if (session.walletAddress !== walletAddress) {
      throw new BadRequestException('walletAddress does not match verification session');
    }
    if (session.claimType !== claimType) {
      throw new BadRequestException('claimType does not match verification session');
    }

    const attestationHash = payload.attestationHash
      ?? buildAttestationHash({ verificationId, walletAddress, claimType, approved, confidence, reasonCode });

    const sanitizedPayload = { claimType, approved, confidence, reasonCode, summary };

    // Store the webhook event for audit
    await this.prisma.aIAttesterWebhookEvent.create({
      data: {
        verificationId,
        walletAddress,
        tenantId: TENANT_ID,
        claimType: claimType as any,
        approved,
        confidence,
        reasonCode: reasonCode ?? null,
        summary: summary ?? null,
        attestationId: attestationId ?? null,
        attestationHash,
        sanitizedPayload,
      },
    });

    // Update the verification session with the AI result
    await this.prisma.verificationSession.update({
      where: { id: verificationId },
      data: {
        status: 'PROCESSING',
        creStatus: 'NOT_STARTED',
        approved,
        confidence,
        reasonCode: reasonCode ?? null,
        summary: summary ?? null,
        attestationId: attestationId ?? null,
        attestationHash,
        expiresAt,
        webhookReceivedAt: new Date(),
      },
    });

    // Move the ComplianceClaim to PROCESSING until CRE finishes writing onchain
    await this.prisma.complianceClaim.upsert({
      where: { walletAddress_claimType: { walletAddress, claimType: claimType as any } },
      create: {
        walletAddress,
        tenantId: TENANT_ID,
        claimType: claimType as any,
        status: 'PROCESSING',
        approved,
        confidence,
        reasonCode: reasonCode ?? null,
        summary: summary ?? null,
        attestationId: attestationId ?? null,
        attestationHash,
        verificationId,
        expiresAt,
      },
      update: {
        status: 'PROCESSING',
        approved,
        confidence,
        reasonCode: reasonCode ?? null,
        summary: summary ?? null,
        attestationId: attestationId ?? null,
        attestationHash,
        verificationId,
        expiresAt,
      },
    });

    // Trigger CRE with verificationId only — no PII or raw documents
    let creTriggered = false;
    try {
      await this.cre.triggerWorkflow(verificationId);
      creTriggered = true;

      await this.prisma.verificationSession.update({
        where: { id: verificationId },
        data: { creStatus: 'TRIGGERED', creTriggeredAt: new Date() },
      });
    } catch (err) {
      this.logger.error(`CRE trigger failed for ${verificationId}: ${err}`);
    }

    return { received: true, verificationId, claimType, creTriggered };
  }
}
