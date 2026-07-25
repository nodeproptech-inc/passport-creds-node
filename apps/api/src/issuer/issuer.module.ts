import { Module } from '@nestjs/common';
import { IssuerSigningService } from './issuer-signing.service';
import { RevocationService } from './revocation.service';
import { IssuerController } from './issuer.controller';

@Module({
  controllers: [IssuerController],
  providers: [IssuerSigningService, RevocationService],
  exports: [IssuerSigningService, RevocationService],
})
export class IssuerModule {}
