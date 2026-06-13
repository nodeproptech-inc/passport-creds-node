import Link from 'next/link';
import { RESOURCE_NAME } from '@/modules/passport/passport.constants';

export function DealRoomLimited() {
  return (
    <div className="space-y-6">
      <div className="bg-[#4A9EFF]/10 border border-[#4A9EFF]/30 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🔓</span>
          <div>
            <p className="font-bold text-white text-base">Deal Room access granted.</p>
            <p className="text-sm text-[#8FA0C0] mt-0.5">
              Investor actions remain disabled until Accredited Investor verification is complete.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-[#172040] border border-[#1E2D4D] rounded-2xl p-6">
        <p className="text-[11px] font-semibold tracking-widest uppercase text-[#4A9EFF] mb-2">
          {RESOURCE_NAME}
        </p>
        <h2 className="text-xl font-bold text-white mb-4">Oklahoma Real Estate Portfolio</h2>

        <div className="grid grid-cols-3 gap-4 mb-6">
          {['$12.4M', '8.2%', '142'].map((val, i) => (
            <div key={i} className="bg-[#0D1428] rounded-xl p-4 text-center">
              <p className="text-xl font-bold text-[#4A9EFF]">{val}</p>
              <p className="text-xs text-[#8FA0C0] mt-1">
                {['Portfolio Value', 'Avg. Yield', 'Units'][i]}
              </p>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          {['Executive Summary', 'Property Reports', 'Financial Projections'].map((doc) => (
            <div
              key={doc}
              className="flex items-center justify-between bg-[#0D1428] rounded-xl px-4 py-3"
            >
              <span className="text-sm text-white">{doc}</span>
              <span className="text-xs text-[#8FA0C0]">Available</span>
            </div>
          ))}
        </div>

        <div className="mt-6 pt-4 border-t border-[#1E2D4D]">
          <p className="text-xs text-[#8FA0C0] mb-3">Investor actions require Accredited Investor badge</p>
          <div className="flex gap-3">
            <button
              disabled
              className="flex-1 text-sm font-semibold px-4 py-2.5 rounded-lg bg-[#1E2D4D] text-[#8FA0C0] cursor-not-allowed"
            >
              Invest Now (Locked)
            </button>
            <Link
              href="/passport"
              className="flex-1 text-center text-sm font-semibold px-4 py-2.5 rounded-lg border border-[#4A9EFF] text-[#4A9EFF] hover:bg-[#4A9EFF]/10 transition-colors"
            >
              Complete Verification
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
