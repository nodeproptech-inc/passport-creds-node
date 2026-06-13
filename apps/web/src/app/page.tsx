import Link from 'next/link';
import { PRODUCT_NAME, TENANT_NAME, RESOURCE_NAME } from '@/modules/passport/passport.constants';

const FEATURES = [
  {
    icon: '🔐',
    label: 'Confidential AI',
    desc: 'Chainlink Confidential AI Attester processes compliance evidence privately.',
  },
  {
    icon: '⛓️',
    label: 'Onchain Claims',
    desc: 'Verified claims written to ClaimRegistry via Chainlink CRE.',
  },
  {
    icon: '🎫',
    label: 'Soulbound Passport',
    desc: 'ERC-721 + ERC-5192 non-transferable Compliance Passport per wallet.',
  },
  {
    icon: '🚪',
    label: 'Regulated Access',
    desc: 'AccessGate reads claims and unlocks the Deal Room automatically.',
  },
];

const STEPS = [
  { step: '01', label: 'Connect MetaMask', color: 'text-[#4A9EFF]' },
  { step: '02', label: 'Submit KYC / AML Evidence', color: 'text-[#4A9EFF]' },
  { step: '03', label: 'AI Attester Processes Evidence', color: 'text-[#3DDBD9]' },
  { step: '04', label: 'Chainlink CRE Updates Claims', color: 'text-[#3DDBD9]' },
  { step: '05', label: 'Passport Issued Onchain', color: 'text-[#3DDBD9]' },
  { step: '06', label: 'Deal Room Unlocks', color: 'text-[#3DDBD9]' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#F0F2F6]">
      {/* Nav */}
      <nav className="bg-white border-b border-[#DDE1EA]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#4A9EFF] to-[#3DDBD9] flex items-center justify-center">
              <span className="text-white text-xs font-bold">PC</span>
            </div>
            <span className="font-bold text-[#0D1428] text-sm">{PRODUCT_NAME}</span>
          </div>
          <Link
            href="/passport"
            className="text-sm font-semibold text-[#4A9EFF] hover:text-[#2B7FE0] transition-colors"
          >
            Launch App →
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 text-center">
        <p className="text-[11px] font-semibold tracking-widest uppercase text-[#4A9EFF] mb-4">
          Powered by Chainlink · ETHGlobal Hackathon
        </p>
        <h1 className="text-5xl font-bold text-[#0D1428] mb-4 leading-tight">
          {PRODUCT_NAME.split(' by ')[0]}{' '}
          <span className="bg-gradient-to-r from-[#4A9EFF] to-[#3DDBD9] bg-clip-text text-transparent">
            by Node
          </span>
        </h1>
        <p className="text-xl text-[#4B5568] mb-3 max-w-2xl mx-auto">
          White-label Compliance Passport for regulated access.
        </p>
        <p className="text-base text-[#9CA3AF] mb-10 max-w-xl mx-auto">
          Turn private compliance evidence into verified onchain claims.
          Unlock regulated access without exposing sensitive documents.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/passport"
            className="bg-[#0D1428] text-white text-sm font-semibold px-8 py-3.5 rounded-lg hover:bg-[#141E38] transition-colors"
          >
            Start Compliance Flow →
          </Link>
          <Link
            href="/deal-room"
            className="border border-[#0D1428] text-[#0D1428] text-sm font-semibold px-8 py-3.5 rounded-lg hover:bg-[#F0F2F6] transition-colors"
          >
            View Deal Room
          </Link>
        </div>
        <p className="text-xs text-[#9CA3AF] mt-4">
          Demo use case: {TENANT_NAME} · {RESOURCE_NAME}
        </p>
      </section>

      {/* Dark strip — features */}
      <section className="bg-[#0D1428] py-16">
        <div className="max-w-6xl mx-auto px-6">
          <p className="text-[11px] font-semibold tracking-widest uppercase text-[#4A9EFF] text-center mb-10">
            Platform Architecture
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {FEATURES.map((f) => (
              <div
                key={f.label}
                className="bg-[#172040] border border-[#1E2D4D] rounded-2xl p-5"
              >
                <div className="w-10 h-10 rounded-full bg-[#1E2D4D] flex items-center justify-center mb-4 text-xl">
                  {f.icon}
                </div>
                <p className="text-white text-sm font-semibold mb-2">{f.label}</p>
                <p className="text-[#8FA0C0] text-xs leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Flow steps */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <p className="text-[11px] font-semibold tracking-widest uppercase text-[#4A9EFF] text-center mb-10">
          Demo Flow
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {STEPS.map((s) => (
            <div key={s.step} className="bg-white border border-[#DDE1EA] rounded-2xl p-4 text-center shadow-sm">
              <p className={`text-2xl font-bold mb-2 ${s.color}`}>{s.step}</p>
              <p className="text-xs text-[#4B5568] leading-snug">{s.label}</p>
            </div>
          ))}
        </div>

        <div className="text-center mt-12">
          <Link
            href="/passport"
            className="inline-block bg-[#0D1428] text-white text-sm font-semibold px-8 py-3.5 rounded-lg hover:bg-[#141E38] transition-colors"
          >
            Start Compliance Flow →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#DDE1EA] bg-white py-6">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
          <span className="text-xs text-[#9CA3AF]">{PRODUCT_NAME}</span>
          <span className="text-xs text-[#9CA3AF]">ETHGlobal Hackathon Demo</span>
        </div>
      </footer>
    </div>
  );
}
