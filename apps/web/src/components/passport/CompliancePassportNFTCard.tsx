'use client';

import type { PassportBadge, PassportStatus } from '@/modules/passport/passport.types';

type Props = {
  passportStatus: PassportStatus;
  passportTokenId: string | null | undefined;
  passportTxHash: string | null | undefined;
  badges: PassportBadge[];
  walletAddress: string;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  NONE: { label: 'Not Minted', color: 'text-[#9CA3AF]', bg: 'bg-[#F0F2F6]' },
  IN_PROGRESS: { label: 'In Progress', color: 'text-blue-600', bg: 'bg-blue-50' },
  LIMITED: { label: 'LIMITED', color: 'text-yellow-700', bg: 'bg-yellow-50' },
  GREEN: { label: 'GREEN', color: 'text-green-700', bg: 'bg-green-50' },
  RED: { label: 'RED', color: 'text-red-600', bg: 'bg-red-50' },
  REVOKED: { label: 'REVOKED', color: 'text-red-700', bg: 'bg-red-50' },
  EXPIRED: { label: 'EXPIRED', color: 'text-[#9CA3AF]', bg: 'bg-[#F0F2F6]' },
};

const CLAIM_COLORS: Record<string, string> = {
  VERIFIED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-600',
  PROCESSING: 'bg-blue-100 text-blue-600',
  PENDING: 'bg-yellow-100 text-yellow-600',
  UNVERIFIED: 'bg-[#F0F2F6] text-[#9CA3AF]',
};

function shortHash(hash: string) {
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

export function CompliancePassportNFTCard({
  passportStatus,
  passportTokenId,
  passportTxHash,
  badges,
  walletAddress,
}: Props) {
  const config = STATUS_CONFIG[passportStatus] ?? STATUS_CONFIG.NONE;
  const isMinted = !!passportTokenId;

  return (
    <div className="bg-[#0D1428] rounded-2xl p-6 shadow-lg text-white">
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <p className="text-[10px] font-semibold tracking-widest uppercase text-[#4A9EFF] mb-1">
            Compliance Passport
          </p>
          <p className="text-xs text-[#8FA0C0]">Soulbound · Non-transferable</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${config.bg} ${config.color}`}>
            {config.label}
          </span>
          {isMinted && (
            <span className="text-[10px] text-[#4A9EFF] bg-[#1A2540] px-2 py-0.5 rounded-full">
              Token #{passportTokenId}
            </span>
          )}
        </div>
      </div>

      {/* Not minted state */}
      {!isMinted && (
        <div className="border border-dashed border-[#2A3A60] rounded-xl p-4 text-center mb-4">
          <p className="text-sm text-[#8FA0C0]">Passport not yet minted</p>
          <p className="text-[10px] text-[#4B5568] mt-1">
            Complete KYC/AML verification to mint your Compliance Passport SBT.
          </p>
        </div>
      )}

      {/* SBT visual when minted */}
      {isMinted && (
        <div className="border border-[#2A3A60] rounded-xl p-4 mb-4 flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[#4A9EFF] to-[#3DDBD9] flex items-center justify-center shrink-0">
            <span className="text-white text-xl font-bold">PC</span>
          </div>
          <div>
            <p className="text-sm font-bold text-white">PassportCreds #{passportTokenId}</p>
            <p className="text-[10px] text-[#8FA0C0] mt-0.5">ERC-721 · ERC-5192 Soulbound</p>
            <p className="text-[10px] font-mono text-[#4B5568] mt-0.5 truncate max-w-[160px]">
              {walletAddress}
            </p>
          </div>
        </div>
      )}

      {/* Claims */}
      <div className="space-y-2 mb-4">
        {badges.map((badge) => (
          <div key={badge.claimType} className="flex items-center justify-between">
            <span className="text-xs text-[#8FA0C0]">
              {badge.claimType === 'KYC_AML_VERIFIED' ? 'KYC / AML' : 'Accredited Investor'}
            </span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${CLAIM_COLORS[badge.status] ?? CLAIM_COLORS.UNVERIFIED}`}>
              {badge.status}
            </span>
          </div>
        ))}
      </div>

      {/* Tx hash */}
      {passportTxHash && (
        <div className="pt-3 border-t border-[#2A3A60]">
          <p className="text-[10px] text-[#4B5568] mb-1">Latest onchain tx</p>
          <p className="text-[10px] font-mono text-[#4A9EFF]">{shortHash(passportTxHash)}</p>
        </div>
      )}
    </div>
  );
}
