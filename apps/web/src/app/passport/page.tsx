'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PrivyLoginButton } from '@/components/wallet/PrivyLoginButton';
import { ConnectWalletButton } from '@/components/wallet/ConnectWalletButton';
import { ComplianceProgressStepper } from '@/components/passport/ComplianceProgressStepper';
import { EvidenceCard } from '@/components/passport/EvidenceCard';
import { PassportCard } from '@/components/passport/PassportCard';
import { CompliancePassportNFTCard } from '@/components/passport/CompliancePassportNFTCard';
import { PassportWalletCard } from '@/components/passport/PassportWalletCard';
import { TransactionTimeline } from '@/components/passport/TransactionTimeline';
import { AccessDecisionBanner } from '@/components/passport/AccessDecisionBanner';
import { TransferPolicyBanner } from '@/components/wallet/TransferPolicyBanner';
import { TransferLimitForm } from '@/components/wallet/TransferLimitForm';
import {
  getPassportState,
  startVerification,
  injectMockAiResult,
  syncVerificationOnchain,
  submitDocument,
} from '@/modules/passport/passport.service';
import { getWalletPolicy, updateTransferLimit } from '@/modules/wallet/wallet.service';
import type { WalletPolicy } from '@/modules/wallet/wallet.service';
import type { PassportState, ClaimType } from '@/modules/passport/passport.types';
import { PRODUCT_NAME } from '@/modules/passport/passport.constants';

const HAS_PRIVY = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const POLL_INTERVAL_ACTIVE_MS = 3000;
const POLL_INTERVAL_IDLE_MS = 5000;
const ACTIVE_STATUSES = new Set(['PENDING', 'PROCESSING']);

function isActive(state: PassportState | null): boolean {
  if (!state) return false;
  return state.status === 'IN_PROGRESS' || state.claims.some((c) => ACTIVE_STATUSES.has(c.status));
}

