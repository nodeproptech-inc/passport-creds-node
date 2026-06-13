import { apiFetch } from '@/lib/api';
import type {
  PassportState,
  ClaimType,
  StartVerificationResult,
} from './passport.types';

export async function getPassportState(walletAddress: string): Promise<PassportState> {
  return apiFetch<PassportState>(`/passport/${walletAddress}`);
}

export async function startVerification(input: {
  walletAddress: string;
  claimType: ClaimType;
}): Promise<StartVerificationResult> {
  return apiFetch<StartVerificationResult>('/verification/start', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function syncVerificationOnchain(
  verificationId: string
): Promise<{ success: boolean; transactionHash?: string }> {
  return apiFetch(`/verification/${verificationId}/sync-onchain`, {
    method: 'POST',
  });
}

export async function injectMockAiResult(
  verificationId: string,
  scenario: 1 | 2 | 3 | 4
): Promise<{ triggered: boolean }> {
  return apiFetch(`/verification/${verificationId}/mock-ai-result`, {
    method: 'POST',
    body: JSON.stringify({ scenario }),
  });
}

export async function submitDocument(input: {
  walletAddress: string;
  claimType: ClaimType;
  documentBase64: string;
  documentName: string;
  documentContentType?: string;
}): Promise<{ verificationId: string; inferenceId: string; claimType: string; status: string }> {
  return apiFetch('/verification/submit-document', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
