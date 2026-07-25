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
import { DemoStateService } from '../demo/demo-state.service';

export interface CreateIdentityResult {
  identity: Address; // the deployed ERC-734/735 Identity contract owned by `wallet`
  wallet: Address;
  created: boolean; // false = already existed (idempotent, no tx sent)
  transactionHash: Hex | null; // null when it already existed
}

const IDENTITY_FACTORY_ABI = parseAbi([
  'function createIdentity(address wallet) returns (address identity)',
  'function identityOfWallet(address) view returns (address)',
]);

function resolveChain(chainId: number): Chain {
  if (chainId === 31337) return anvil;
  if (chainId === 11155111) return sepolia;
  if (chainId === 421614) return arbitrumSepolia;
  return { ...anvil, id: chainId };
}

/**
 * IdentityService — provisions a user's on-chain Identity (Model B).
 *
 * `IdentityFactory.createIdentity(wallet)` is `onlyRole(AGENT_ROLE)`, so ONLY the backend agent key
 * can call it. It deploys a fresh `Identity` whose MANAGEMENT key is the USER's wallet — the user
 * still owns it and submits their own claims; the backend only provisions the container (this is why
 * it's a backend endpoint and not a user wallet tx). Idempotent: if the wallet already has an
 * identity, we return it without sending a tx.
 *
 * Uses AGENT_PRIVATE_KEY (same key as revocation.service). Mirrors it: no crash at boot if the key or
 * factory address is missing — throws only when called.
 */
@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);
  private readonly account?: PrivateKeyAccount;
  private readonly chain: Chain;
  private readonly rpcUrl: string;
  private readonly identityFactoryAddress: Address;

  private readonly publicClient;
  private readonly walletClient?;

  constructor(private readonly demo: DemoStateService) {
    this.rpcUrl = process.env.RPC_URL ?? 'http://localhost:8545';
    const chainId = parseInt(process.env.CHAIN_ID ?? '11155111', 10);
    this.chain = resolveChain(chainId);
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
      this.logger.log(`Agent identity provisioning ready: ${this.account.address}`);
    } else {
      this.logger.warn('AGENT_PRIVATE_KEY not set — identity creation disabled until configured');
    }
  }

  async createIdentity(wallet: Address): Promise<CreateIdentityResult> {
    if (this.demo.enabled) {
      const existing = this.demo.identityFor(wallet);
      const identity = this.demo.createIdentity(wallet);
      return { identity, wallet, created: !existing, transactionHash: null };
    }

    if (
      this.identityFactoryAddress === ('0x' as Address) ||
      this.identityFactoryAddress === zeroAddress
    ) {
      throw new Error('IDENTITY_FACTORY_ADDRESS not configured');
    }

    // Idempotent: return the existing identity without a tx.
    const existing = await this.readIdentityOfWallet(wallet);
    if (existing !== zeroAddress) {
      this.logger.log(`identity already exists for ${wallet}: ${existing}`);
      return { identity: existing, wallet, created: false, transactionHash: null };
    }

    if (!this.account || !this.walletClient) {
      throw new Error('AGENT_PRIVATE_KEY not configured');
    }

    this.logger.log(`createIdentity wallet=${wallet}`);
    const transactionHash = await this.walletClient.writeContract({
      address: this.identityFactoryAddress,
      abi: IDENTITY_FACTORY_ABI,
      functionName: 'createIdentity',
      args: [wallet],
    });
    await this.publicClient.waitForTransactionReceipt({ hash: transactionHash });

    // The factory sets identityOfWallet in the same tx — read it back for the address.
    const identity = await this.readIdentityOfWallet(wallet);
    if (identity === zeroAddress) {
      throw new Error(`createIdentity confirmed but identityOfWallet still empty for ${wallet}`);
    }
    this.logger.log(`identity created ${identity} txHash=${transactionHash}`);

    return { identity, wallet, created: true, transactionHash };
  }

  private async readIdentityOfWallet(wallet: Address): Promise<Address> {
    return (await this.publicClient.readContract({
      address: this.identityFactoryAddress,
      abi: IDENTITY_FACTORY_ABI,
      functionName: 'identityOfWallet',
      args: [wallet],
    })) as Address;
  }
}
