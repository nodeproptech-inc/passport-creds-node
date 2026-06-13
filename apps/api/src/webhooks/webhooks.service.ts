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
    // Support Chainlink AI Attester native format where the webhook body is just
    // the AI output JSON (no verificationId/walletAddress wrapper). In that case,
    // resolve the session by walletAddress + claimType lookup.
    let rawPayload = payload;
    if (typeof (payload as any).output === 'string') {
      // Chainlink wraps output as a JSON string inside an envelope object
      try {
        const parsed = JSON.parse((payload as any).output);
        rawPayload = { ...parsed, ...(payload as any) };
      } catch {
        throw new BadRequestException('Failed to parse Chainlink output field as JSON');
      }
    }

    const {
      claimType,
      approved,
      confidence,
      reasonCode,
      summary,
      attestationId,
    } = rawPayload;

    if (!claimType || !SUPPORTED_CLAIM_TYPES.has(claimType)) {
      throw new BadRequestException(`Unsupported claimType: ${claimType}`);
    }
    if (typeof approved !== 'boolean') throw new BadRequestException('approved must be boolean');
    if (typeof confidence !== 'number') throw new BadRequestException('confidence must be number');

    const expiresAt = resolveExpiresAt(rawPayload.expiresAt);

    let session: { id: string; walletAddress: string; claimType: string } | null = null;

    if (rawPayload.verificationId) {
      // Standard path — verificationId provided directly
      session = await this.prisma.verificationSession.findUnique({
        where: { id: rawPayload.verificationId },
      });
      if (!session) throw new NotFoundException(`Verification session not found: ${rawPayload.verificationId}`);
    } else if (rawPayload.walletAddress) {
      // Chainlink path — no verificationId, resolve by walletAddress + claimType
      this.logger.warn(
        `No verificationId in webhook — resolving by walletAddress + claimType (Chainlink format)`,
      );
      session = await this.prisma.verificationSession.findFirst({
        where: {
          walletAddress: normalizeAddress(rawPayload.walletAddress),
          claimType: claimType as any,
          status: { in: ['PENDING', 'PROCESSING'] },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!session) {
        throw new NotFoundException(
          `No pending session found for walletAddress=${rawPayload.walletAddress} claimType=${claimType}`,
        );
      }
    } else {
      throw new BadRequestException(
        'Missing verificationId or walletAddress — cannot resolve verification session',
      );
    }

    const verificationId = session.id;
    const walletAddress = session.walletAddress;

    if (rawPayload.walletAddress && normalizeAddress(rawPayload.walletAddress) !== walletAddress) {
      throw new BadRequestException('walletAddress does not match verification session');
    }
    if (session.claimType !== claimType) {
      throw new BadRequestException('claimType does not match verification session');
    }

    this.logger.log(
      `Webhook received: verificationId=${verificationId} claimType=${claimType} approved=${approved}`,
    );

    const attestationHash = rawPayload.attestationHash
      ?? buildAttestationHash({ verificationId, walletAddress, claimType, approved, confidence, reasonCode });

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
        sanitizedPayload: { claimType, approved, confidence, reasonCode, summary },
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
