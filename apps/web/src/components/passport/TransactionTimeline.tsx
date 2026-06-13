import type { TransactionItem } from '@/modules/passport/passport.types';
import { formatTxHash } from '@/lib/format';

const EXPLORER_BASE =
  process.env.NEXT_PUBLIC_EXPLORER_URL ?? 'https://sepolia.basescan.org';

const CONTRACT_COLORS: Record<string, string> = {
  ClaimRegistry: 'text-[#4A9EFF] bg-[#4A9EFF]/10',
  CompliancePassport: 'text-[#3DDBD9] bg-[#3DDBD9]/10',
  AccessGate: 'text-purple-500 bg-purple-50',
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'text-blue-500',
  CONFIRMED: 'text-[#3DDBD9]',
  SIMULATED: 'text-[#4A9EFF]',
  FAILED: 'text-red-500',
};

type Props = {
  transactions: TransactionItem[];
};

export function TransactionTimeline({ transactions }: Props) {
  if (transactions.length === 0) {
    return (
      <div className="bg-[#0D1428] rounded-2xl p-6">
        <p className="text-[11px] font-semibold tracking-widest uppercase text-[#4A9EFF] mb-4">
          Transaction Timeline
        </p>
        <p className="text-sm text-[#8FA0C0]">No onchain transactions yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-[#0D1428] rounded-2xl p-6">
      <p className="text-[11px] font-semibold tracking-widest uppercase text-[#4A9EFF] mb-4">
        Transaction Timeline
      </p>
      <div className="space-y-3">
        {transactions.map((tx, i) => (
          <div key={tx.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="w-6 h-6 rounded-full bg-[#172040] border border-[#1E2D4D] flex items-center justify-center text-xs text-[#8FA0C0]">
                {i + 1}
              </div>
              {i < transactions.length - 1 && (
                <div className="w-px flex-1 bg-[#1E2D4D] my-1" />
              )}
            </div>
            <div className="bg-[#172040] border border-[#1E2D4D] rounded-xl p-3 flex-1 mb-1">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${CONTRACT_COLORS[tx.contractName] ?? 'text-slate-400 bg-slate-100'}`}
                >
                  {tx.contractName}
                </span>
                <span className={`text-[10px] font-semibold ${STATUS_COLORS[tx.status]}`}>
                  {tx.status}
                </span>
              </div>
              <p className="text-sm text-white font-medium">{tx.action}</p>
              {tx.transactionHash && (
                <a
                  href={`${EXPLORER_BASE}/tx/${tx.transactionHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-[#4A9EFF] mt-1 hover:underline block"
                >
                  {formatTxHash(tx.transactionHash)} ↗
                </a>
              )}
              <p className="text-[10px] text-[#8FA0C0] mt-1">
                {new Date(tx.createdAt).toLocaleTimeString()}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
