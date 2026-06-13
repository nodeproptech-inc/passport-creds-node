import { Controller, Get, Param } from '@nestjs/common';
import { PassportService } from './passport.service';
import { PassportState } from '../common/types';

@Controller('passport')
export class PassportController {
  constructor(private readonly passportService: PassportService) {}

  @Get(':walletAddress')
  async getPassport(@Param('walletAddress') walletAddress: string): Promise<PassportState> {
    return this.passportService.getPassportState(walletAddress);
  }
}
