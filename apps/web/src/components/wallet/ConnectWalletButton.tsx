'use client';

import { useState, useEffect } from 'react';
import { metamaskAdapter } from '@/modules/wallet/metamask.adapter';
import { shortenAddress } from '@/lib/format';

type Props = {
  onConnect: (address: string) => void;
  address: string | null;
};

export function ConnectWalletButton({ onConnect, address }: Props) {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    metamaskAdapter.getConnectedWallet().then((addr) => {
      if (addr) onConnect(addr);
    });
  }, [onConnect]);

  async function handleConnect() {
    setConnecting(true);
    setError(null);
    try {
      const addr = await metamaskAdapter.connectWallet();
      onConnect(addr);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to connect wallet.');
    } finally {
      setConnecting(false);
    }
  }

  if (address) {
    return (
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-[#3DDBD9] inline-block" />
        <span className="text-sm font-mono text-[#4B5568]">{shortenAddress(address)}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleConnect}
        disabled={connecting}
        className="bg-[#0D1428] text-white text-sm font-semibold px-5 py-2.5 rounded-lg hover:bg-[#141E38] transition-colors disabled:opacity-50"
      >
        {connecting ? 'Connecting...' : 'Connect Wallet'}
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
