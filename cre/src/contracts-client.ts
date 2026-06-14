import {
  createWalletClient,
  createPublicClient,
  http,
  defineChain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  PRIVATE_KEY,
  RPC_URL,
  CHAIN_ID,
  CLAIM_REGISTRY_ADDRESS,
  COMPLIANCE_PASSPORT_ADDRESS,
  ACCESS_GATE_ADDRESS,
  DEMO_MODE,
} from './config.js';
import { onchainStatusToString } from './status.js';
import type { PassportStatus, AccessSummary } from './types.js';

// ─── ABIs ─────────────────────────────────────────────────

const CLAIM_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'submitClaim',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'claimType', type: 'bytes32' },
      { name: 'approved', type: 'bool' },
      { name: 'verificationIdHash', type: 'bytes32' },
      { name: 'attestationHash', type: 'bytes32' },
      { name: 'expiresAt', type: 'uint64' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

const COMPLIANCE_PASSPORT_ABI = [
  {
    type: 'function',
    name: 'syncPassport',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'status', type: 'uint8' },
    ],
    stateMutability: 'nonpayable',
  },
] as const;

const ACCESS_GATE_ABI = [
  {
    type: 'function',
    name: 'getAccessSummary',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'canAccessDealRoom', type: 'bool' },
          { name: 'canAccessInvestorArea', type: 'bool' },
          { name: 'canInvest', type: 'bool' },
          { name: 'passportStatus', type: 'uint8' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const;

// ─── Chain + clients ───────────────────────────────────────

const CHAIN_NAMES: Record<number, string> = {
  31337: 'Local Anvil',
  84532: 'Base Sepolia',
  11155111: 'Sepolia',
};

const chain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_NAMES[CHAIN_ID] ?? `Chain ${CHAIN_ID}`,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

const account = privateKeyToAccount(PRIVATE_KEY);

const walletClient = createWalletClient({ account, chain, transport: http(RPC_URL) });
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

// ─── Mock helper ───────────────────────────────────────────

function mockTxHash(label: string): `0x${string}` {
  const seed = `demo-${label}-${Date.now()}`;
  let hash = '0x';
  for (let i = 0; i < 64; i++) {
    hash += Math.floor(Math.random() * 16).toString(16);
  }
  void seed;
  return hash as `0x${string}`;
}

// ─── Contract calls ────────────────────────────────────────

export async function submitClaim(input: {
  walletAddress: `0x${string}`;
  claimTypeBytes32: `0x${string}`;
  approved: boolean;
  verificationIdHash: `0x${string}`;
  attestationHashBytes32: `0x${string}`;
  expiresAt: number;
}): Promise<{ transactionHash: string; simulated: boolean }> {
  if (DEMO_MODE) {
    console.log('[CRE][DEMO] submitClaim simulated for', input.walletAddress);
    return { transactionHash: mockTxHash('claim'), simulated: true };
  }

  const hash = await walletClient.writeContract({
    address: CLAIM_REGISTRY_ADDRESS,
    abi: CLAIM_REGISTRY_ABI,
    functionName: 'submitClaim',
    args: [
      input.walletAddress,
      input.claimTypeBytes32,
      input.approved,
      input.verificationIdHash,
      input.attestationHashBytes32,
      BigInt(input.expiresAt),
    ],
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return { transactionHash: hash, simulated: false };
}

export async function syncPassport(walletAddress: `0x${string}`): Promise<{
  transactionHash: string;
  tokenId: string;
  passportStatus: PassportStatus;
  simulated: boolean;
}> {
  if (DEMO_MODE) {
    console.log('[CRE][DEMO] syncPassport simulated for', walletAddress);
    return {
      transactionHash: mockTxHash('passport'),
      tokenId: '1',
      passportStatus: 'LIMITED',
      simulated: true,
    };
  }

  // Simulate first to get the return values (tokenId, status)
  const { result } = await publicClient.simulateContract({
    address: COMPLIANCE_PASSPORT_ADDRESS,
    abi: COMPLIANCE_PASSPORT_ABI,
    functionName: 'syncPassport',
    args: [walletAddress],
    account,
  });

  const hash = await walletClient.writeContract({
    address: COMPLIANCE_PASSPORT_ADDRESS,
    abi: COMPLIANCE_PASSPORT_ABI,
    functionName: 'syncPassport',
    args: [walletAddress],
    gas: 400_000n,
  });

  await publicClient.waitForTransactionReceipt({ hash });

  const [tokenIdBig, statusIndex] = result as [bigint, number];
  return {
    transactionHash: hash,
    tokenId: String(tokenIdBig),
    passportStatus: onchainStatusToString(Number(statusIndex)),
    simulated: false,
  };
}

export async function getAccessSummary(walletAddress: `0x${string}`): Promise<AccessSummary> {
  if (DEMO_MODE) {
    return {
      canAccessDealRoom: false,
      canAccessInvestorArea: false,
      canInvest: false,
      passportStatus: 'NONE',
    };
  }

  const summary = await publicClient.readContract({
    address: ACCESS_GATE_ADDRESS,
    abi: ACCESS_GATE_ABI,
    functionName: 'getAccessSummary',
    args: [walletAddress],
  });

  return {
    canAccessDealRoom: summary.canAccessDealRoom,
    canAccessInvestorArea: summary.canAccessInvestorArea,
    canInvest: summary.canInvest,
    passportStatus: onchainStatusToString(summary.passportStatus),
  };
}
