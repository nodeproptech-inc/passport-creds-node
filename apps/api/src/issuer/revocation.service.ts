import { Injectable, Logger } from '@nestjs/common';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  zeroAddress,
  type Address,
  type Chain,
  type Hex,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { anvil, sepolia, arbitrumSepolia } from 'viem/chains';

export interface SetRevokedParams {
  wallet?: Address; // resolved to identity via IdentityFactory when identity is omitted
  identity?: Address; // the ERC-734 Identity contract
  topic: bigint; // claim topic id
  value: boolean; // true = latch revoked, false = re-open
}

export interface SetRevokedResult {
  transactionHash: Hex;
  identity: Address;
  topic: string;
  value: boolean;
}

const CLAIM_ISSUER_ABI = parseAbi([
  'function setRevoked(address identity, uint256 topic, bool value)',
]);

const IDENTITY_FACTORY_ABI = parseAbi([
  'function identityOfWallet(address) view returns (address)',
]);

function resolveChain(chainId: number): Chain {
  if (chainId === 31337) return anvil;
  if (chainId === 11155111) return sepolia;
  if (chainId === 421614) return arbitrumSepolia;
  return { ...anvil, id: chainId };
}

/**
 * RevocationService — the demo's "money moment" trigger.
 *
 * An AGENT (holder of AGENT_ROLE on the ClaimIssuer) latches a claim revoked on-chain via
 * `ClaimIssuer.setRevoked(identity, topic, bool)`. While latched, `isClaimValid` is false, so
 * EligibilityGate refuses across every surface AND no fresh claim can land. Only the issuer re-opens.
 *
 * setRevoked is `onlyRole(AGENT_ROLE)`, so this uses AGENT_PRIVATE_KEY (NOT the issuer signer key).
 * Mirrors issuer-signing.service.ts: no crash at boot if the key is missing — throws only when called.
 */
@Injectable()
export class RevocationService {
  private readonly logger = new Logger(RevocationService.name);
  private readonly account?: PrivateKeyAccount;
  private readonly chain: Chain;
  private readonly rpcUrl: string;
  private readonly claimIssuerAddress: Address;
  private readonly identityFactoryAddress: Address;

  private readonly publicClient;
  private readonly walletClient?;

  constructor() {
    this.rpcUrl = process.env.RPC_URL ?? 'http://localhost:8545';
    const chainId = parseInt(process.env.CHAIN_ID ?? '11155111', 10);
    this.chain = resolveChain(chainId);
    this.claimIssuerAddress = (process.env.CLAIM_ISSUER_ADDRESS ?? '0x') as Address;
    this.identityFactoryAddress = (process.env.IDENTITY_FACTORY_ADDRESS ?? '0x') as Address;

    this.publicClient = createPublicClient({ chain: this.chain, transport: http(this.rpcUrl) });

    const pk = (process.env.AGENT_PRIVATE_KEY ?? '') as Hex;
    if (pk && pk !== '0x') {
      this.account = privateKeyToAccount(pk);
      this.walletClient = createWalletClient({
        account: this.account,
        chain: this.chain,
        transport: http(this.rpcUrl),
      });
      this.logger.log(`Agent revocation ready: ${this.account.address}`);
    } else {
      this.logger.warn('AGENT_PRIVATE_KEY not set — revocation disabled until configured');
    }
  }

  async setRevoked(params: SetRevokedParams): Promise<SetRevokedResult> {
    if (!this.account || !this.walletClient) {
      throw new Error('AGENT_PRIVATE_KEY not configured');
    }
    if (this.claimIssuerAddress === ('0x' as Address) || this.claimIssuerAddress === zeroAddress) {
      throw new Error('CLAIM_ISSUER_ADDRESS not configured');
    }
    if (
      this.identityFactoryAddress === ('0x' as Address) ||
      this.identityFactoryAddress === zeroAddress
    ) {
      throw new Error('IDENTITY_FACTORY_ADDRESS not configured');
    }

    const identity = await this.resolveIdentity(params);

    this.logger.log(
      `setRevoked identity=${identity} topic=${params.topic.toString()} value=${params.value}`,
    );

    const transactionHash = await this.walletClient.writeContract({
      address: this.claimIssuerAddress,
      abi: CLAIM_ISSUER_ABI,
      functionName: 'setRevoked',
      args: [identity, params.topic, params.value],
    });

    await this.publicClient.waitForTransactionReceipt({ hash: transactionHash });
    this.logger.log(`setRevoked confirmed txHash=${transactionHash}`);

    return {
      transactionHash,
      identity,
      topic: params.topic.toString(),
      value: params.value,
    };
  }

  private async resolveIdentity(params: SetRevokedParams): Promise<Address> {
    if (params.identity && params.identity !== zeroAddress) {
      return params.identity;
    }
    if (!params.wallet) {
      throw new Error('either wallet or identity must be provided');
    }

    const identity = (await this.publicClient.readContract({
      address: this.identityFactoryAddress,
      abi: IDENTITY_FACTORY_ABI,
      functionName: 'identityOfWallet',
      args: [params.wallet],
    })) as Address;

    if (identity === zeroAddress) {
      throw new Error(`no identity registered for wallet ${params.wallet}`);
    }
    return identity;
  }
}
