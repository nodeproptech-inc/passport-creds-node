import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createPublicClient,
  createWalletClient,
  http as httpTransport,
  decodeAbiParameters,
  encodeAbiParameters,
  formatEther,
  keccak256,
  parseEther,
  toHex,
  zeroAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry, sepolia } from 'viem/chains';

import { decodeRefusal } from './lib/decode.js';
import { makeDecider } from './lib/deciders.js';
import { parseEnvFile } from './lib/env.js';
import { evidenceHash } from './lib/evidence.js';
import { settleInvoice } from './lib/x402.js';
import {
  MODIFY_LIQUIDITY_TOPIC,
  SWAP_TOPIC,
  MODIFY_LIQUIDITY_EVENT,
  SWAP_EVENT,
  aggregateLiquidity,
  lastPrices,
  poolIdOf,
} from './lib/positions.js';
import { createVendorServer } from './vendor/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = path.resolve(__dirname, '../../contracts');

// ---------------------------------------------------------------- config

const ENV = {
  ...(existsSync(path.join(__dirname, '.env')) ? parseEnvFile(readFileSync(path.join(__dirname, '.env'), 'utf8')) : {}),
  ...process.env,
};
const RPC_URL = ENV.RPC_URL ?? 'http://127.0.0.1:8545';
const PORT = Number(ENV.PORT ?? 4190);
// Loopback by default: every mutating route here is unauthenticated and spends
// the demo's funded keys, so a wider bind hands the wallet to the whole LAN.
const HOST = ENV.BIND_HOST ?? '127.0.0.1';
const VENDOR_PORT = Number(ENV.PORT_VENDOR ?? 4191);
const VENDOR_URL = `http://127.0.0.1:${VENDOR_PORT}`;
const EXPLORER_URL = (ENV.EXPLORER_URL ?? '').replace(/\/$/, '') || null;
const ADDRESSES_FILE = path.join(__dirname, ENV.ADDRESSES_FILE ?? 'addresses.json');

// anvil dev keys as defaults — override in .env for testnets
const KEYS = {
  operator: ENV.OPERATOR_PK ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  ana: ENV.ANA_PK ?? '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  concierge: ENV.CONCIERGE_PK ?? '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  plumber: ENV.PLUMBER_PK ?? '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
};
// the house owners, in the order the treasury holds them
const OWNERS = ['operator', 'ana'];

// the operator key doubles as the ClaimIssuer's authorized EIP-712 signer
const issuerSigner = privateKeyToAccount(KEYS.operator);

const ZERO_ADDRESS = zeroAddress;

// Identity claim payload: abi.encode(dataHash, expiresAt, nonce) — a hash, never PII
const CLAIM_DATA_ABI = [{ type: 'bytes32' }, { type: 'uint64' }, { type: 'bytes32' }];

// ERC-735 topics: uint256(keccak256(name)) — same numbers as libraries/Types.sol
const CLAIM_TOPICS = {
  kyc: BigInt(keccak256(toHex('KYC_VERIFIED'))),
  accredited: BigInt(keccak256(toHex('ACCREDITED_INVESTOR'))),
};
const CLAIM_TOPIC_NAMES = {
  [CLAIM_TOPICS.kyc]: 'KYC_VERIFIED',
  [CLAIM_TOPICS.accredited]: 'ACCREDITED_INVESTOR',
};
// ERC-734 key purposes (Types.sol KeyPurpose)
const KEY_PURPOSES = { 1n: 'MANAGEMENT', 2n: 'ACTION', 3n: 'CLAIM' };

