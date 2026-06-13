import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ContractName, TransactionStatus } from '../common/types';

export interface SaveTransactionParams {
  walletAddress: string;
  verificationId?: string;
  claimType?: string;
  contractName: ContractName;
  action: string;
  transactionHash?: string;
  status?: TransactionStatus;
  chainId?: number;
  blockNumber?: number;
}

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async save(params: SaveTransactionParams): Promise<void> {
    await this.prisma.transactionRecord.create({
      data: {
        walletAddress: params.walletAddress,
        verificationId: params.verificationId ?? null,
        claimType: (params.claimType as any) ?? null,
        contractName: params.contractName as any,
        action: params.action,
        transactionHash: params.transactionHash ?? null,
        status: (params.status ?? 'CONFIRMED') as any,
        chainId: params.chainId ?? null,
        blockNumber: params.blockNumber ?? null,
      },
    });
  }
}
