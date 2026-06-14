'use client';

type Props = {
  address: string;
  walletProvider: 'privy' | 'metamask';
};

export function WalletSetupCard({ address, walletProvider }: Props) {
  const label = walletProvider === 'privy' ? 'Privy Embedded Wallet' : 'MetaMask';
  const badge = walletProvider === 'privy' ? 'bg-blue-50 text-[#4A9EFF]' : 'bg-orange-50 text-orange-500';

  return (
    <div className="bg-white border border-[#DDE1EA] rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-semibold tracking-widest uppercase text-[#9CA3AF]">
          Connected Wallet
        </p>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge}`}>
          {label}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
        <span className="text-xs font-mono text-[#0D1428] break-all">{address}</span>
      </div>
      <p className="text-[10px] text-[#9CA3AF] mt-2">
        Your Compliance Passport will be minted to this address. It is soulbound — non-transferable.
      </p>
    </div>
  );
}
