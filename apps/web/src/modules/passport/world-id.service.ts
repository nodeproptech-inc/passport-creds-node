import { apiFetch } from '@/lib/api';

export type EligibilityState = {
  wallet: string;
  identity: string | null;
  dealRoom: { eligible: boolean; reason: string };
  investor: { eligible: boolean; reason: string };
  personhood: { status: 'UNVERIFIED' | 'VERIFIED'; mode: 'mock' | 'onchain' };
  mode: 'mock' | 'onchain';
};

export type WorldRequest = {
  app_id: `app_${string}`;
  action: string;
  environment: 'staging';
  rp_context: { rp_id: string; nonce: string; created_at: number; expires_at: number; signature: string };
};

export type PreparedClaim = {
  mode: 'onchain';
  verified: true;
  claim: { topic: string; issuer: `0x${string}`; signature: `0x${string}`; data: `0x${string}` };
};

export async function getEligibility(wallet: string) {
  return apiFetch<EligibilityState>(`/eligibility/${wallet}`);
}

export async function createIdentity(wallet: string) {
  return apiFetch<{ identity: string; created: boolean; transactionHash: string | null }>('/identity/create', {
    method: 'POST', body: JSON.stringify({ wallet }),
  });
}

export async function requestWorldId() {
  return apiFetch<WorldRequest>('/world-id/request', { method: 'POST' });
}

export async function verifyWorldId(wallet: string, identity: string, idkitResponse: Record<string, unknown>) {
  return apiFetch<PreparedClaim | { mode: 'mock'; verified: true; message: string }>('/world-id/verify', {
    method: 'POST', body: JSON.stringify({ wallet, identity, idkitResponse }),
  });
}
