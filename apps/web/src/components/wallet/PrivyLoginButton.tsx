'use client';

import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useEffect, useCallback } from 'react';
import { setupPrivyWallet } from '@/modules/wallet/wallet.service';

type Props = {
  onWalletReady: (address: string) => void;
  onDisconnect?: () => void;
  address: string | null;
};

export function PrivyLoginButton({ onWalletReady, onDisconnect, address }: Props) {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();

  const handleSetup = useCallback(async () => {
    const embedded = wallets.find((w) => w.walletClientType === 'privy');
    if (!embedded || !user) return;
    try {
      await setupPrivyWallet(user.id, embedded.address);
      onWalletReady(embedded.address);
    } catch {
      // If backend setup fails, still allow demo with the address
      onWalletReady(embedded.address);
    }
  }, [wallets, user, onWalletReady]);

  useEffect(() => {
    if (authenticated && wallets.length > 0 && !address) {
      handleSetup();
    }
  }, [authenticated, wallets, address, handleSetup]);

  if (!ready) {
    return (
      <button
        disabled
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#4A9EFF] text-white text-sm font-semibold opacity-60 cursor-not-allowed"
      >
        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        Loading...
      </button>
    );
  }

  if (authenticated && address) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 bg-[#F0F2F6] border border-[#DDE1EA] rounded-xl px-3 py-2">
          <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
          <span className="text-xs font-mono text-[#0D1428] truncate max-w-[120px]">{address}</span>
          <span className="text-[10px] font-semibold text-[#4A9EFF] bg-blue-50 px-1.5 py-0.5 rounded">
            Privy
          </span>
        </div>
        <button
          onClick={() => { logout(); onDisconnect?.(); }}
          className="text-xs text-[#9CA3AF] hover:text-[#4B5568] transition-colors"
        >
          Logout
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={login}
      className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#4A9EFF] hover:bg-[#3a8eef] text-white text-sm font-semibold transition-colors"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
      Login with Privy
    </button>
  );
}
