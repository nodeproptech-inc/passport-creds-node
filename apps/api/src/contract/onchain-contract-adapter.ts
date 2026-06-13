import { Injectable, Logger } from '@nestjs/common';
import { createWalletClient, createPublicClient, http, parseAbi, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { anvil, sepolia, arbitrumSepolia } from 'viem/chains';
import type { PassportStatus } from '../common/types';
import type {
  IContractAdapter,
  SubmitClaimParams,
  SubmitClaimResult,
  SyncPassportResult,
  AccessSummaryOnchain,
} from './contract-adapter.interface';

const PASSPORT_STATUS_INDEX: PassportStatus[] = [
  'NONE',
  'IN_PROGRESS',
  'LIMITED',
  'GREEN',
  'RED',
  'REVOKED',
  'EXPIRED',
];

const CLAIM_REGISTRY_ABI = parseAbi([
  'function submitClaim(address user, bytes32 claimType, bool approved, bytes32 verificationIdHash, bytes32 attestationHash, uint64 expiresAt) external',
]);

const COMPLIANCE_PASSPORT_ABI = parseAbi([
  'function syncPassport(address user) external returns (uint256 tokenId, uint8 status)',
  'function tokenIdOf(address user) external view returns (uint256)',
  'function statusOf(address user) external view returns (uint8)',
]);

const ACCESS_GATE_ABI = parseAbi([
  'function getAccessSummary(address user) external view returns (bool canAccessDealRoom, bool canAccessInvestorArea, bool canInvest, uint8 passportStatus)',
]);

function resolveChain(chainId: number): Chain {
  if (chainId === 31337) return anvil;
  if (chainId === 11155111) return sepolia;
  if (chainId === 421614) return arbitrumSepolia;
  return { ...anvil, id: chainId };
}

@Injectable()
export class OnchainContractAdapter implements IContractAdapter {
  private readonly logger = new Logger(OnchainContractAdapter.name);

  private readonly publicClient;
  private readonly walletClient;
  private readonly claimRegistryAddress: `0x${string}`;
  private readonly compliancePassportAddress: `0x${string}`;
  private readonly accessGateAddress: `0x${string}`;

  constructor() {
    const rpcUrl = process.env.RPC_URL ?? 'http://localhost:8545';
    const privateKey = process.env.CRE_UPDATER_PRIVATE_KEY as `0x${string}`;
    const chainId = parseInt(process.env.CHAIN_ID ?? '31337', 10);
    const chain = resolveChain(chainId);

    const account = privateKeyToAccount(privateKey);
    this.publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    this.walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

    this.claimRegistryAddress = process.env.CLAIM_REGISTRY_ADDRESS as `0x${string}`;
    this.compliancePassportAddress = process.env.COMPLIANCE_PASSPORT_ADDRESS as `0x${string}`;
    this.accessGateAddress = process.env.ACCESS_GATE_ADDRESS as `0x${string}`;
  }

  async submitClaim(params: SubmitClaimParams): Promise<SubmitClaimResult> {
    this.logger.log(`submitClaim wallet=${params.walletAddress}`);

    const transactionHash = await this.walletClient.writeContract({
      address: this.claimRegistryAddress,
      abi: CLAIM_REGISTRY_ABI,
      functionName: 'submitClaim',
      args: [
        params.walletAddress as `0x${string}`,
        params.claimTypeHash,
        params.approved,
        params.verificationIdHash,
        params.attestationHash,
        BigInt(params.expiresAt),
      ],
    });

    await this.publicClient.waitForTransactionReceipt({ hash: transactionHash });
    this.logger.log(`submitClaim confirmed txHash=${transactionHash}`);
    return { transactionHash };
  }

  async syncPassport(walletAddress: string): Promise<SyncPassportResult> {
    this.logger.log(`syncPassport wallet=${walletAddress}`);

    const transactionHash = await this.walletClient.writeContract({
      address: this.compliancePassportAddress,
      abi: COMPLIANCE_PASSPORT_ABI,
      functionName: 'syncPassport',
      args: [walletAddress as `0x${string}`],
    });

    await this.publicClient.waitForTransactionReceipt({ hash: transactionHash });

    const tokenId = await this.publicClient.readContract({
      address: this.compliancePassportAddress,
      abi: COMPLIANCE_PASSPORT_ABI,
      functionName: 'tokenIdOf',
      args: [walletAddress as `0x${string}`],
    });

    const rawStatus = await this.publicClient.readContract({
      address: this.compliancePassportAddress,
      abi: COMPLIANCE_PASSPORT_ABI,
      functionName: 'statusOf',
      args: [walletAddress as `0x${string}`],
    });

    return {
      transactionHash,
      tokenId: Number(tokenId),
      status: PASSPORT_STATUS_INDEX[rawStatus as number] ?? 'NONE',
    };
  }

  async getAccessSummary(walletAddress: string): Promise<AccessSummaryOnchain> {
    const result = (await this.publicClient.readContract({
      address: this.accessGateAddress,
      abi: ACCESS_GATE_ABI,
      functionName: 'getAccessSummary',
      args: [walletAddress as `0x${string}`],
    })) as [boolean, boolean, boolean, number];

    return {
      canAccessDealRoom: result[0],
      canAccessInvestorArea: result[1],
      canInvest: result[2],
      passportStatus: PASSPORT_STATUS_INDEX[result[3]] ?? 'NONE',
    };
  }
}
