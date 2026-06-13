import { Module } from '@nestjs/common';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { ContractModule } from '../contract/contract.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { CREModule } from '../cre/cre.module';
import { AttesterModule } from '../attester/attester.module';

@Module({
  imports: [ContractModule, TransactionsModule, CREModule, AttesterModule],
  controllers: [VerificationController],
  providers: [VerificationService],
})
export class VerificationModule {}
