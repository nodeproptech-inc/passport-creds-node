'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ConnectWalletButton } from '@/components/wallet/ConnectWalletButton';
import { PrivyLoginButton } from '@/components/wallet/PrivyLoginButton';
import { DealRoomLocked } from '@/components/deal-room/DealRoomLocked';
import { DealRoomLimited } from '@/components/deal-room/DealRoomLimited';
import { DealRoomUnlocked } from '@/components/deal-room/DealRoomUnlocked';
import { DealRoomBlocked } from '@/components/deal-room/DealRoomBlocked';
import { getPassportState } from '@/modules/passport/passport.service';
import type { PassportState } from '@/modules/passport/passport.types';
import { PRODUCT_NAME } from '@/modules/passport/passport.constants';
import { shortenAddress } from '@/lib/format';

const HAS_PRIVY = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export default function DealRoomPage() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletProvider, setWalletProvider] = useState<'privy' | 'metamask'>('privy');
  const [passport, setPassport] = useState<PassportState | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchPassport = useCallback(async (addr: string) => {
    setLoading(true);
    try {
      const state = await getPassportState(addr);
      setPassport(state);
    } catch {
      setPassport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleWalletReady = useCallback(
    async (address: string, provider: 'privy' | 'metamask' = 'privy') => {
      setWalletAddress(address);
      setWalletProvider(provider);
      await fetchPassport(address);
    },
    [fetchPassport],
  );

  useEffect(() => {
    if (walletAddress && passport?.claims.some((c) => c.status === 'PENDING' || c.status === 'PROCESSING')) {
      const t = setInterval(() => fetchPassport(walletAddress), 3000);
      return () => clearInterval(t);
    }
  }, [walletAddress, passport, fetchPassport]);

  function renderDealRoom() {
    if (!walletAddress) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] text-center px-6">
          <p className="text-4xl mb-4">🔒</p>
          <h2 className="text-2xl font-bold text-white mb-2">Login to continue.</h2>
          <p className="text-[#8FA0C0] mb-6 max-w-sm">
            {HAS_PRIVY
              ? 'Login with email or Google to access this Deal Room.'
              : 'Connect MetaMask to access this Deal Room.'}
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            {HAS_PRIVY && (
              <PrivyLoginButton
                onWalletReady={(addr) => handleWalletReady(addr, 'privy')}
                address={null}
              />
            )}
            <ConnectWalletButton onConnect={(addr) => handleWalletReady(addr, 'metamask')} address={null} />
          </div>
        </div>
      );
    }

    if (loading) {
      return (
        <div className="flex items-center justify-center min-h-[400px] text-[#8FA0C0] text-sm">
          Loading passport...
        </div>
      );
    }

    if (!passport || passport.status === 'NONE') {
      return <DealRoomLocked />;
    }

    if (passport.status === 'RED' || passport.status === 'REVOKED') {
      return <DealRoomBlocked />;
    }

    if (passport.canAccessDealRoom && passport.status === 'GREEN') {
      return <DealRoomUnlocked />;
    }

    if (passport.canAccessDealRoom && passport.status === 'LIMITED') {
      return <DealRoomLimited />;
    }

    return <DealRoomLocked />;
  }

  return (
    <div className="min-h-screen bg-[#0D1428]">
      {/* Header */}
      <header className="border-b border-[#1E2D4D]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#4A9EFF] to-[#3DDBD9] flex items-center justify-center">
              <span className="text-white text-xs font-bold">PC</span>
            </div>
            <span className="font-bold text-white text-sm">{PRODUCT_NAME}</span>
          </Link>
          <div className="flex items-center gap-4">
            {walletAddress && (
              <span className="text-xs font-mono text-[#8FA0C0]">{shortenAddress(walletAddress)}</span>
            )}
            {!walletAddress && HAS_PRIVY && (
              <PrivyLoginButton
                onWalletReady={(addr) => handleWalletReady(addr, 'privy')}
                address={null}
              />
            )}
            {!walletAddress && !HAS_PRIVY && (
              <ConnectWalletButton onConnect={(addr) => handleWalletReady(addr, 'metamask')} address={walletAddress} />
            )}
            <Link
              href="/passport"
              className="text-sm font-semibold text-[#4A9EFF] hover:text-[#2B7FE0] transition-colors"
            >
              ← Passport
            </Link>
          </div>
        </div>
      </header>

      {/* Passport status bar */}
      {passport && walletAddress && (
        <div className="border-b border-[#1E2D4D] bg-[#141E38]">
          <div className="max-w-6xl mx-auto px-6 py-2 flex items-center gap-4">
            <span className="text-[10px] font-semibold tracking-widest uppercase text-[#8FA0C0]">
              Passport Status
            </span>
            <span
              className={`text-xs font-bold ${
                passport.status === 'GREEN'
                  ? 'text-[#3DDBD9]'
                  : passport.status === 'LIMITED'
                  ? 'text-[#4A9EFF]'
                  : passport.status === 'RED'
                  ? 'text-red-400'
                  : 'text-[#8FA0C0]'
              }`}
            >
              {passport.status}
            </span>
            <span className="text-[#1E2D4D]">·</span>
            <span className="text-[10px] text-[#8FA0C0]">
              KYC/AML: {passport.claims.find((c) => c.claimType === 'KYC_AML_VERIFIED')?.status ?? 'UNVERIFIED'}
            </span>
            <span className="text-[#1E2D4D]">·</span>
            <span className="text-[10px] text-[#8FA0C0]">
              Accredited: {passport.claims.find((c) => c.claimType === 'ACCREDITED_INVESTOR')?.status ?? 'UNVERIFIED'}
            </span>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="max-w-3xl mx-auto px-6 py-12">{renderDealRoom()}</main>
    </div>
  );
}
