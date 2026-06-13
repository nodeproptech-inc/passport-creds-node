import Link from 'next/link';
import { RESOURCE_NAME } from '@/modules/passport/passport.constants';

export function DealRoomBlocked() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] text-center px-6">
      <div className="w-20 h-20 rounded-full bg-red-900/30 flex items-center justify-center mb-6 text-4xl">
        🚫
      </div>
      <h2 className="text-2xl font-bold text-white mb-2">{RESOURCE_NAME}</h2>
      <p className="text-[11px] font-semibold tracking-widest uppercase text-red-400 mb-4">
        Access Denied
      </p>
      <p className="text-[#8FA0C0] max-w-sm mb-6">
        Critical compliance checks failed. Access is blocked.
      </p>
      <Link
        href="/passport"
        className="border border-[#4A9EFF] text-[#4A9EFF] text-sm font-semibold px-6 py-3 rounded-lg hover:bg-[#4A9EFF]/10 transition-colors"
      >
        View Passport →
      </Link>
    </div>
  );
}
