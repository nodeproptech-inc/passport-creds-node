'use client';

import type { WalletPolicy } from '@/modules/wallet/wallet.service';

type Props = {
  walletAddress: string;
  walletProvider: 'privy' | 'metamask';
  passportStatus: string;
  policy: WalletPolicy | null;
};

const POLICY_LABELS: Record<string, { label: string; color: string }> = {
  NO_KYC_DAILY_50: { label: '50 USDC / day', color: 'text-yellow-600 bg-yellow-50' },
  KYC_USER_CONFIGURABLE: { label: 'Configurable', color: 'text-green-600 bg-green-50' },
  BLOCKED: { label: 'Blocked', color: 'text-red-600 bg-red-50' },
};

export function PassportWalletCard({ walletAddress, walletProvider, passportStatus, policy }: Props) {
  const providerLabel = walletProvider === 'privy' ? 'Privy Embedded Wallet' : 'MetaMask';
  const providerBadge = walletProvider === 'privy' ? 'bg-blue-50 text-[#4A9EFF]' : 'bg-orange-50 text-orange-500';
  const policyInfo = policy ? POLICY_LABELS[policy.policyStatus] : null;

  return (
    <div className="bg-white border border-[#DDE1EA] rounded-2xl p-5 shadow-sm">
      <p className="text-[11px] font-semibold tracking-widest uppercase text-[#9CA3AF] mb-4">
        Wallet
      </p>

      <div className="space-y-3">
        {/* Provider */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-[#4B5568]">Provider</span>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${providerBadge}`}>
            {providerLabel}
          </span>
        </div>

        {/* Address */}
        <div>
          <span className="text-xs text-[#4B5568] block mb-1">Address</span>
          <span className="text-xs font-mono text-[#0D1428] break-all">{walletAddress}</span>
        </div>

        {/* Transfer Policy */}
        {policy && (
          <div className="pt-3 border-t border-[#F0F2F6]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-[#4B5568]">Transfer Policy</span>
              {policyInfo && (
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${policyInfo.color}`}>
                  {policyInfo.label}
                </span>
              )}
            </div>
            {policy.policyStatus === 'NO_KYC_DAILY_50' && (
              <p className="text-[10px] text-[#9CA3AF]">
                Complete KYC/AML to set your own daily limit.
              </p>
            )}
            {policy.policyStatus === 'KYC_USER_CONFIGURABLE' && (
              <p className="text-[10px] text-[#9CA3AF]">
                Daily limit: {policy.dailyLimitUsd} {policy.limitToken}
              </p>
            )}
            {policy.policyStatus === 'BLOCKED' && (
              <p className="text-[10px] text-red-400">
                Transfers blocked due to compliance status.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
