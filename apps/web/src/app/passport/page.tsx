'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PrivyLoginButton } from '@/components/wallet/PrivyLoginButton';
import { ConnectWalletButton } from '@/components/wallet/ConnectWalletButton';
import { ComplianceProgressStepper } from '@/components/passport/ComplianceProgressStepper';
import { PassportCard } from '@/components/passport/PassportCard';
import { AccessDecisionBanner } from '@/components/passport/AccessDecisionBanner';
import { TransactionTimeline } from '@/components/passport/TransactionTimeline';
import { WorldIdPersonhoodCard } from '@/components/passport/WorldIdPersonhoodCard';
import { createIdentity, getEligibility, type EligibilityState } from '@/modules/passport/world-id.service';
import type { ClaimStatus, PassportStatus, TransactionItem } from '@/modules/passport/passport.types';
import { PRODUCT_NAME } from '@/modules/passport/passport.constants';

const HAS_PRIVY = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export default function PassportPage() {
  const router = useRouter();
  const [wallet, setWallet] = useState<string | null>(null);
  const [provider, setProvider] = useState<'privy' | 'metamask'>('metamask');
  const [state, setState] = useState<EligibilityState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [personhoodVerified, setPersonhoodVerified] = useState(false);

  const refresh = useCallback(async (address: string, ensureIdentity = false) => {
    try {
      let next = await getEligibility(address);
      if (ensureIdentity && !next.identity) {
        await createIdentity(address);
        next = await getEligibility(address);
      }
      setState(next); setError(null);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load eligibility state.');
      return null;
    }
  }, []);

  const onWalletReady = useCallback(async (address: string, nextProvider: 'privy' | 'metamask') => {
    setWallet(address); setProvider(nextProvider); setPersonhoodVerified(false); setLoading(true);
    await refresh(address, true); setLoading(false);
  }, [refresh]);

  const handleMetaMaskWalletReady = useCallback(
    (address: string) => onWalletReady(address, 'metamask'),
    [onWalletReady],
  );
  const handlePrivyWalletReady = useCallback(
    (address: string) => onWalletReady(address, 'privy'),
    [onWalletReady],
  );

  const disconnect = () => { setWallet(null); setState(null); setError(null); setTransactions([]); setPersonhoodVerified(false); router.push('/'); };
  const personhoodStatus: ClaimStatus = personhoodVerified || state?.personhood.status === 'VERIFIED' ? 'VERIFIED' : 'UNVERIFIED';
  const passportStatus: PassportStatus = state?.personhood.status === 'VERIFIED' ? 'LIMITED' : 'NONE';

  return <div className="min-h-screen bg-[#F0F2F6]">
    <header className="bg-white border-b border-[#DDE1EA]"><div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
      <Link href="/" className="font-bold text-[#0D1428] text-sm">{PRODUCT_NAME}</Link>
      {HAS_PRIVY ? <PrivyLoginButton onWalletReady={handlePrivyWalletReady} onDisconnect={disconnect} address={provider === 'privy' ? wallet : null} /> : <ConnectWalletButton onConnect={handleMetaMaskWalletReady} onDisconnect={disconnect} address={wallet} />}
    </div></header>
    <main className="max-w-6xl mx-auto px-6 py-8">
      <p className="text-[11px] font-semibold tracking-widest uppercase text-[#4A9EFF] mb-1">Compliance Flow</p>
      <h1 className="text-2xl font-bold text-[#0D1428] mb-6">Your Compliance Passport</h1>
      {!wallet && <div className="bg-white border border-[#DDE1EA] rounded-2xl p-10 text-center"><p className="text-lg font-bold">Connect a wallet to start</p><p className="text-sm text-[#4B5568] mt-2">Verify personhood with World ID and submit your own claim.</p></div>}
      {loading && <p className="py-10 text-center text-sm text-[#4B5568]">Preparing your identity…</p>}
      {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600 mb-4">{error} {wallet && <button className="underline" onClick={() => refresh(wallet, true)}>Retry</button>}</div>}
      {wallet && state && !loading && <>
        <div className="mb-6"><ComplianceProgressStepper walletConnected passportStatus={passportStatus} kycStatus={personhoodStatus} personhood /></div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <WorldIdPersonhoodCard wallet={wallet} identity={state.identity} status={personhoodStatus} mode={state.mode} onComplete={async (message, transactionHash) => { setPersonhoodVerified(true); if (transactionHash) setTransactions((items) => [...items, { id: transactionHash, contractName: 'CompliancePassport', action: 'PROOF_OF_PERSONHOOD submitted by wallet', transactionHash, status: 'PENDING', createdAt: new Date().toISOString() }]); await refresh(wallet); }} />
          <PassportCard walletAddress={wallet} status={passportStatus} badges={[]} />
          <AccessDecisionBanner passportStatus={passportStatus} canAccessDealRoom={state.dealRoom.eligible} />
        </div>
        <div className="flex justify-end mb-3"><button className="text-xs border border-[#DDE1EA] px-3 py-1.5 rounded-lg" onClick={() => refresh(wallet)}>Refresh eligibility</button></div>
        <TransactionTimeline transactions={transactions} />
      </>}
    </main>
  </div>;
}
