import { fetchVerificationResult } from './backend-client.js';
import { validateVerificationResult } from './validation.js';
import { claimTypeToBytes32, hashVerificationId, hashAttestationString } from './claims.js';
import { submitClaim, syncPassport, getAccessSummary } from './contracts-client.js';
import { sendWorkflowResultToBackend } from './workflow-result-client.js';
import { DEMO_MODE } from './config.js';
import type { CREWorkflowResult } from './types.js';

export async function runPassportCredsWorkflow(input: {
  verificationId: string;
}): Promise<CREWorkflowResult> {
  const { verificationId } = input;

  if (!verificationId) {
    throw new Error('Missing verificationId');
  }

  console.log(`[CRE] Starting workflow for verificationId: ${verificationId}`);
  console.log(`[CRE] DEMO_MODE: ${DEMO_MODE}`);

  // 1. Fetch sanitized verification result from backend
  console.log('[CRE] Fetching sanitized result from backend...');
  const result = await fetchVerificationResult(verificationId);
  console.log(`[CRE] Fetched: claimType=${result.claimType}, approved=${result.approved}`);

  // 2. Validate payload — do not write onchain if invalid
  console.log('[CRE] Validating payload...');
  validateVerificationResult(result);
  console.log('[CRE] Validation passed.');

  // 3. Normalize claim type → bytes32
  const claimTypeBytes32 = claimTypeToBytes32(result.claimType);
  const verificationIdHash = hashVerificationId(result.verificationId);
  const attestationHashBytes32 = hashAttestationString(result.attestationHash);
  const walletAddress = result.walletAddress as `0x${string}`;

  // 4. ClaimRegistry.submitClaim
  console.log('[CRE] Calling ClaimRegistry.submitClaim...');
  const claimTx = await submitClaim({
    walletAddress,
    claimTypeBytes32,
    approved: result.approved,
    verificationIdHash,
    attestationHashBytes32,
    expiresAt: result.expiresAt,
  });
  console.log(`[CRE] ClaimRegistry tx: ${claimTx.transactionHash}`);

  // 5. CompliancePassport.syncPassport
  console.log('[CRE] Calling CompliancePassport.syncPassport...');
  const passportTx = await syncPassport(walletAddress);
  console.log(`[CRE] Passport tx: ${passportTx.transactionHash}, status: ${passportTx.passportStatus}`);

  // 6. (Optional) AccessGate.getAccessSummary
  console.log('[CRE] Reading AccessGate.getAccessSummary...');
  const accessSummary = await getAccessSummary(walletAddress);
  console.log('[CRE] Access:', JSON.stringify(accessSummary));

  // 7. Build result
  const workflowResult: CREWorkflowResult = {
    success: true,
    verificationId: result.verificationId,
    walletAddress: result.walletAddress,
    claimType: result.claimType,
    approved: result.approved,
    claimRegistryTxHash: claimTx.transactionHash,
    passportTxHash: passportTx.transactionHash,
    passportStatus: passportTx.passportStatus,
    accessSummary: {
      canAccessDealRoom: accessSummary.canAccessDealRoom,
      canAccessInvestorArea: accessSummary.canAccessInvestorArea,
      canInvest: accessSummary.canInvest,
    },
  };

  // 8. Send result back to backend
  console.log('[CRE] Sending workflow result to backend...');
  await sendWorkflowResultToBackend(workflowResult);
  console.log('[CRE] Workflow complete.');

  return workflowResult;
}
