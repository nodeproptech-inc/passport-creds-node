import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IssuerModule } from './issuer/issuer.module';
import { EligibilityModule } from './eligibility/eligibility.module';
import { IdentityModule } from './identity/identity.module';
import { DemoModule } from './demo/demo.module';
import { WorldIdModule } from './world-id/world-id.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DemoModule,
    // The prior Prisma/CRE/passport stack remains in the repository during migration,
    // but is deliberately not bootstrapped by the new local API. It requires a legacy
    // database schema and is outside the Model B World ID flow.
    IssuerModule,
    EligibilityModule,
    IdentityModule,
    WorldIdModule,
  ],
})
export class AppModule {}
