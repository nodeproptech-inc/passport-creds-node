const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export type WalletPolicy = {
  policyStatus: 'NO_KYC_DAILY_50' | 'KYC_USER_CONFIGURABLE' | 'BLOCKED';
  dailyLimitUsd: number;
  limitToken: string;
  canModifyLimit: boolean;
};

export type SetupPrivyWalletResult = {
  walletAddress: string;
  privyUserId: string | null;
  walletProvider: string;
  passportStatus: string;
  policy: WalletPolicy;
};

export type TransferIntentResult = {
  allowed: boolean;
  reason: string;
  policyStatus: string;
  dailyLimitUsd: number;
};

export async function setupPrivyWallet(
  privyUserId: string,
  walletAddress: string,
): Promise<SetupPrivyWalletResult> {
  const res = await fetch(`${API_URL}/wallets/privy/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ privyUserId, walletAddress }),
  });
  if (!res.ok) throw new Error(`Privy wallet setup failed: ${res.status}`);
  return res.json();
}

export async function getWalletPolicy(walletAddress: string): Promise<WalletPolicy> {
  const res = await fetch(`${API_URL}/wallets/${walletAddress}/policy`);
  if (!res.ok) throw new Error(`Failed to load wallet policy: ${res.status}`);
  return res.json();
}

export async function updateTransferLimit(
  walletAddress: string,
  dailyLimitUsd: number,
): Promise<{ policyStatus: string; dailyLimitUsd: number }> {
  const res = await fetch(`${API_URL}/wallets/${walletAddress}/policy/transfer-limit`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dailyLimitUsd }),
  });
  if (!res.ok) throw new Error(`Failed to update transfer limit: ${res.status}`);
  return res.json();
}

export async function checkTransferIntent(
  walletAddress: string,
  amountUsd: number,
): Promise<TransferIntentResult> {
  const res = await fetch(`${API_URL}/wallets/${walletAddress}/transfer-intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amountUsd }),
  });
  if (!res.ok) throw new Error(`Transfer intent check failed: ${res.status}`);
  return res.json();
}
