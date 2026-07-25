import { describe, it, expect, beforeAll } from '@jest/globals';
import {
  recoverTypedDataAddress,
  decodeAbiParameters,
  parseAbiParameters,
  keccak256,
  toHex,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { IssuerSigningService } from './issuer-signing.service';

// Well-known Anvil account #1 key — TEST ONLY.
const TEST_PK: Hex = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const CLAIM_ISSUER = '0x0000000000000000000000000000000000001234';
const CHAIN_ID = 11155111;

// Must mirror ClaimIssuer.sol's EIP712("PassportKitClaim","1") + CLAIM_TYPEHASH.
const DOMAIN = {
  name: 'PassportKitClaim',
  version: '1',
  chainId: CHAIN_ID,
  verifyingContract: CLAIM_ISSUER as `0x${string}`,
} as const;
const TYPES = {
  Claim: [
    { name: 'identity', type: 'address' },
    { name: 'topic', type: 'uint256' },
    { name: 'dataHash', type: 'bytes32' },
    { name: 'expiresAt', type: 'uint64' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

describe('IssuerSigningService', () => {
  let service: IssuerSigningService;

  beforeAll(() => {
    process.env.ISSUER_SIGNER_PRIVATE_KEY = TEST_PK;
    process.env.CLAIM_ISSUER_ADDRESS = CLAIM_ISSUER;
    process.env.CHAIN_ID = String(CHAIN_ID);
    service = new IssuerSigningService();
  });

  it('signature recovers to the authorized signer under the on-chain EIP-712 domain', async () => {
    const identity = '0x00000000000000000000000000000000000000A1' as `0x${string}`;
    const topic = BigInt(keccak256(toHex('KYC_VERIFIED')));
    const dataHash = keccak256(toHex('mock-kyc')) as Hex;
    const expiresAt = 0n;
    const nonce = keccak256(toHex('nonce-1')) as Hex;

    const signed = await service.signClaim({ identity, topic, dataHash, expiresAt, nonce });

    const recovered = await recoverTypedDataAddress({
      domain: DOMAIN,
      types: TYPES,
      primaryType: 'Claim',
      message: { identity, topic, dataHash, expiresAt, nonce },
      signature: signed.signature,
    });

    expect(recovered.toLowerCase()).toBe(privateKeyToAccount(TEST_PK).address.toLowerCase());
  });

  it('data encodes as abi.encode(bytes32,uint64,bytes32) — what the contract decodes', async () => {
    const dataHash = keccak256(toHex('x')) as Hex;
    const expiresAt = 123n;
    const nonce = keccak256(toHex('n')) as Hex;

    const signed = await service.signClaim({
      identity: '0x00000000000000000000000000000000000000A1',
      topic: 1n,
      dataHash,
      expiresAt,
      nonce,
    });

    const [dh, exp, nc] = decodeAbiParameters(parseAbiParameters('bytes32, uint64, bytes32'), signed.data);
    expect(dh).toBe(dataHash);
    expect(exp).toBe(expiresAt);
    expect(nc).toBe(nonce);
  });
});
