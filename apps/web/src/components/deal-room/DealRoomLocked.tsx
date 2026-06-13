import Link from 'next/link';
import { RESOURCE_NAME } from '@/modules/passport/passport.constants';

export function DealRoomLocked() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] text-center px-6">
      <div className="w-20 h-20 rounded-full bg-[#1E2D4D] flex items-center justify-center mb-6 text-4xl">
        🔒
      </div>
      <h2 className="text-2xl font-bold text-white mb-2">{RESOURCE_NAME}</h2>
      <p className="text-[11px] font-semibold tracking-widest uppercase text-[#4A9EFF] mb-4">
        Access Required
      </p>
      <p className="text-[#8FA0C0] max-w-sm mb-6">
        This Deal Room requires a valid Compliance Passport. Complete verification to continue.
      </p>
      <Link
        href="/passport"
        className="bg-[#4A9EFF] text-white text-sm font-semibold px-6 py-3 rounded-lg hover:bg-[#2B7FE0] transition-colors"
      >
        Start Compliance Flow →
      </Link>
    </div>
  );
}
