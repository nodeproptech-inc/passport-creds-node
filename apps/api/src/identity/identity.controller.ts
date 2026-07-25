import { Body, Controller, Post } from '@nestjs/common';
import { IsEthereumAddress } from 'class-validator';
import { type Address } from 'viem';
import { IdentityService, type CreateIdentityResult } from './identity.service';

class CreateIdentityDto {
  @IsEthereumAddress()
  wallet!: Address;
}

/**
 * IdentityController — provisions a user's on-chain Identity.
 *
 * `POST /identity/create { wallet }` is what the frontend calls right after wallet connect. The
 * backend (agent key) deploys the Identity via IdentityFactory and returns its address; the USER's
 * wallet is its MANAGEMENT key, so the user then submits their own claims (Model B). Idempotent —
 * calling again for a wallet that already has an identity returns it with created:false.
 *
 * Not DEMO_MODE-gated: this is the real user-onboarding path (unlike /issuer/mock-claim + revoke,
 * which wield issuer/agent power over compliance). The factory enforces one identity per wallet.
 */
@Controller('identity')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Post('create')
  create(@Body() dto: CreateIdentityDto): Promise<CreateIdentityResult> {
    return this.identity.createIdentity(dto.wallet);
  }
}
