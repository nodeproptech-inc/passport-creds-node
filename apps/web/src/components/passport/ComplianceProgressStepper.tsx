import type { PassportStatus, ClaimStatus } from '@/modules/passport/passport.types';

type StepStatus = 'NOT_STARTED' | 'PROCESSING' | 'PASSED' | 'FAILED' | 'LIMITED';

type Step = {
  label: string;
  status: StepStatus;
};

function getStepStatus(
  claimStatus: ClaimStatus | undefined,
  fallback: StepStatus = 'NOT_STARTED'
): StepStatus {
  if (!claimStatus) return fallback;
  if (claimStatus === 'VERIFIED') return 'PASSED';
  if (claimStatus === 'FAILED' || claimStatus === 'REVOKED') return 'FAILED';
  if (claimStatus === 'PENDING' || claimStatus === 'PROCESSING') return 'PROCESSING';
  return fallback;
}

const STEP_STYLES: Record<StepStatus, { dot: string; label: string; connector: string }> = {
  NOT_STARTED: {
    dot: 'bg-slate-200 border-slate-300',
    label: 'text-[#9CA3AF]',
    connector: 'bg-slate-200',
  },
  PROCESSING: {
    dot: 'bg-[#4A9EFF] border-[#4A9EFF] animate-pulse',
    label: 'text-[#4A9EFF]',
    connector: 'bg-[#4A9EFF]/30',
  },
  PASSED: {
    dot: 'bg-[#3DDBD9] border-[#3DDBD9]',
    label: 'text-[#0D1428]',
    connector: 'bg-[#3DDBD9]',
  },
  FAILED: {
    dot: 'bg-red-500 border-red-500',
    label: 'text-red-500',
    connector: 'bg-red-200',
  },
  LIMITED: {
    dot: 'bg-[#4A9EFF] border-[#4A9EFF]',
    label: 'text-[#4A9EFF]',
    connector: 'bg-[#4A9EFF]/30',
  },
};

const STATUS_ICON: Record<StepStatus, string> = {
  NOT_STARTED: '○',
  PROCESSING: '◉',
  PASSED: '✓',
  FAILED: '✗',
  LIMITED: '◐',
};

type Props = {
  walletConnected: boolean;
  passportStatus: PassportStatus;
  kycStatus?: ClaimStatus;
  accreditedStatus?: ClaimStatus;
};

export function ComplianceProgressStepper({
  walletConnected,
  passportStatus,
  kycStatus,
  accreditedStatus,
}: Props) {
  const passportStepStatus = (): StepStatus => {
    if (passportStatus === 'GREEN') return 'PASSED';
    if (passportStatus === 'LIMITED') return 'LIMITED';
    if (passportStatus === 'RED') return 'FAILED';
    if (passportStatus === 'IN_PROGRESS') return 'PROCESSING';
    return 'NOT_STARTED';
  };

  const dealRoomStatus = (): StepStatus => {
    if (passportStatus === 'GREEN' || passportStatus === 'LIMITED') return 'PASSED';
    if (passportStatus === 'RED') return 'FAILED';
    return 'NOT_STARTED';
  };

  const steps: Step[] = [
    {
      label: 'Wallet Connected',
      status: walletConnected ? 'PASSED' : 'NOT_STARTED',
    },
    {
      label: 'KYC / AML Verified',
      status: getStepStatus(kycStatus),
    },
    {
      label: 'Accredited Investor',
      status: getStepStatus(accreditedStatus),
    },
    {
      label: 'Passport Issued',
      status: passportStepStatus(),
    },
    {
      label: 'Deal Room Access',
      status: dealRoomStatus(),
    },
  ];

  return (
    <div className="bg-white border border-[#DDE1EA] rounded-2xl p-5 shadow-sm">
      <p className="text-[11px] font-semibold tracking-widest uppercase text-[#4A9EFF] mb-4">
        Compliance Flow
      </p>
      <div className="flex items-start gap-0">
        {steps.map((step, i) => {
          const styles = STEP_STYLES[step.status];
          const isLast = i === steps.length - 1;
          return (
            <div key={step.label} className="flex-1 flex flex-col items-center">
              <div className="flex items-center w-full">
                <div className="flex-1" />
                <div
                  className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold text-white z-10 ${styles.dot}`}
                >
                  {STATUS_ICON[step.status]}
                </div>
                {!isLast && (
                  <div className={`flex-1 h-0.5 ${styles.connector}`} />
                )}
                {isLast && <div className="flex-1" />}
              </div>
              <p className={`text-[10px] font-medium mt-2 text-center leading-tight ${styles.label}`}>
                {step.label}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