export default function PassportPage() {
  const router = useRouter();
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletProvider, setWalletProvider] = useState<'privy' | 'metamask'>('privy');
  const [passport, setPassport] = useState<PassportState | null>(null);
  const [walletPolicy, setWalletPolicy] = useState<WalletPolicy | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startingClaim, setStartingClaim] = useState<ClaimType | null>(null);
  const [simulatingClaim, setSimulatingClaim] = useState<ClaimType | null>(null);
  const [submittingClaim, setSubmittingClaim] = useState<ClaimType | null>(null);
  const [activeVerificationIds, setActiveVerificationIds] = useState<Partial<Record<ClaimType, string>>>({});
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPassport = useCallback(async (addr: string) => {
    try {
      const state = await getPassportState(addr);
      setPassport(state);
      setError(null);
      return state;
    } catch {
      setError('Failed to load passport state.');
      return null;
    }
  }, []);

  const fetchPolicy = useCallback(async (addr: string) => {
    try {
      const policy = await getWalletPolicy(addr);
      setWalletPolicy(policy);
    } catch {
      // Policy not critical — silently skip
    }
  }, []);

  const handleWalletReady = useCallback(
    async (address: string, provider: 'privy' | 'metamask' = 'privy') => {
      setWalletAddress(address);
      setWalletProvider(provider);
      setLoading(true);
      await Promise.all([fetchPassport(address), fetchPolicy(address)]);
      setLoading(false);
    },
    [fetchPassport, fetchPolicy],
  );

  // Stable callbacks for each provider — avoids re-creating inline arrows in JSX
  const handlePrivyWalletReady = useCallback(
    (addr: string) => handleWalletReady(addr, 'privy'),
    [handleWalletReady],
  );
  const handleMetaMaskWalletReady = useCallback(
    (addr: string) => handleWalletReady(addr, 'metamask'),
    [handleWalletReady],
  );

  function handleDisconnect() {
    setWalletAddress(null);
    setPassport(null);
    setWalletPolicy(null);
    setError(null);
    setActiveVerificationIds({});
    router.push('/');
  }

  useEffect(() => {
    if (!walletAddress) {
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
      return;
    }
    const interval = isActive(passport) ? POLL_INTERVAL_ACTIVE_MS : POLL_INTERVAL_IDLE_MS;
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(() => { fetchPassport(walletAddress); }, interval);
    return () => { if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; } };
  }, [walletAddress, passport, fetchPassport]);

  async function handleStartVerification(claimType: ClaimType) {
    if (!walletAddress) return;
    setStartingClaim(claimType);
    try {
      const result = await startVerification({ walletAddress, claimType });
      setActiveVerificationIds((prev) => ({ ...prev, [claimType]: result.verificationId }));
      await fetchPassport(walletAddress);
    } catch {
      setError(`Failed to start ${claimType} verification.`);
    } finally {
      setStartingClaim(null);
    }
  }

  async function handleSimulate(claimType: ClaimType) {
    if (!walletAddress) return;
    setSimulatingClaim(claimType);
    try {
      let verificationId = activeVerificationIds[claimType];
      if (!verificationId) {
        const result = await startVerification({ walletAddress, claimType });
        verificationId = result.verificationId;
        setActiveVerificationIds((prev) => ({ ...prev, [claimType]: verificationId! }));
      }
      const scenario = claimType === 'KYC_AML_VERIFIED' ? 1 : 3;
      await injectMockAiResult(verificationId, scenario as 1 | 3);
      await fetchPassport(walletAddress);
      await fetchPolicy(walletAddress);
    } catch {
      setError(`Failed to simulate ${claimType}.`);
    } finally {
      setSimulatingClaim(null);
    }
  }

  async function handleSubmitDocument(claimType: ClaimType, file: File) {
    if (!walletAddress) return;
    setSubmittingClaim(claimType);
    try {
      const documentBase64 = await fileToBase64(file);
      const result = await submitDocument({
        walletAddress,
        claimType,
        documentBase64,
        documentName: file.name,
        documentContentType: file.type || 'text/plain',
      });
      setActiveVerificationIds((prev) => ({ ...prev, [claimType]: result.verificationId }));
      await fetchPassport(walletAddress);
    } catch {
      setError(`Failed to submit document for ${claimType}. Check that ngrok is running and NGROK_PUBLIC_URL is set.`);
    } finally {
      setSubmittingClaim(null);
    }
  }

  async function handleSyncOnchain(claimType: ClaimType) {
    const verificationId = activeVerificationIds[claimType];
    if (!verificationId || !walletAddress) return;
    try {
      await syncVerificationOnchain(verificationId);
      await fetchPassport(walletAddress);
    } catch {
      setError('Sync onchain failed.');
    }
  }

  async function handleUpdateTransferLimit(newLimit: number) {
    if (!walletAddress) return;
    await updateTransferLimit(walletAddress, newLimit);
    await fetchPolicy(walletAddress);
  }

  const kycClaim = passport?.claims.find((c) => c.claimType === 'KYC_AML_VERIFIED');
  const accreditedClaim = passport?.claims.find((c) => c.claimType === 'ACCREDITED_INVESTOR');

  return (
    <div className="min-h-screen bg-[#F0F2F6]">
      {/* Header */}
      <header className="bg-white border-b border-[#DDE1EA]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#4A9EFF] to-[#3DDBD9] flex items-center justify-center">
              <span className="text-white text-xs font-bold">PC</span>
            </div>
            <span className="font-bold text-[#0D1428] text-sm">{PRODUCT_NAME}</span>
          </Link>
          <div className="flex items-center gap-2">
            {HAS_PRIVY ? (
              <PrivyLoginButton
                onWalletReady={handlePrivyWalletReady}
                onDisconnect={handleDisconnect}
                address={walletProvider === 'privy' ? walletAddress : null}
              />
            ) : (
              <ConnectWalletButton
                onConnect={handleMetaMaskWalletReady}
                onDisconnect={handleDisconnect}
                address={walletAddress}
              />
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Page title */}
        <div className="mb-6">
          <p className="text-[11px] font-semibold tracking-widest uppercase text-[#4A9EFF] mb-1">
            Compliance Flow
          </p>
          <h1 className="text-2xl font-bold text-[#0D1428]">
            Your{' '}
            <span className="bg-gradient-to-r from-[#4A9EFF] to-[#3DDBD9] bg-clip-text text-transparent">
              Compliance Passport
            </span>
          </h1>
          <p className="text-sm text-[#4B5568] mt-1">
            Login and complete compliance verification to unlock the Node PropTech Deal Room.
          </p>
        </div>

        {!walletAddress && (
          <div className="bg-white border border-[#DDE1EA] rounded-2xl p-10 text-center shadow-sm mb-6">
            <p className="text-4xl mb-4">🔗</p>
            <h2 className="text-lg font-bold text-[#0D1428] mb-2">Login to Continue</h2>
            <p className="text-sm text-[#4B5568] mb-6">
              {HAS_PRIVY
                ? 'Login with email or Google to create your embedded wallet — no MetaMask required.'
                : 'Connect MetaMask to view your Compliance Passport.'}
            </p>
            <div className="flex justify-center gap-3 flex-wrap">
              {HAS_PRIVY ? (
                <PrivyLoginButton
                  onWalletReady={handlePrivyWalletReady}
                  onDisconnect={handleDisconnect}
                  address={null}
                />
              ) : (
                <ConnectWalletButton onConnect={handleMetaMaskWalletReady} address={null} />
              )}
            </div>
          </div>
        )}

        {loading && (
          <div className="text-center py-12 text-[#4B5568] text-sm">Loading passport...</div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600 mb-4">
            {error}{' '}
            <button onClick={() => walletAddress && fetchPassport(walletAddress)} className="underline ml-1">
              Retry
            </button>
          </div>
        )}

        {walletAddress && passport && !loading && (
          <>
            {/* Progress stepper */}
            <div className="mb-6">
              <ComplianceProgressStepper
                walletConnected={!!walletAddress}
                passportStatus={passport.status}
                kycStatus={kycClaim?.status}
                accreditedStatus={accreditedClaim?.status}
              />
            </div>

            {/* Three-column layout: evidence | passport | wallet */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
              {/* Left: Evidence cards */}
              <div className="lg:col-span-1 space-y-4">
                <EvidenceCard
                  title="KYC / AML Evidence"
                  description="Upload your KYC / AML document. Chainlink Confidential AI Attester will evaluate it in a TEE and the result will be written onchain through Chainlink CRE."
                  claimType="KYC_AML_VERIFIED"
                  status={kycClaim?.status ?? 'UNVERIFIED'}
                  summary={kycClaim?.summary ?? undefined}
                  confidence={kycClaim?.confidence ?? undefined}
                  transactionHash={kycClaim?.transactionHash ?? undefined}
                  sampleUrl="/samples/kyc-aml-sample.txt"
                  verificationId={activeVerificationIds['KYC_AML_VERIFIED']}
                  onSubmitDocument={(file) => handleSubmitDocument('KYC_AML_VERIFIED', file)}
                  onSimulate={() => handleSimulate('KYC_AML_VERIFIED')}
                  onSyncOnchain={() => handleSyncOnchain('KYC_AML_VERIFIED')}
                  isStarting={startingClaim === 'KYC_AML_VERIFIED'}
                  isSubmitting={submittingClaim === 'KYC_AML_VERIFIED'}
                  isSimulating={simulatingClaim === 'KYC_AML_VERIFIED'}
                />

                <EvidenceCard
                  title="Accredited Investor Evidence"
                  description="Upload your Accredited Investor documentation. For demo purposes, Chainlink Confidential AI Attester classifies the evidence — this does not constitute legal verification. In production, accreditation must be confirmed through approved partners and counsel."
                  claimType="ACCREDITED_INVESTOR"
                  status={accreditedClaim?.status ?? 'UNVERIFIED'}
                  summary={accreditedClaim?.summary ?? undefined}
                  confidence={accreditedClaim?.confidence ?? undefined}
                  transactionHash={accreditedClaim?.transactionHash ?? undefined}
                  sampleUrl="/samples/accredited-investor-sample.txt"
                  verificationId={activeVerificationIds['ACCREDITED_INVESTOR']}
                  onSubmitDocument={(file) => handleSubmitDocument('ACCREDITED_INVESTOR', file)}
                  onSimulate={() => handleSimulate('ACCREDITED_INVESTOR')}
                  onSyncOnchain={() => handleSyncOnchain('ACCREDITED_INVESTOR')}
                  isStarting={startingClaim === 'ACCREDITED_INVESTOR'}
                  isSubmitting={submittingClaim === 'ACCREDITED_INVESTOR'}
                  isSimulating={simulatingClaim === 'ACCREDITED_INVESTOR'}
                />

                {/* Access decision */}
                <AccessDecisionBanner
                  passportStatus={passport.status}
                  canAccessDealRoom={passport.canAccessDealRoom}
                />
              </div>

              {/* Center: Passport SBT card */}
              <div className="lg:col-span-1 space-y-4">
                <CompliancePassportNFTCard
                  passportStatus={passport.status}
                  passportTokenId={passport.passportTokenId}
                  passportTxHash={passport.passportTxHash}
                  badges={passport.badges}
                  walletAddress={walletAddress}
                />
              </div>

              {/* Right: Wallet info + Transfer policy */}
              <div className="lg:col-span-1 space-y-4">
                <PassportWalletCard
                  walletAddress={walletAddress}
                  walletProvider={walletProvider}
                  passportStatus={passport.status}
                  policy={walletPolicy}
                />

                {walletPolicy && (
                  <div className="space-y-4">
                    <TransferPolicyBanner
                      policyStatus={walletPolicy.policyStatus}
                      dailyLimitUsd={walletPolicy.dailyLimitUsd}
                    />
                    {walletPolicy.canModifyLimit && (
                      <div className="bg-white border border-[#DDE1EA] rounded-2xl p-5 shadow-sm">
                        <p className="text-[11px] font-semibold tracking-widest uppercase text-[#9CA3AF] mb-3">
                          Daily Transfer Limit
                        </p>
                        <TransferLimitForm
                          currentLimit={walletPolicy.dailyLimitUsd}
                          onSave={handleUpdateTransferLimit}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Demo fallback controls */}
                <div className="bg-[#F8F9FC] border border-dashed border-[#DDE1EA] rounded-2xl p-4">
                  <p className="text-[10px] font-semibold tracking-widest uppercase text-[#9CA3AF] mb-3">
                    Demo Fallback Controls
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => handleSimulate('KYC_AML_VERIFIED')}
                      disabled={!!simulatingClaim}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-dashed border-[#4A9EFF] text-[#4A9EFF] hover:bg-blue-50 transition-colors disabled:opacity-50"
                    >
                      ⚡ Simulate KYC/AML Verified
                    </button>
                    <button
                      onClick={() => handleSimulate('ACCREDITED_INVESTOR')}
                      disabled={!!simulatingClaim}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-dashed border-[#3DDBD9] text-[#3DDBD9] hover:bg-teal-50 transition-colors disabled:opacity-50"
                    >
                      ⚡ Simulate Accredited Investor
                    </button>
                    <button
                      onClick={() => { fetchPassport(walletAddress); fetchPolicy(walletAddress); }}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#DDE1EA] text-[#9CA3AF] hover:border-[#4A9EFF] hover:text-[#4A9EFF] transition-colors"
                    >
                      ↻ Refresh
                    </button>
                  </div>
                  <p className="text-[10px] text-[#9CA3AF] mt-2">
                    Demo only — bypasses real AI Attester flow
                  </p>
                </div>
              </div>
            </div>

            {/* Transaction timeline */}
            <TransactionTimeline transactions={passport.transactions} />
          </>
        )}
      </main>
    </div>
  );
}
