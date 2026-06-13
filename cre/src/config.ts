export const BACKEND_BASE_URL =
  process.env['BACKEND_BASE_URL'] ?? 'http://localhost:3001';

export const CRE_WORKFLOW_CALLBACK_URL =
  process.env['CRE_WORKFLOW_CALLBACK_URL'] ?? `${BACKEND_BASE_URL}/cre/workflow-result`;

export const CLAIM_REGISTRY_ADDRESS = (process.env['CLAIM_REGISTRY_ADDRESS'] ??
  '0x5FbDB2315678afecb367f032d93F642f64180aa3') as `0x${string}`;

export const COMPLIANCE_PASSPORT_ADDRESS = (process.env['COMPLIANCE_PASSPORT_ADDRESS'] ??
  '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512') as `0x${string}`;

export const ACCESS_GATE_ADDRESS = (process.env['ACCESS_GATE_ADDRESS'] ??
  '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0') as `0x${string}`;

export const PRIVATE_KEY = (process.env['PRIVATE_KEY'] ??
  // Anvil account #1 — CRE_UPDATER wallet (never use in production)
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d') as `0x${string}`;

export const RPC_URL = process.env['RPC_URL'] ?? 'http://127.0.0.1:8545';

export const CHAIN_ID = Number(process.env['CHAIN_ID'] ?? '31337');

export const DEMO_MODE = process.env['DEMO_MODE'] !== 'false';
