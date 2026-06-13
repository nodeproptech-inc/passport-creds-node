import type { ClaimStatus } from '@/modules/passport/passport.types';
import { CLAIM_STATUS_LABELS } from '@/modules/passport/passport.constants';

const STATUS_STYLES: Record<ClaimStatus, string> = {
  UNVERIFIED: 'bg-slate-100 text-slate-500 border-slate-200',
  PENDING: 'bg-blue-50 text-blue-500 border-blue-200',
  PROCESSING: 'bg-cyan-50 text-[#4A9EFF] border-cyan-200',
  VERIFIED: 'bg-teal-50 text-[#3DDBD9] border-teal-200',
  FAILED: 'bg-red-50 text-red-500 border-red-200',
  EXPIRED: 'bg-amber-50 text-amber-500 border-amber-200',
  REVOKED: 'bg-red-50 text-red-600 border-red-200',
};

const STATUS_DOTS: Record<ClaimStatus, string> = {
  UNVERIFIED: 'bg-slate-400',
  PENDING: 'bg-blue-500',
  PROCESSING: 'bg-[#4A9EFF]',
  VERIFIED: 'bg-[#3DDBD9]',
  FAILED: 'bg-red-500',
  EXPIRED: 'bg-amber-500',
  REVOKED: 'bg-red-600',
};

type Props = {
  status: ClaimStatus;
  size?: 'sm' | 'md';
};

export function ClaimStatusBadge({ status, size = 'md' }: Props) {
  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs';
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold border ${textSize} ${STATUS_STYLES[status]}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOTS[status]}`} />
      {CLAIM_STATUS_LABELS[status]}
    </span>
  );
}
