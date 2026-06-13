-- CreateEnum
CREATE TYPE "PassportStatus" AS ENUM ('NONE', 'IN_PROGRESS', 'LIMITED', 'GREEN', 'RED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ClaimType" AS ENUM ('KYC_AML_VERIFIED', 'ACCREDITED_INVESTOR');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'PROCESSING', 'VERIFIED', 'FAILED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CREStatus" AS ENUM ('NOT_STARTED', 'TRIGGERED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'SIMULATED');

-- CreateEnum
CREATE TYPE "ContractName" AS ENUM ('ClaimRegistry', 'CompliancePassport', 'AccessGate');

-- CreateTable
CREATE TABLE "WalletProfile" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'node-proptech',
    "passportStatus" "PassportStatus" NOT NULL DEFAULT 'NONE',
    "passportTokenId" TEXT,
    "passportTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceClaim" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'node-proptech',
    "claimType" "ClaimType" NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION,
    "reasonCode" TEXT,
    "summary" TEXT,
    "attestationId" TEXT,
    "attestationHash" TEXT,
    "verificationId" TEXT,
    "transactionHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationSession" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'node-proptech',
    "claimType" "ClaimType" NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "creStatus" "CREStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "approved" BOOLEAN,
    "confidence" DOUBLE PRECISION,
    "reasonCode" TEXT,
    "summary" TEXT,
    "attestationId" TEXT,
    "attestationHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "webhookReceivedAt" TIMESTAMP(3),
    "creTriggeredAt" TIMESTAMP(3),
    "creCompletedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "transactionHash" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIAttesterWebhookEvent" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'node-proptech',
    "claimType" "ClaimType" NOT NULL,
    "approved" BOOLEAN NOT NULL,
    "confidence" DOUBLE PRECISION,
    "reasonCode" TEXT,
    "summary" TEXT,
    "attestationId" TEXT,
    "attestationHash" TEXT,
    "sanitizedPayload" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIAttesterWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionRecord" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'node-proptech',
    "verificationId" TEXT,
    "claimType" "ClaimType",
    "contractName" "ContractName" NOT NULL,
    "action" TEXT NOT NULL,
    "transactionHash" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "chainId" INTEGER,
    "blockNumber" INTEGER,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "TransactionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletProfile_walletAddress_key" ON "WalletProfile"("walletAddress");

-- CreateIndex
CREATE INDEX "WalletProfile_walletAddress_idx" ON "WalletProfile"("walletAddress");

-- CreateIndex
CREATE INDEX "WalletProfile_tenantId_idx" ON "WalletProfile"("tenantId");

-- CreateIndex
CREATE INDEX "WalletProfile_passportStatus_idx" ON "WalletProfile"("passportStatus");

-- CreateIndex
CREATE INDEX "ComplianceClaim_walletAddress_idx" ON "ComplianceClaim"("walletAddress");

-- CreateIndex
CREATE INDEX "ComplianceClaim_tenantId_idx" ON "ComplianceClaim"("tenantId");

-- CreateIndex
CREATE INDEX "ComplianceClaim_claimType_idx" ON "ComplianceClaim"("claimType");

-- CreateIndex
CREATE INDEX "ComplianceClaim_status_idx" ON "ComplianceClaim"("status");

-- CreateIndex
CREATE INDEX "ComplianceClaim_verificationId_idx" ON "ComplianceClaim"("verificationId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceClaim_walletAddress_claimType_key" ON "ComplianceClaim"("walletAddress", "claimType");

-- CreateIndex
CREATE INDEX "VerificationSession_walletAddress_idx" ON "VerificationSession"("walletAddress");

-- CreateIndex
CREATE INDEX "VerificationSession_tenantId_idx" ON "VerificationSession"("tenantId");

-- CreateIndex
CREATE INDEX "VerificationSession_claimType_idx" ON "VerificationSession"("claimType");

-- CreateIndex
CREATE INDEX "VerificationSession_status_idx" ON "VerificationSession"("status");

-- CreateIndex
CREATE INDEX "VerificationSession_creStatus_idx" ON "VerificationSession"("creStatus");

-- CreateIndex
CREATE INDEX "AIAttesterWebhookEvent_verificationId_idx" ON "AIAttesterWebhookEvent"("verificationId");

-- CreateIndex
CREATE INDEX "AIAttesterWebhookEvent_walletAddress_idx" ON "AIAttesterWebhookEvent"("walletAddress");

-- CreateIndex
CREATE INDEX "AIAttesterWebhookEvent_tenantId_idx" ON "AIAttesterWebhookEvent"("tenantId");

-- CreateIndex
CREATE INDEX "AIAttesterWebhookEvent_claimType_idx" ON "AIAttesterWebhookEvent"("claimType");

-- CreateIndex
CREATE INDEX "AIAttesterWebhookEvent_receivedAt_idx" ON "AIAttesterWebhookEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "TransactionRecord_walletAddress_idx" ON "TransactionRecord"("walletAddress");

-- CreateIndex
CREATE INDEX "TransactionRecord_tenantId_idx" ON "TransactionRecord"("tenantId");

-- CreateIndex
CREATE INDEX "TransactionRecord_verificationId_idx" ON "TransactionRecord"("verificationId");

-- CreateIndex
CREATE INDEX "TransactionRecord_claimType_idx" ON "TransactionRecord"("claimType");

-- CreateIndex
CREATE INDEX "TransactionRecord_contractName_idx" ON "TransactionRecord"("contractName");

-- CreateIndex
CREATE INDEX "TransactionRecord_transactionHash_idx" ON "TransactionRecord"("transactionHash");

-- CreateIndex
CREATE INDEX "TransactionRecord_status_idx" ON "TransactionRecord"("status");

-- AddForeignKey
ALTER TABLE "ComplianceClaim" ADD CONSTRAINT "ComplianceClaim_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "WalletProfile"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationSession" ADD CONSTRAINT "VerificationSession_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "WalletProfile"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAttesterWebhookEvent" ADD CONSTRAINT "AIAttesterWebhookEvent_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "VerificationSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionRecord" ADD CONSTRAINT "TransactionRecord_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "WalletProfile"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;
