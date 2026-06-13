import { Module } from '@nestjs/common';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { ContractModule } from '../contract/contract.module';
import { TransactionsModule } from '../transactions/transactions.module';

@Module({
  imports: [ContractModule, TransactionsModule],
  controllers: [VerificationController],
  providers: [VerificationService],
})
export class VerificationModule {}
