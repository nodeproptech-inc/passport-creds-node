import { Module } from '@nestjs/common';
import { AttesterService } from './attester.service';

@Module({
  providers: [AttesterService],
  exports: [AttesterService],
})
export class AttesterModule {}
