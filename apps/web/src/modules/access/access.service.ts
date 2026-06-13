import { apiFetch } from '@/lib/api';
import type { AccessResult } from './access.types';
import { RESOURCE_ID } from '@/modules/passport/passport.constants';

export async function checkAccess(walletAddress: string): Promise<AccessResult> {
  return apiFetch<AccessResult>(
    `/access/check?walletAddress=${encodeURIComponent(walletAddress)}&resourceId=${RESOURCE_ID}`
  );
}
