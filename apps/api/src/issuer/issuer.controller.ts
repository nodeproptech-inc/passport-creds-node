import { Body, Controller, ForbiddenException, Get, Post } from '@nestjs/common';
import { IsBoolean, IsEthereumAddress, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { keccak256, toHex, type Address, type Hex } from 'viem';
import { randomBytes } from 'crypto';
import { IssuerSigningService } from './issuer-signing.service';
import { RevocationService } from './revocation.service';
import { CLAIM_TOPICS, type ClaimTopicName } from './claim-topics';

const TOPIC_NAMES = Object.keys(CLAIM_TOPICS);

class MockClaimDto {
  @IsEthereumAddress()
  identity!: Address;

  @IsIn(TOPIC_NAMES)
  topic!: ClaimTopicName;

  @IsOptional()
  @IsBoolean()
  approved?: boolean; // default true; false = evidence rejected, no claim issued

  @IsOptional()
  @IsInt()
  @Min(0)
  expiresInDays?: number; // default 365; 0 = no expiry
}

class RevokeDto {
  @IsOptional()
  @IsEthereumAddress()
  wallet?: Address; // resolved to identity via IdentityFactory when identity omitted

  @IsOptional()
  @IsEthereumAddress()
  identity?: Address;

  @IsIn(TOPIC_NAMES)
  topic!: ClaimTopicName;

  @IsOptional()
  @IsBoolean()
  value?: boolean; // default true = latch revoked
}

/**
 * IssuerController — evidence -> signed claim.
 *
 * `/issuer/mock-claim` is the LABELED MOCK evidence handler (KYC / accredited placeholders — never
 * real KYC). The World handler (other dev) follows the SAME shape: validate the World proof, then
 * call `signing.signClaim(...)`. Model B: we return (signature, data); the USER submits the claim.
 *
 * SECURITY: mock-claim signs real submittable claims and revoke uses the AGENT key — both are
 * gated to DEMO_MODE so a reachable deployment can't self-issue or revoke compliance claims.
 */
@Controller('issuer')
export class IssuerController {
  constructor(
    private readonly signing: IssuerSigningService,
    private readonly revocation: RevocationService,
  ) {}

  /// These endpoints wield the issuer/agent keys — disabled outside the local demo.
  private assertDemoMode(): void {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException('endpoint available only in DEMO_MODE');
    }
  }

  @Get('signer')
  signer() {
    return { signer: this.signing.signerAddress };
  }

  @Post('mock-claim')
  async mockClaim(@Body() dto: MockClaimDto) {
    this.assertDemoMode();
    const approved = dto.approved ?? true;
    if (!approved) {
      // Rejected evidence => no claim. (KYC FAILED = no valid claim = not eligible.)
      return { mock: true, approved: false, message: 'evidence rejected — no claim issued' };
    }

    // Sanitized MOCK evidence -> a hash. NEVER PII. Clearly labeled.
    const mockEvidence = JSON.stringify({ mock: true, topic: dto.topic, approved: true });
    const dataHash = keccak256(toHex(mockEvidence)) as Hex;
    const nonce = `0x${randomBytes(32).toString('hex')}` as Hex;
    const days = dto.expiresInDays ?? 365;
    const expiresAt = days === 0 ? 0n : BigInt(Math.floor(Date.now() / 1000) + days * 86400);

    const signed = await this.signing.signClaim({
      identity: dto.identity,
      topic: CLAIM_TOPICS[dto.topic],
      dataHash,
      expiresAt,
      nonce,
    });

    // Everything the frontend needs for Identity.submitClaim(topic, issuer, sig, data):
    return {
      mock: true,
      approved: true,
      topic: signed.topic.toString(),
      issuer: signed.issuer,
      signature: signed.signature,
      data: signed.data,
    };
  }

  /**
   * The demo's "money moment": an AGENT (AGENT_ROLE) latches a claim revoked on-chain.
   * While latched, EligibilityGate refuses everywhere and no fresh claim can land.
   */
  @Post('revoke')
  async revoke(@Body() dto: RevokeDto) {
    this.assertDemoMode();
    const value = dto.value ?? true;
    return this.revocation.setRevoked({
      wallet: dto.wallet,
      identity: dto.identity,
      topic: CLAIM_TOPICS[dto.topic],
      value,
    });
  }
}
