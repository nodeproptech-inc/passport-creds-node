'use client';

import type { ClaimType, ClaimStatus } from '@/modules/passport/passport.types';
import { ClaimStatusBadge } from './ClaimStatusBadge';
import { formatTxHash } from '@/lib/format';

type Props = {
  title: string;
  description: string;
  claimType: ClaimType;
  status: ClaimStatus;
  summary?: string;
  confidence?: number;
  transactionHash?: string;
  onStartVerification?: () => void;
  onSimulate?: () => void;
  onSyncOnchain?: () => void;
  isStarting?: boolean;
  isSimulating?: boolean;
  verificationId?: string;
};

export function EvidenceCard({
  title,
  description,
  status,
  summary,
  confidence,
  transactionHash,
  onStartVerification,
  onSimulate,
  onSyncOnchain,
  isStarting,
  isSimulating,
  verificationId,
}: Props) {
  const isActive = status === 'PENDING' || status === 'PROCESSING';

  return (
    <div className="bg-white border border-[#DDE1EA] rounded-2xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-[11px] font-semibold tracking-widest uppercase text-[#4A9EFF] mb-1">
            Compliance Evidence
          </p>
          <h3 className="text-base font-semibold text-[#0D1428]">{title}</h3>
        </div>
        <ClaimStatusBadge status={status} />
      </div>

      <p className="text-sm text-[#4B5568] mb-4">{description}</p>

      {summary && (
        <div className="bg-[#F8F9FC] border border-[#DDE1EA] rounded-xl p-3 mb-3">
          <p className="text-[11px] font-semibold tracking-widest uppercase text-[#9CA3AF] mb-1">
            AI Attester Summary
          </p>
          <p className="text-sm text-[#4B5568]">{summary}</p>
          {confidence !== undefined && (
            <p className="text-xs text-[#9CA3AF] mt-1">Confidence: {Math.round(confidence * 100)}%</p>
          )}
        </div>
      )}

      {transactionHash && (
        <div className="mb-3">
          <p className="text-[11px] font-semibold tracking-widest uppercase text-[#9CA3AF] mb-1">
            Transaction
          </p>
          <p className="font-mono text-xs text-[#4A9EFF]">{formatTxHash(transactionHash)}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-4">
        {status === 'UNVERIFIED' && onStartVerification && (
          <button
            onClick={onStartVerification}
            disabled={isStarting}
            className="text-sm font-semibold px-4 py-2 rounded-lg bg-[#0D1428] text-white hover:bg-[#141E38] transition-colors disabled:opacity-50"
          >
            {isStarting ? 'Starting...' : 'Start Verification'}
          </button>
        )}

        {isActive && onSyncOnchain && verificationId && (
          <button
            onClick={onSyncOnchain}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#4A9EFF] text-[#4A9EFF] hover:bg-blue-50 transition-colors"
          >
            Sync Onchain
          </button>
        )}

        {onSimulate && (status === 'UNVERIFIED' || status === 'PENDING' || status === 'PROCESSING' || status === 'FAILED') && (
          <button
            onClick={onSimulate}
            disabled={isSimulating}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-dashed border-[#9CA3AF] text-[#9CA3AF] hover:border-[#4A9EFF] hover:text-[#4A9EFF] transition-colors disabled:opacity-50"
            title="Demo only — bypasses real AI Attester"
          >
            {isSimulating ? 'Simulating...' : '⚡ Demo: Simulate Verified'}
          </button>
        )}
      </div>
    </div>
  );
}
