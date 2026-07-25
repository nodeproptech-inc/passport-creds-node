import { Controller, Get, Param } from '@nestjs/common';
import { type Address } from 'viem';
import { normalizeAddress } from '../common/utils';
import { EligibilityService, type EligibilityStatus } from './eligibility.service';

/**
 * EligibilityController — read-only eligibility view for a wallet.
 *
 * GET /eligibility/:wallet -> resolve identity + report eligibility per policy
 * (Deal Room, Investor). This is what the frontend/dashboard consumes.
 */
@Controller('eligibility')
export class EligibilityController {
  constructor(private readonly eligibility: EligibilityService) {}

  @Get(':wallet')
  getStatus(@Param('wallet') wallet: string): Promise<EligibilityStatus> {
    return this.eligibility.getStatus(normalizeAddress(wallet) as Address); // 400 on invalid input
  }
}
