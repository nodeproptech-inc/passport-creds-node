import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import { signRequest } from '@worldcoin/idkit-server';
import { keccak256, toHex, type Address, type Hex } from 'viem';
import { randomBytes } from 'crypto';
import { DemoStateService } from '../demo/demo-state.service';
import { CLAIM_TOPICS } from '../issuer/claim-topics';
import { IssuerSigningService } from '../issuer/issuer-signing.service';

type RpContext = {
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
};

/**
 * World ID Cloud verification. The browser only obtains a signed request and returns a proof;
 * World verifies that proof at its API before this service signs a PassportKit claim.
 */
@Injectable()
export class WorldIdService {
  private readonly logger = new Logger(WorldIdService.name);

  constructor(
    private readonly signing: IssuerSigningService,
    private readonly demo: DemoStateService,
  ) {}

  createRequest(): { app_id: string; action: string; environment: 'staging'; rp_context: RpContext } {
    const appId = process.env.WORLD_APP_ID;
    const rpId = process.env.WORLD_RP_ID;
    const signingKeyHex = process.env.WORLD_RP_SIGNING_KEY;
    const action = process.env.WORLD_ACTION ?? 'passportkit-verify';

    if (!appId || appId === 'app_' || !rpId || !signingKeyHex) {
      throw new BadRequestException(
        'World ID is not configured. Set WORLD_APP_ID, WORLD_RP_ID and WORLD_RP_SIGNING_KEY in apps/api/.env.',
      );
    }

    const signed = signRequest({ signingKeyHex, action });
    return {
      app_id: appId,
      action,
      environment: 'staging',
      rp_context: {
        rp_id: rpId,
        nonce: signed.nonce,
        created_at: signed.createdAt,
        expires_at: signed.expiresAt,
        signature: signed.sig,
      },
    };
  }

  async verifyAndPrepareClaim(
    wallet: Address,
    identity: Address,
    idkitResponse: Record<string, unknown>,
  ) {
    const rpId = process.env.WORLD_RP_ID;
    const action = process.env.WORLD_ACTION ?? 'passportkit-verify';
    if (!rpId) throw new BadRequestException('WORLD_RP_ID is not configured');

    let verification: { success?: boolean; nullifier?: string; message?: string };
    try {
      const response = await fetch(`https://developer.world.org/api/v4/verify/${rpId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'passportkit-node' },
        // IDKit generates this payload; do not reshape the proof in the browser or server.
        body: JSON.stringify(idkitResponse),
      });
      verification = (await response.json()) as { success?: boolean; nullifier?: string; message?: string };
      if (!response.ok || !verification.success) {
        throw new BadRequestException(verification.message ?? 'World ID rejected this proof');
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error('World ID verifier request failed', error instanceof Error ? error.stack : undefined);
      throw new BadGatewayException('Unable to reach the World ID verifier');
    }

    // Only a hash of the World action/nullifier reference enters claim data; no proof or PII is on-chain.
    const dataHash = keccak256(
      toHex(JSON.stringify({ provider: 'world-id', action, nullifier: verification.nullifier ?? 'verified' })),
    ) as Hex;
    const nonce = `0x${randomBytes(32).toString('hex')}` as Hex;
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 365 * 86400);

    try {
      const claim = await this.signing.signClaim({
        identity,
        topic: CLAIM_TOPICS.PROOF_OF_PERSONHOOD,
        dataHash,
        expiresAt,
        nonce,
      });
      return { mode: 'onchain' as const, verified: true, claim };
    } catch (error) {
      if (!this.demo.enabled) throw error;
      this.demo.markPersonhoodVerified(wallet);
      this.logger.warn('World proof verified, but no issuer key/contracts are configured: returning explicit MOCK result');
      return {
        mode: 'mock' as const,
        verified: true,
        message: 'World proof verified. DEMO_MODE records a local status only; no claim was written on-chain.',
      };
    }
  }
}
