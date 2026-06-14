-- CreateEnum
CREATE TYPE "WalletProvider" AS ENUM ('METAMASK', 'PRIVY_EMBEDDED');

-- AlterTable
ALTER TABLE "WalletProfile" ADD COLUMN     "privyUserId" TEXT,
ADD COLUMN     "walletProvider" "WalletProvider" NOT NULL DEFAULT 'METAMASK';

-- CreateTable
CREATE TABLE "WalletTransferPolicy" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "policyStatus" TEXT NOT NULL DEFAULT 'NO_KYC_DAILY_50',
    "dailyLimitUsd" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "limitToken" TEXT NOT NULL DEFAULT 'USDC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletTransferPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransferPolicyDecision" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedAmountUsd" DOUBLE PRECISION NOT NULL,
    "dailySpentUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dailyLimitUsd" DOUBLE PRECISION NOT NULL,
    "policyStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransferPolicyDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransferPolicy_walletAddress_key" ON "WalletTransferPolicy"("walletAddress");

-- CreateIndex
CREATE INDEX "WalletTransferPolicy_walletAddress_idx" ON "WalletTransferPolicy"("walletAddress");

-- CreateIndex
CREATE INDEX "WalletTransferPolicy_policyStatus_idx" ON "WalletTransferPolicy"("policyStatus");

-- CreateIndex
CREATE INDEX "WalletTransferPolicyDecision_walletAddress_idx" ON "WalletTransferPolicyDecision"("walletAddress");

-- CreateIndex
CREATE INDEX "WalletTransferPolicyDecision_createdAt_idx" ON "WalletTransferPolicyDecision"("createdAt");

-- CreateIndex
CREATE INDEX "WalletProfile_privyUserId_idx" ON "WalletProfile"("privyUserId");

-- AddForeignKey
ALTER TABLE "WalletTransferPolicy" ADD CONSTRAINT "WalletTransferPolicy_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "WalletProfile"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransferPolicyDecision" ADD CONSTRAINT "WalletTransferPolicyDecision_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "WalletTransferPolicy"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;
