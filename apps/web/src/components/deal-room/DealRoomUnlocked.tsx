import { RESOURCE_NAME } from '@/modules/passport/passport.constants';

export function DealRoomUnlocked() {
  return (
    <div className="space-y-6">
      <div className="bg-[#3DDBD9]/10 border border-[#3DDBD9]/30 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <span className="text-2xl">✅</span>
          <div>
            <p className="font-bold text-white text-base">Deal Room unlocked.</p>
            <p className="text-sm text-[#8FA0C0] mt-0.5">Your PassportCreds passport is GREEN.</p>
          </div>
        </div>
      </div>

      <div className="bg-[#172040] border border-[#1E2D4D] rounded-2xl p-6">
        <p className="text-[11px] font-semibold tracking-widest uppercase text-[#3DDBD9] mb-2">
          {RESOURCE_NAME}
        </p>
        <h2 className="text-xl font-bold text-white mb-4">Oklahoma Real Estate Portfolio</h2>

        <div className="grid grid-cols-3 gap-4 mb-6">
          {['$12.4M', '8.2%', '142'].map((val, i) => (
            <div key={i} className="bg-[#0D1428] rounded-xl p-4 text-center">
              <p className="text-xl font-bold text-[#3DDBD9]">{val}</p>
              <p className="text-xs text-[#8FA0C0] mt-1">
                {['Portfolio Value', 'Avg. Yield', 'Units'][i]}
              </p>
            </div>
          ))}
        </div>

        <div className="space-y-3 mb-6">
          {['Executive Summary', 'Property Reports', 'Financial Projections', 'Legal Documents'].map(
            (doc) => (
              <div
                key={doc}
                className="flex items-center justify-between bg-[#0D1428] rounded-xl px-4 py-3"
              >
                <span className="text-sm text-white">{doc}</span>
                <span className="text-xs text-[#3DDBD9] font-semibold">Unlocked</span>
              </div>
            )
          )}
        </div>

        <div className="pt-4 border-t border-[#1E2D4D]">
          <div className="flex gap-3">
            <button className="flex-1 text-sm font-semibold px-4 py-2.5 rounded-lg bg-gradient-to-r from-[#4A9EFF] to-[#3DDBD9] text-white hover:opacity-90 transition-opacity">
              Invest Now
            </button>
            <button className="flex-1 text-sm font-semibold px-4 py-2.5 rounded-lg border border-[#3DDBD9] text-[#3DDBD9] hover:bg-[#3DDBD9]/10 transition-colors">
              Schedule Call
            </button>
          </div>
          <p className="text-xs text-[#8FA0C0] text-center mt-3">
            Demo only — investment flow not built
          </p>
        </div>
      </div>
    </div>
  );
}
