import { BACKEND_BASE_URL } from './config.js';
import type { CREVerificationResult } from './types.js';

export async function fetchVerificationResult(
  verificationId: string
): Promise<CREVerificationResult> {
  const url = `${BACKEND_BASE_URL}/cre/verification-result/${verificationId}`;
  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(
      `Failed to fetch verification result for ${verificationId}: ${res.status} ${text}`
    );
  }

  return res.json() as Promise<CREVerificationResult>;
}
