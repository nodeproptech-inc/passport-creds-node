import { Module } from '@nestjs/common';
import { WorldIdController } from './world-id.controller';
import { WorldIdService } from './world-id.service';
import { IssuerModule } from '../issuer/issuer.module';

@Module({ imports: [IssuerModule], controllers: [WorldIdController], providers: [WorldIdService] })
export class WorldIdModule {}