// decision engine: mock rules by default, OpenAI-compatible or 0G when configured
const DECIDER_KIND = ENV.DECIDER ?? 'mock';
const decide = makeDecider(DECIDER_KIND, {
  baseUrl: (ENV.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
  model: ENV.OPENAI_MODEL ?? 'gpt-4o-mini',
  apiKey: ENV.OPENAI_API_KEY,
});

const MIN_SQRT_PRICE_PLUS_1 = 4295128740n;
const MAX_SQRT_PRICE_MINUS_1 = 1461446703485210103287273052203988822378723970341n;

const MANDATE_CAP = parseEther('200');
const MANDATE_DURATION = 365 * 24 * 3600;

// canonical CREATE2 deployer (hook address mining) — anvil ships it at genesis
// but anvil_reset drops it, so reset re-etches it
const CREATE2_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
const CREATE2_DEPLOYER_CODE =
  '0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3';

const POOL_KEY_ABI = {
  type: 'tuple',
  components: [
    { name: 'currency0', type: 'address' },
    { name: 'currency1', type: 'address' },
    { name: 'fee', type: 'uint24' },
    { name: 'tickSpacing', type: 'int24' },
    { name: 'hooks', type: 'address' },
  ],
};

const SWAP_ROUTER_ABI = [
  {
    type: 'function',
    name: 'swap',
    stateMutability: 'payable',
    inputs: [
      { ...POOL_KEY_ABI, name: 'key' },
      {
        type: 'tuple',
        name: 'params',
        components: [
          { name: 'zeroForOne', type: 'bool' },
          { name: 'amountSpecified', type: 'int256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
      {
        type: 'tuple',
        name: 'testSettings',
        components: [
          { name: 'takeClaims', type: 'bool' },
          { name: 'settleUsingBurn', type: 'bool' },
        ],
      },
      { name: 'hookData', type: 'bytes' },
    ],
    outputs: [{ type: 'int256' }],
  },
];

// Identity (ERC-735) — Model B: the HOLDER submits their own issuer-signed claim
const IDENTITY_ABI = [
  {
    type: 'function',
    name: 'submitClaim',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'uint256' }, { type: 'address' }, { type: 'bytes' }, { type: 'bytes' }],
    outputs: [{ type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'getClaim',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }, { type: 'address' }],
    outputs: [{ type: 'bool' }, { type: 'bytes' }, { type: 'bytes' }],
  },
];

const FACTORY_ABI = [
  { type: 'function', name: 'identityOfWallet', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'createIdentity', stateMutability: 'nonpayable', inputs: [{ type: 'address' }], outputs: [{ type: 'address' }] },
];

// ClaimIssuer — signs off-chain (EIP-712) and holds the revocation latch
const ISSUER_ABI = [
  {
    type: 'function',
    name: 'setRevoked',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'bool' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'revoked',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
];

const GATE_ABI = [
  {
    type: 'function',
    name: 'isEligible',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [{ type: 'bool' }, { type: 'bytes32' }],
  },
];

const TREASURY_ABI = [
  { type: 'function', name: 'proposePayment', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approvePayment', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'executePayment', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'fundConcierge', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'grantMandate', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'uint64' }], outputs: [] },
  { type: 'function', name: 'revokeMandate', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  {
    type: 'function',
    name: 'payments',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [
      { name: 'vendor', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'evidenceHash', type: 'bytes32' },
      { name: 'approvals', type: 'uint256' },
      { name: 'executed', type: 'bool' },
    ],
  },
  { type: 'function', name: 'nextPaymentId', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'isAgentInGoodStanding', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }, { type: 'bytes32' }] },
  { type: 'function', name: 'agentPerTxCap', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'APPROVAL_THRESHOLD', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
];

const ERC20_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
];

// events the tx inspector can decode
const INSPECTOR_EVENTS = [
  // --- PassportKit stack ---
  {
    type: 'event',
    name: 'IdentityCreated',
    inputs: [
      { name: 'wallet', type: 'address', indexed: true },
      { name: 'identity', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'ClaimAdded',
    inputs: [
      { name: 'claimId', type: 'bytes32', indexed: true },
      { name: 'topic', type: 'uint256', indexed: true },
      { name: 'issuer', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'ClaimRevoked',
    inputs: [
      { name: 'topic', type: 'uint256', indexed: true },
      { name: 'issuer', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'RevocationSet',
    inputs: [
      { name: 'identity', type: 'address', indexed: true },
      { name: 'topic', type: 'uint256', indexed: true },
      { name: 'revoked', type: 'bool', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'KeyAdded',
    inputs: [
      { name: 'key', type: 'bytes32', indexed: true },
      { name: 'purpose', type: 'uint256', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'TrustedSet',
    inputs: [
      { name: 'issuer', type: 'address', indexed: true },
      { name: 'topic', type: 'uint256', indexed: true },
      { name: 'ok', type: 'bool', indexed: false },
    ],
  },
  // --- HouseTreasury ---
  {
    type: 'event',
    name: 'MandateGranted',
    inputs: [
      { name: 'agent', type: 'address', indexed: true },
      { name: 'perTxCap', type: 'uint256', indexed: false },
      { name: 'expiresAt', type: 'uint64', indexed: false },
    ],
  },
  { type: 'event', name: 'MandateRevoked', inputs: [{ name: 'agent', type: 'address', indexed: true }] },
  {
    type: 'event',
    name: 'ConciergeFunded',
    inputs: [
      { name: 'agent', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Deposited',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PaymentProposed',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'vendor', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'evidenceHash', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PaymentApproved',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'approvals', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PaymentExecuted',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'vendor', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  // --- v4 PoolManager ---
  MODIFY_LIQUIDITY_EVENT,
  SWAP_EVENT,
  {
    type: 'event',
    name: 'Initialize',
    inputs: [
      { name: 'id', type: 'bytes32', indexed: true },
      { name: 'currency0', type: 'address', indexed: true },
      { name: 'currency1', type: 'address', indexed: true },
      { name: 'fee', type: 'uint24', indexed: false },
      { name: 'tickSpacing', type: 'int24', indexed: false },
      { name: 'hooks', type: 'address', indexed: false },
      { name: 'sqrtPriceX96', type: 'uint160', indexed: false },
      { name: 'tick', type: 'int24', indexed: false },
    ],
  },
];

// ---------------------------------------------------------------- world boot

async function rpcCall(method, params = []) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(5000),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

async function rpcUp() {
  try {
    return typeof (await rpcCall('eth_chainId')) === 'string';
  } catch {
    return false;
  }
}

function deployWorld() {
  console.log('[concierge] deploying demo world (forge script DeployConciergeDemo)…');
  const out = spawnSync(
    'forge',
    ['script', 'script/DeployConciergeDemo.s.sol', '--rpc-url', RPC_URL, '--broadcast'],
    // ENV includes .env-file settings (OPERATOR_PK, CONCIERGE_PK, POOL_MANAGER, …) that the
    // forge script reads via vm.envOr — process.env alone would silently drop them
    { cwd: CONTRACTS_DIR, encoding: 'utf8', env: ENV },
  );
  if (out.status !== 0) throw new Error(`deploy failed:\n${out.stdout}\n${out.stderr}`);
}

let A;
let LOCAL;
let CHAIN;
let publicClient;
let wallets;
let actorAddress;
let poolKey;
let poolId;
let casaIsCurrency0;
let logCache;
let vendorServer = null;
let vendorToken = null;

// The mock plumber lives in-process: same lifecycle as the demo, restarted when a
// world reset moves the mUSD address it verifies payments against.
function startVendor() {
  if (vendorServer && vendorToken === A.musd) return;
  if (vendorServer) {
    vendorServer.closeAllConnections?.();
    vendorServer.close();
  }
  vendorServer = createVendorServer({
    port: VENDOR_PORT,
    vendorAddress: actorAddress.plumber,
    tokenAddress: A.musd,
    rpcUrl: RPC_URL,
  });
  vendorToken = A.musd;
}

function loadWorld() {
  A = JSON.parse(readFileSync(ADDRESSES_FILE, 'utf8'));
  CHAIN = A.chainId === 31337 ? foundry : A.chainId === sepolia.id ? sepolia : { ...foundry, id: A.chainId };
  publicClient = createPublicClient({ chain: CHAIN, transport: httpTransport(RPC_URL) });
  wallets = Object.fromEntries(
    Object.entries(KEYS).map(([name, pk]) => [
      name,
      createWalletClient({ account: privateKeyToAccount(pk), chain: CHAIN, transport: httpTransport(RPC_URL) }),
    ]),
  );
  actorAddress = Object.fromEntries(Object.entries(wallets).map(([n, w]) => [n, w.account.address]));
  casaIsCurrency0 = A.casa.toLowerCase() < A.musd.toLowerCase();
  poolKey = {
    currency0: casaIsCurrency0 ? A.casa : A.musd,
    currency1: casaIsCurrency0 ? A.musd : A.casa,
    fee: A.fee,
    tickSpacing: A.tickSpacing,
    hooks: A.mandateHook,
  };
  poolId = poolIdOf(poolKey);
  logCache = { nextBlock: BigInt(A.deployBlock ?? 0), logs: [] };
  startVendor();
}

async function ensureCreate2Deployer() {
  const code = await rpcCall('eth_getCode', [CREATE2_DEPLOYER, 'latest']);
  if (!code || code === '0x') {
    await rpcCall('anvil_setCode', [CREATE2_DEPLOYER, CREATE2_DEPLOYER_CODE]);
  }
}

async function ensureWorld() {
  const up = await rpcUp();
  const chainIdHex = up ? await rpcCall('eth_chainId') : null;
  LOCAL = !up || chainIdHex === '0x7a69'; // 31337 — or we are about to spawn anvil

  if (!up) {
    if (ENV.RPC_URL && !ENV.RPC_URL.includes('127.0.0.1') && !ENV.RPC_URL.includes('localhost')) {
      throw new Error(`RPC ${RPC_URL} is unreachable`);
    }
    console.log('[concierge] starting anvil…');
    const child = spawn('anvil', ['--silent'], { detached: true, stdio: 'ignore' });
    child.unref();
    for (let i = 0; i < 30 && !(await rpcUp()); i++) await new Promise((r) => setTimeout(r, 500));
    if (!(await rpcUp())) throw new Error(`anvil did not come up on ${RPC_URL}`);
  }

  let needDeploy = !existsSync(ADDRESSES_FILE);
  if (!needDeploy) {
    const { treasury } = JSON.parse(readFileSync(ADDRESSES_FILE, 'utf8'));
    const probe = createPublicClient({ chain: foundry, transport: httpTransport(RPC_URL) });
    const code = await probe.getCode({ address: treasury }).catch(() => undefined);
    needDeploy = !code || code === '0x';
  }
  if (needDeploy) {
    if (!LOCAL) {
      throw new Error(
        'concierge world not found on this chain — deploy first:\n' +
          '  cd contracts && forge script script/DeployConciergeDemo.s.sol --rpc-url $RPC_URL --broadcast\n' +
          '(set OPERATOR_PK / ANA_PK / CONCIERGE_PK / PLUMBER_PK / POOL_MANAGER — see env.example)',
      );
    }
    await ensureCreate2Deployer();
    deployWorld();
  }
  loadWorld();
}

await ensureWorld();
console.log(
  `[concierge] world ready — chain ${A.chainId}${LOCAL ? ' (local)' : ''} — treasury ${A.treasury} — decider ${DECIDER_KIND}`,
);

// ---------------------------------------------------------------- chain data (swap for subgraph adapter at the event) ---
//
// Every readContract / getLogs call in this server lives in this section. A
// subgraph adapter would reimplement these bodies (and nothing else): the ops
// and HTTP layers below only ever call the helpers defined here.

async function chainNow() {
  const block = await publicClient.getBlock();
  return Number(block.timestamp);
}

async function refreshLogs() {
  const latest = await publicClient.getBlockNumber({ cacheTime: 0 });
  if (latest >= logCache.nextBlock) {
    const fresh = await publicClient.request({
      method: 'eth_getLogs',
      params: [
        {
          fromBlock: toHex(logCache.nextBlock),
          toBlock: toHex(latest),
          address: A.poolManager,
          topics: [[MODIFY_LIQUIDITY_TOPIC, SWAP_TOPIC]],
        },
      ],
    });
    logCache.logs.push(...fresh);
    logCache.nextBlock = latest + 1n;
  }
  return logCache.logs;
}

const readBalance = (token, wallet) =>
  publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [wallet] });

const readTreasury = (functionName, args = []) =>
  publicClient.readContract({ address: A.treasury, abi: TREASURY_ABI, functionName, args });

const readPerTxCap = () => readTreasury('agentPerTxCap');
const readCasaBudget = () => readBalance(A.casa, actorAddress.concierge);
const readApprovalThreshold = () => readTreasury('APPROVAL_THRESHOLD');

const bytes32ToString = (h) => Buffer.from(h.slice(2), 'hex').toString('utf8').replace(/\0+$/g, '');

async function readStanding(wallet) {
  const [ok, reason] = await readTreasury('isAgentInGoodStanding', [wallet]);
  return { ok, reason: bytes32ToString(reason) || null };
}

async function readPayment(id) {
  const [vendor, amount, evidence, approvals, executed] = await readTreasury('payments', [BigInt(id)]);
  return { id: Number(id), vendor, amount, evidenceHash: evidence, approvals, executed };
}

// Walks the treasury's payment ids — 1..nextPaymentId-1, oldest first.
async function readPayments() {
  const next = await readTreasury('nextPaymentId');
  const ids = [];
  for (let id = 1n; id < next; id++) ids.push(id);
  const rows = await Promise.all(ids.map(readPayment));
  return rows.map((p) => ({
    id: p.id,
    vendor: p.vendor,
    amount: Number(formatEther(p.amount)).toFixed(2),
    evidenceHash: p.evidenceHash,
    approvals: Number(p.approvals),
    executed: p.executed,
  }));
}

async function readHouse() {
  const [treasuryMusd, threshold] = await Promise.all([readBalance(A.musd, A.treasury), readApprovalThreshold()]);
  const { totals } = aggregateLiquidity(await refreshLogs());
  const prices = lastPrices(logCache.logs);
  return {
    treasuryMusd: Number(formatEther(treasuryMusd)).toFixed(2),
    poolLiquidity: Number(formatEther(totals.get(poolId) ?? 0n)).toFixed(0),
    poolPrice: (prices.get(poolId) ?? 1).toFixed(4),
    approvalThreshold: Number(threshold),
  };
}

async function readAgent() {
  const wallet = actorAddress.concierge;
  const [standing, casa, musd, perTxCap] = await Promise.all([
    readStanding(wallet),
    readBalance(A.casa, wallet),
    readBalance(A.musd, wallet),
    readPerTxCap(),
  ]);
  return {
    wallet,
    standing,
    casa: Number(formatEther(casa)).toFixed(2),
    musd: Number(formatEther(musd)).toFixed(2),
    perTxCap: Number(formatEther(perTxCap)).toFixed(2),
  };
}

async function identityOf(wallet) {
  const identity = await publicClient.readContract({
    address: A.identityFactory,
    abi: FACTORY_ABI,
    functionName: 'identityOfWallet',
    args: [wallet],
  });
  return identity === ZERO_ADDRESS ? null : identity;
}

/// The same read the treasury makes on-chain: wallet → identity → gate. A wallet with no
/// identity is never compliant, so the UI agrees with HouseTreasury.isCompliantOwner.
async function isCompliant(wallet) {
  const identity = await identityOf(wallet);
  if (!identity) return false;
  const [ok] = await publicClient.readContract({
    address: A.eligibilityGate,
    abi: GATE_ABI,
    functionName: 'isEligible',
    args: [identity, BigInt(A.policyId)],
  });
  return ok;
}

async function readOwners() {
  return Promise.all(
    OWNERS.map(async (name) => ({
      name,
      wallet: actorAddress[name],
      compliant: await isCompliant(actorAddress[name]),
    })),
  );
}

// ---------------------------------------------------------------- chain ops

let verificationCounter = 0;
let ticketCounter = 0;
let tickets = [];
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// simulate → send → wait. Returns the tx hash plus the simulated return value
// (proposePayment's new id, for instance).
async function send(actor, address, abi, functionName, args) {
  const wallet = wallets[actor];
  const { request, result } = await publicClient.simulateContract({
    address,
    abi,
    functionName,
    args,
    account: wallet.account,
  });
  const hash = await wallet.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash });
  return { hash, result };
}

async function write(actor, address, abi, functionName, args) {
  const { hash } = await send(actor, address, abi, functionName, args);
  return hash;
}

function refusalOf(err) {
  const dec = decodeRefusal(err);
  if (dec) return { reason: dec.reason, wallet: dec.wallet, message: `NotAuthorized(${short(dec.wallet)}, ${dec.reason})` };
  return { reason: 'ERROR', wallet: null, message: String(err?.shortMessage ?? err?.message ?? err).slice(0, 300) };
}

// Rail 2 reverts bare — HouseTreasury.NotAgent() carries no reason code, so
// decodeRefusal returns null. Fall back to the treasury's own standing view so
// the refusal still names *why* the agent lost authority.
async function refusalWithStanding(err) {
  const refusal = refusalOf(err);
  if (decodeRefusal(err)) return refusal;
  const standing = await readStanding(actorAddress.concierge).catch(() => null);
  if (!standing || standing.ok || !standing.reason) return refusal;
  return { ...refusal, reason: standing.reason, wallet: actorAddress.concierge, source: 'treasury' };
}

// Rail 1, step 1: liquify budget. The concierge sells CASA for exactly the
// invoice amount of mUSD through the MandateHook-gated pool — an exact-output
// swap, because an exact-input swap of `amount` CASA nets less than `amount`
// mUSD (0.3% pool fee) and could not settle the invoice. The hook still sees
// |amountSpecified| == the ticket amount for its per-tx cap check.
function swapForInvoice(amountWei) {
  return write('concierge', A.swapRouter, SWAP_ROUTER_ABI, 'swap', [
    poolKey,
    {
      zeroForOne: casaIsCurrency0,
      amountSpecified: amountWei,
      sqrtPriceLimitX96: casaIsCurrency0 ? MIN_SQRT_PRICE_PLUS_1 : MAX_SQRT_PRICE_MINUS_1,
    },
    { takeClaims: false, settleUsingBurn: false },
    encodeAbiParameters([{ type: 'address' }], [actorAddress.concierge]),
  ]);
}

// Rail 1, step 2: settle the vendor's x402 invoice from the agent wallet. The
// vendor names the recipient and the sum in its own 402 body, so `expected`
// hands the client the two facts we know without asking it — the mUSD address
// and the plumber's payout wallet — and the invoice amount is checked against
// the ticket. A vendor that offers anything else gets nothing.
function payInvoice(id, amountWei) {
  return settleInvoice({
    vendorUrl: VENDOR_URL,
    jobId: id,
    amount: amountWei.toString(),
    expected: { asset: A.musd, payTo: actorAddress.plumber },
    payFn: (accept) => write('concierge', A.musd, ERC20_ABI, 'transfer', [accept.payTo, BigInt(accept.amount)]),
  });
}

async function doTicket({ description, amount, category }) {
  const amountWei = parseEther(String(amount));
  const id = ++ticketCounter;
  const vendor = actorAddress.plumber;

  const ticket = { id, description, vendor, amount: amountWei, category };
  // Rail 1 sells CASA for *exactly* the invoice in mUSD, so it spends a little
  // more CASA than the invoice (0.3% pool fee + price impact). Hand the decider
  // a 2% haircut on the raw balance, or a ticket sitting just under the budget
  // decides 'pay' and then reverts on the swap with ERC20InsufficientBalance.
  const casaBalance = await readCasaBudget();
  const context = { perTxCap: await readPerTxCap(), casaBudget: (casaBalance * 98n) / 100n };
  const decision = await decide(ticket, context);
  // The evidence must commit to the *request*, not just the verdict: a hash of
  // the decision alone could be replayed against a different ticket.
  const hash = evidenceHash({ ...decision, ticket: { ...ticket, amount: amountWei.toString() } });

  const record = {
    id,
    description,
    category,
    vendor,
    amount: Number(formatEther(amountWei)).toFixed(2),
    decision,
    evidenceHash: hash,
    txHashes: [],
    refusal: null,
    settleError: null,
    paid: false,
    paymentId: null,
    status: decision.action,
    at: Date.now(),
  };
  tickets.push(record);

  // Rail 1's two legs fail differently, so they do not share a catch: once the
  // swap lands the agent already holds the mUSD, and a settlement failure after
  // that is 'unsettled' (money moved, vendor unpaid) — not 'refused', which
  // means the chain stopped the agent before it spent anything.
  if (decision.action === 'pay') {
    try {
      record.txHashes.push(await swapForInvoice(amountWei));
    } catch (err) {
      record.refusal = await refusalWithStanding(err);
      record.status = 'refused';
      return { ok: true, ticket: record };
    }

    try {
      const settled = await payInvoice(id, amountWei);
      if (settled.txHash) record.txHashes.push(settled.txHash);
      record.paid = settled.paid;
      if (!settled.paid) record.settleError = settled.error ?? 'vendor did not confirm the payment';
    } catch (err) {
      record.settleError = String(err?.shortMessage ?? err?.message ?? err).slice(0, 300);
    }
    record.status = record.paid ? 'paid' : 'unsettled';
    return record.paid ? { ok: true, ticket: record } : { ok: false, status: 'unsettled', ticket: record };
  }

  try {
    if (decision.action === 'propose') {
      const { hash: txHash, result } = await send('concierge', A.treasury, TREASURY_ABI, 'proposePayment', [
        vendor,
        amountWei,
        hash,
      ]);
      record.txHashes.push(txHash);
      record.paymentId = Number(result);
      record.status = 'pending-approval';
    } else {
      record.status = 'rejected';
    }
  } catch (err) {
    record.refusal = await refusalWithStanding(err);
    record.status = 'refused';
  }

  return { ok: true, ticket: record };
}

async function doApprove(owner, id) {
  const txHashes = [await write(owner, A.treasury, TREASURY_ABI, 'approvePayment', [BigInt(id)])];
  const [payment, threshold] = await Promise.all([readPayment(id), readApprovalThreshold()]);

  let executed = payment.executed;
  if (!executed && payment.approvals >= threshold) {
    txHashes.push(await write('operator', A.treasury, TREASURY_ABI, 'executePayment', [BigInt(id)]));
    executed = true;
  }

  const ticket = tickets.find((t) => t.paymentId === Number(id));
  if (ticket) {
    ticket.txHashes.push(...txHashes);
    ticket.status = executed ? 'executed' : 'pending-approval';
    ticket.paid = executed;
  }
  return { ok: true, id: Number(id), approvals: Number(payment.approvals), executed, txHashes };
}

async function doFund(amount) {
  const txHash = await write('operator', A.treasury, TREASURY_ABI, 'fundConcierge', [parseEther(String(amount))]);
  return { ok: true, txHashes: [txHash] };
}

async function doRevokeMandate() {
  return { ok: true, txHashes: [await write('operator', A.treasury, TREASURY_ABI, 'revokeMandate', [])] };
}

async function doGrantMandate() {
  const expiresAt = BigInt((await chainNow()) + MANDATE_DURATION);
  const txHash = await write('operator', A.treasury, TREASURY_ABI, 'grantMandate', [
    actorAddress.concierge,
    MANDATE_CAP,
    expiresAt,
  ]);
  return { ok: true, txHashes: [txHash] };
}

async function setRevoked(identity, topic, value) {
  return write('operator', A.claimIssuer, ISSUER_ABI, 'setRevoked', [identity, topic, value]);
}

/// The issuer signs a claim OFF-CHAIN (EIP-712, no gas). Both keys are local anvil keys,
/// so the demo plays both sides: operator = issuer signer, the owner = holder.
async function signClaim(identity, topic, expiresAt) {
  const dataHash = keccak256(toHex(`demo-attest-${Date.now()}-${verificationCounter++}`));
  const nonce = keccak256(toHex(`demo-session-${Date.now()}-${verificationCounter++}`));
  const signature = await issuerSigner.signTypedData({
    domain: { name: 'PassportKitClaim', version: '1', chainId: A.chainId, verifyingContract: A.claimIssuer },
    types: {
      Claim: [
        { name: 'identity', type: 'address' },
        { name: 'topic', type: 'uint256' },
        { name: 'dataHash', type: 'bytes32' },
        { name: 'expiresAt', type: 'uint64' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'Claim',
    message: { identity, topic, dataHash, expiresAt, nonce },
  });
  return { signature, data: encodeAbiParameters(CLAIM_DATA_ABI, [dataHash, expiresAt, nonce]) };
}

// THE MONEY MOMENT: owner compliance is the agent's root of authority. One latch flip on
// the ClaimIssuer and the treasury — hence both rails — refuses the concierge on the very
// next call. The operator plays the issuer here, exactly as in the ComplianceHook demo.
async function doRevokeOwnerKyc(owner) {
  const identity = await identityOf(actorAddress[owner]);
  if (!identity) return { ok: false, reason: 'NO_IDENTITY', message: `${owner} has no identity yet` };
  return { ok: true, txHashes: [await setRevoked(identity, CLAIM_TOPICS.kyc, true)] };
}

/// Issuer re-approval: re-open the latch. The claim is still stored on the owner's Identity,
/// so they clear the policy again immediately — unless it expired meanwhile (timewarp), in
/// which case the issuer signs a fresh one and the holder submits it (Model B).
async function doRestoreOwnerKyc(owner) {
  const wallet = actorAddress[owner];
  const identity = await identityOf(wallet);
  if (!identity) return { ok: false, reason: 'NO_IDENTITY', message: `${owner} has no identity yet` };

  const txHashes = [await setRevoked(identity, CLAIM_TOPICS.kyc, false)];
  if (!(await isCompliant(wallet))) {
    const expiresAt = BigInt((await chainNow()) + MANDATE_DURATION);
    const { signature, data } = await signClaim(identity, CLAIM_TOPICS.kyc, expiresAt);
    txHashes.push(
      await write(owner, identity, IDENTITY_ABI, 'submitClaim', [CLAIM_TOPICS.kyc, A.claimIssuer, signature, data]),
    );
  }
  return { ok: true, txHashes };
}

async function doTimewarp(days) {
  if (!LOCAL) return { ok: false, reason: 'LOCAL_ONLY', message: 'timewarp only works on local anvil' };
  await rpcCall('evm_increaseTime', [days * 24 * 3600]);
  await rpcCall('evm_mine', []);
  return { ok: true, warpedDays: days };
}

async function doReset() {
  if (!LOCAL) return { ok: false, reason: 'LOCAL_ONLY', message: 'reset only works on local anvil' };
  await rpcCall('anvil_reset', []);
  await ensureCreate2Deployer();
  deployWorld();
  loadWorld();
  tickets = [];
  ticketCounter = 0;
  return { ok: true };
}

// ---------------------------------------------------------------- tx inspector

function friendlyArg(name, value) {
  if (name === 'topic' && CLAIM_TOPIC_NAMES[value]) return CLAIM_TOPIC_NAMES[value];
  if (name === 'purpose' && typeof value === 'bigint') return KEY_PURPOSES[value] ?? value.toString();
  if (typeof value === 'bigint') {
    if (name === 'expiresAt' || name === 'topic' || name === 'fee' || name === 'id' || name === 'approvals') {
      return value.toString();
    }
    const abs = value < 0n ? -value : value;
    if (abs >= 10n ** 12n) return `${Number(formatEther(value)).toFixed(4)}e18`;
    return value.toString();
  }
  return String(value);
}

function contractLabel(address) {
  const a = address.toLowerCase();
  const map = {
    [A.issuerRegistry.toLowerCase()]: 'IssuerRegistry',
    [A.claimIssuer.toLowerCase()]: 'ClaimIssuer',
    [A.identityFactory.toLowerCase()]: 'IdentityFactory',
    [A.eligibilityGate.toLowerCase()]: 'EligibilityGate',
    [A.poolManager.toLowerCase()]: 'PoolManager',
    [A.swapRouter.toLowerCase()]: 'SwapRouter',
    [A.liquidityRouter.toLowerCase()]: 'LiquidityRouter',
    [A.treasury.toLowerCase()]: 'HouseTreasury',
    [A.mandateHook.toLowerCase()]: 'MandateHook',
    [A.musd.toLowerCase()]: 'mUSD',
    [A.casa.toLowerCase()]: 'CASA',
  };
  for (const [name, identity] of Object.entries(A.identities ?? {})) {
    map[identity.toLowerCase()] = `Identity (${name})`;
  }
  return map[a] ?? short(address);
}

// ERC-20 (value in data) and ERC-721 (tokenId indexed) share the Transfer topic;
// try them separately since ABI decoders stop at the first name match
const TRANSFER_VARIANTS = [
  [
    {
      type: 'event',
      name: 'Transfer',
      inputs: [
        { name: 'from', type: 'address', indexed: true },
        { name: 'to', type: 'address', indexed: true },
        { name: 'tokenId', type: 'uint256', indexed: true },
      ],
    },
  ],
  [
    {
      type: 'event',
      name: 'Transfer',
      inputs: [
        { name: 'from', type: 'address', indexed: true },
        { name: 'to', type: 'address', indexed: true },
        { name: 'value', type: 'uint256', indexed: false },
      ],
    },
  ],
];

async function inspectTx(hash) {
  const { decodeEventLog } = await import('viem');
  const [receipt, tx] = await Promise.all([
    publicClient.getTransactionReceipt({ hash }),
    publicClient.getTransaction({ hash }),
  ]);
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  const logs = receipt.logs.map((log) => {
    for (const abi of [INSPECTOR_EVENTS, ...TRANSFER_VARIANTS]) {
      try {
        const dec = decodeEventLog({ abi, data: log.data, topics: log.topics });
        return {
          contract: contractLabel(log.address),
          name: dec.eventName,
          args: Object.fromEntries(Object.entries(dec.args).map(([k, v]) => [k, friendlyArg(k, v)])),
        };
      } catch {}
    }
    return { contract: contractLabel(log.address), name: 'unknown', topic: log.topics[0]?.slice(0, 10) };
  });
  return {
    ok: true,
    hash,
    status: receipt.status,
    blockNumber: receipt.blockNumber.toString(),
    timestamp: Number(block.timestamp),
    from: tx.from,
    to: tx.to,
    contract: tx.to ? contractLabel(tx.to) : null,
    gasUsed: receipt.gasUsed.toString(),
    logs,
  };
}

// ---------------------------------------------------------------- http

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function failure(err) {
  const { reason, wallet, message } = refusalOf(err);
  return { ok: false, reason, wallet, message };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(readFileSync(path.join(__dirname, 'index.html')));
    } else if (req.method === 'GET' && url.pathname === '/api/state') {
      const now = await chainNow();
      const [house, agent, owners, payments] = await Promise.all([
        readHouse(),
        readAgent(),
        readOwners(),
        readPayments(),
      ]);
      json(res, 200, {
        house,
        agent,
        owners,
        tickets: [...tickets].reverse(), // newest first
        payments,
        decider: DECIDER_KIND,
        now,
        warped: LOCAL && Math.abs(now * 1000 - Date.now()) > 86_400_000,
        local: LOCAL,
        explorer: EXPLORER_URL,
        chainId: A.chainId,
        contracts: {
          issuerRegistry: A.issuerRegistry,
          claimIssuer: A.claimIssuer,
          identityFactory: A.identityFactory,
          eligibilityGate: A.eligibilityGate,
          poolManager: A.poolManager,
          treasury: A.treasury,
          mandateHook: A.mandateHook,
          casa: A.casa,
          musd: A.musd,
        },
      });
    } else if (req.method === 'GET' && url.pathname.startsWith('/api/tx/')) {
      const hash = url.pathname.slice('/api/tx/'.length);
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return json(res, 400, { ok: false, message: 'bad tx hash' });
      json(res, 200, await inspectTx(hash).catch(failure));
    } else if (req.method === 'POST' && url.pathname === '/api/ticket') {
      const { description = 'house ticket', amount = '0', category = 'plumbing' } = await readBody(req);
      if (!/^\d+(\.\d+)?$/.test(String(amount))) return json(res, 400, { ok: false, message: 'bad amount' });
      json(res, 200, await doTicket({ description, amount, category }).catch(failure));
    } else if (req.method === 'POST' && url.pathname === '/api/approve') {
      const { owner, id } = await readBody(req);
      if (!OWNERS.includes(owner)) return json(res, 400, { ok: false, message: 'unknown owner' });
      if (!Number.isInteger(Number(id)) || Number(id) < 1) return json(res, 400, { ok: false, message: 'bad payment id' });
      json(res, 200, await doApprove(owner, Number(id)).catch(failure));
    } else if (req.method === 'POST' && url.pathname === '/api/fund') {
      const { amount = '500' } = await readBody(req);
      json(res, 200, await doFund(amount).catch(failure));
    } else if (req.method === 'POST' && url.pathname === '/api/revoke-mandate') {
      json(res, 200, await doRevokeMandate().catch(failure));
    } else if (req.method === 'POST' && url.pathname === '/api/grant-mandate') {
      json(res, 200, await doGrantMandate().catch(failure));
    } else if (req.method === 'POST' && url.pathname === '/api/revoke-owner-kyc') {
      const { owner } = await readBody(req);
      if (!OWNERS.includes(owner)) return json(res, 400, { ok: false, message: 'unknown owner' });
      json(res, 200, await doRevokeOwnerKyc(owner).catch(failure));
    } else if (req.method === 'POST' && url.pathname === '/api/restore-owner-kyc') {
      const { owner } = await readBody(req);
      if (!OWNERS.includes(owner)) return json(res, 400, { ok: false, message: 'unknown owner' });
      json(res, 200, await doRestoreOwnerKyc(owner).catch(failure));
    } else if (req.method === 'POST' && url.pathname === '/api/timewarp') {
      const { days = 366 } = await readBody(req);
      json(res, 200, await doTimewarp(Number(days)).catch(failure));
    } else if (req.method === 'POST' && url.pathname === '/api/reset') {
      json(res, 200, await doReset().catch(failure));
    } else {
      json(res, 404, { ok: false, message: 'not found' });
    }
  } catch (err) {
    json(res, 500, failure(err));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[concierge] House Concierge demo on http://${HOST}:${PORT}`);
  console.log(`[concierge] mock plumber (x402) on ${VENDOR_URL}`);
});
