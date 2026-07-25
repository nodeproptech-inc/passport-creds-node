import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { PassportModule } from './passport/passport.module';
import { VerificationModule } from './verification/verification.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { CREModule } from './cre/cre.module';
import { AccessModule } from './access/access.module';
import { TransactionsModule } from './transactions/transactions.module';
import { WalletsModule } from './wallets/wallets.module';
import { IssuerModule } from './issuer/issuer.module';
import { EligibilityModule } from './eligibility/eligibility.module';
import { IdentityModule } from './identity/identity.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    PassportModule,
    VerificationModule,
    WebhooksModule,
    CREModule,
    AccessModule,
    TransactionsModule,
    WalletsModule,
    IssuerModule,
    EligibilityModule,
    IdentityModule,
  ],
})
export class AppModule {}
