'use client';

type Props = {
  policyStatus: 'NO_KYC_DAILY_50' | 'KYC_USER_CONFIGURABLE' | 'BLOCKED';
  dailyLimitUsd: number;
};

const CONFIGS = {
  NO_KYC_DAILY_50: {
    bg: 'bg-yellow-50 border-yellow-200',
    icon: '⚠️',
    title: '50 USDC daily transfer limit',
    message: 'Your wallet has no KYC/AML verification. Maximum outbound transfers are capped at 50 USDC/day. Complete compliance verification to configure your own limit.',
    textColor: 'text-yellow-800',
    subColor: 'text-yellow-600',
  },
  KYC_USER_CONFIGURABLE: {
    bg: 'bg-green-50 border-green-200',
    icon: '✓',
    title: 'Transfer limit configurable',
    message: 'KYC/AML verified. You can set your daily transfer limit below.',
    textColor: 'text-green-800',
    subColor: 'text-green-600',
  },
  BLOCKED: {
    bg: 'bg-red-50 border-red-200',
    icon: '🚫',
    title: 'Transfers blocked',
    message: 'Your wallet is blocked due to compliance status (RED or REVOKED passport). No outbound transfers are permitted.',
    textColor: 'text-red-800',
    subColor: 'text-red-600',
  },
};

export function TransferPolicyBanner({ policyStatus, dailyLimitUsd }: Props) {
  const config = CONFIGS[policyStatus];

  return (
    <div className={`border rounded-xl px-4 py-3 ${config.bg}`}>
      <div className="flex items-start gap-2">
        <span className="text-base shrink-0 mt-0.5">{config.icon}</span>
        <div>
          <p className={`text-sm font-semibold ${config.textColor}`}>{config.title}</p>
          <p className={`text-xs mt-0.5 ${config.subColor}`}>{config.message}</p>
          {policyStatus === 'KYC_USER_CONFIGURABLE' && (
            <p className={`text-xs mt-1 font-semibold ${config.textColor}`}>
              Current limit: {dailyLimitUsd} USDC / day
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
