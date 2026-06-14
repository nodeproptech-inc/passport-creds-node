import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CREController } from './cre.controller';
import { CREService } from './cre.service';
import { TransactionsModule } from '../transactions/transactions.module';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [HttpModule, TransactionsModule, WalletsModule],
  controllers: [CREController],
  providers: [CREService],
  exports: [CREService],
})
export class CREModule {}
