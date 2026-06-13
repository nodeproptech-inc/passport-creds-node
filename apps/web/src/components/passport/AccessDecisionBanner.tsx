import type { PassportStatus } from '@/modules/passport/passport.types';
import Link from 'next/link';

type Props = {
  passportStatus: PassportStatus;
  canAccessDealRoom: boolean;
};

export function AccessDecisionBanner({ passportStatus, canAccessDealRoom }: Props) {
  if (passportStatus === 'GREEN') {
    return (
      <div className="bg-[#3DDBD9]/10 border border-[#3DDBD9]/30 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <span className="text-2xl">✅</span>
          <div>
            <p className="font-bold text-[#0D1428] text-base">Access Granted</p>
            <p className="text-sm text-[#4B5568] mt-0.5">Your Compliance Passport is GREEN.</p>
            <Link
              href="/deal-room"
              className="inline-block mt-3 text-sm font-semibold px-4 py-2 rounded-lg bg-[#0D1428] text-white hover:bg-[#141E38] transition-colors"
            >
              Enter Deal Room →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (passportStatus === 'LIMITED' && canAccessDealRoom) {
    return (
      <div className="bg-[#4A9EFF]/10 border border-[#4A9EFF]/30 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🔓</span>
          <div>
            <p className="font-bold text-[#0D1428] text-base">Deal Room Unlocked</p>
            <p className="text-sm text-[#4B5568] mt-0.5">
              Investor actions disabled until Accredited Investor badge is verified.
            </p>
            <Link
              href="/deal-room"
              className="inline-block mt-3 text-sm font-semibold px-4 py-2 rounded-lg border border-[#4A9EFF] text-[#4A9EFF] hover:bg-blue-50 transition-colors"
            >
              Enter Deal Room →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (passportStatus === 'RED' || passportStatus === 'REVOKED') {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🚫</span>
          <div>
            <p className="font-bold text-red-600 text-base">Access Denied</p>
            <p className="text-sm text-[#4B5568] mt-0.5">
              Required compliance claims are missing or failed.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#F8F9FC] border border-[#DDE1EA] rounded-2xl p-5">
      <div className="flex items-start gap-3">
        <span className="text-2xl">🔒</span>
        <div>
          <p className="font-bold text-[#0D1428] text-base">Deal Room Locked</p>
          <p className="text-sm text-[#4B5568] mt-0.5">
            Complete compliance verification to continue.
          </p>
        </div>
      </div>
    </div>
  );
}
