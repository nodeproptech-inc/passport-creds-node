import { Injectable, Logger } from '@nestjs/common';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { encodeAbiParameters, parseAbiParameters, type Address, type Hex } from 'viem';

export interface SignClaimParams {
  identity: Address;
  topic: bigint;
  dataHash: Hex; // bytes32 — a hash/reference, NEVER PII
  expiresAt: bigint; // uint64, 0 = no expiry
  nonce: Hex; // bytes32 — anti-replay
}

export interface SignedClaim {
  topic: bigint;
  issuer: Address; // the ClaimIssuer contract (verifyingContract)
  signature: Hex; // EIP-712 signature by the authorized signer
  data: Hex; // abi.encode(dataHash, expiresAt, nonce) — pass to Identity.submitClaim(topic, issuer, sig, data)
}

/**
 * IssuerSigningService — the issuer's authority in software.
 *
 * It SIGNS claims off-chain (EIP-712) with the authorized signer key; the HOLDER then submits the
 * signed claim to their own Identity (Model B — no privileged writer). Evidence-agnostic: the mock
 * evidence handler and the (other dev's) World handler both call `signClaim`.
 *
 * The domain + type MUST match contracts/src/ClaimIssuer.sol exactly:
 *   EIP712("PassportKitClaim", "1")
 *   Claim(address identity,uint256 topic,bytes32 dataHash,uint64 expiresAt,bytes32 nonce)
 * otherwise isClaimValid recovers a different address and rejects the claim.
 */
@Injectable()
export class IssuerSigningService {
  private readonly logger = new Logger(IssuerSigningService.name);
  private readonly account?: PrivateKeyAccount;
  private readonly chainId: number;
  private readonly claimIssuer: Address;

  private static readonly TYPES = {
    Claim: [
      { name: 'identity', type: 'address' },
      { name: 'topic', type: 'uint256' },
      { name: 'dataHash', type: 'bytes32' },
      { name: 'expiresAt', type: 'uint64' },
      { name: 'nonce', type: 'bytes32' },
    ],
  } as const;

  constructor() {
    const pk = (process.env.ISSUER_SIGNER_PRIVATE_KEY ?? '') as Hex;
    this.chainId = parseInt(process.env.CHAIN_ID ?? '11155111', 10);
    this.claimIssuer = (process.env.CLAIM_ISSUER_ADDRESS ?? '0x') as Address;
    if (pk && pk !== '0x') {
      this.account = privateKeyToAccount(pk);
      this.logger.log(`Issuer signer ready: ${this.account.address}`);
    } else {
      this.logger.warn('ISSUER_SIGNER_PRIVATE_KEY not set — signing disabled until configured');
    }
  }

  get signerAddress(): Address {
    if (!this.account) throw new Error('ISSUER_SIGNER_PRIVATE_KEY not configured');
    return this.account.address;
  }

  private domain() {
    return {
      name: 'PassportKitClaim',
      version: '1',
      chainId: this.chainId,
      verifyingContract: this.claimIssuer,
    } as const;
  }

  async signClaim(p: SignClaimParams): Promise<SignedClaim> {
    if (!this.account) throw new Error('ISSUER_SIGNER_PRIVATE_KEY not configured');

    const signature = await this.account.signTypedData({
      domain: this.domain(),
      types: IssuerSigningService.TYPES,
      primaryType: 'Claim',
      message: {
        identity: p.identity,
        topic: p.topic,
        dataHash: p.dataHash,
        expiresAt: p.expiresAt,
        nonce: p.nonce,
      },
    });

    // data is what Identity.submitClaim forwards to ClaimIssuer.isClaimValid, which does
    // abi.decode(data, (bytes32, uint64, bytes32)).
    const data = encodeAbiParameters(parseAbiParameters('bytes32, uint64, bytes32'), [
      p.dataHash,
      p.expiresAt,
      p.nonce,
    ]);

    return { topic: p.topic, issuer: this.claimIssuer, signature, data };
  }
}
