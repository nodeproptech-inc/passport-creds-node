'use client';

import { useRef, useState, useEffect } from 'react';
import type { ClaimType, ClaimStatus } from '@/modules/passport/passport.types';
import { ClaimStatusBadge } from './ClaimStatusBadge';
import { formatTxHash } from '@/lib/format';

type Props = {
  title: string;
  description: string;
  claimType: ClaimType;
  status: ClaimStatus;
  summary?: string;
  confidence?: number;
  transactionHash?: string;
  sampleUrl?: string;
  onStartVerification?: () => void;
  onSubmitDocument?: (file: File) => void;
  onSimulate?: () => void;
  onSyncOnchain?: () => void;
  isStarting?: boolean;
  isSubmitting?: boolean;
  isSimulating?: boolean;
  verificationId?: string;
};

export function EvidenceCard({
  title,
  description,
  status,
  summary,
  confidence,
  transactionHash,
  sampleUrl,
  onSubmitDocument,
  onSimulate,
  onSyncOnchain,
  isSubmitting,
  isSimulating,
  verificationId,
}: Props) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isActive = status === 'PENDING' || status === 'PROCESSING';
  const prevSubmitting = useRef(false);

  // Clear file only after submission finishes (isSubmitting flips false)
  useEffect(() => {
    if (prevSubmitting.current && !isSubmitting) {
      setSelectedFile(null);
      if (inputRef.current) inputRef.current.value = '';
    }
    prevSubmitting.current = !!isSubmitting;
  }, [isSubmitting]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
  }

  function handleSubmit() {
    if (selectedFile && onSubmitDocument) {
      onSubmitDocument(selectedFile);
      // keep selectedFile set — cleared by parent when isSubmitting turns false
    }
  }

  return (
    <div className="bg-white border border-[#DDE1EA] rounded-2xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-[11px] font-semibold tracking-widest uppercase text-[#4A9EFF] mb-1">
            Compliance Evidence
          </p>
          <h3 className="text-base font-semibold text-[#0D1428]">{title}</h3>
        </div>
        <ClaimStatusBadge status={status} />
      </div>

      <p className="text-sm text-[#4B5568] mb-3">{description}</p>

      {sampleUrl && status === 'UNVERIFIED' && (
        <a
          href={sampleUrl}
          download
          className="inline-flex items-center gap-1.5 text-xs text-[#4A9EFF] hover:underline mb-4"
        >
          <span>↓</span> Download sample document
        </a>
      )}

      {summary && (
        <div className="bg-[#F8F9FC] border border-[#DDE1EA] rounded-xl p-3 mb-3">
          <p className="text-[11px] font-semibold tracking-widest uppercase text-[#9CA3AF] mb-1">
            AI Attester Summary
          </p>
          <p className="text-sm text-[#4B5568]">{summary}</p>
          {confidence !== undefined && (
            <p className="text-xs text-[#9CA3AF] mt-1">Confidence: {Math.round(confidence * 100)}%</p>
          )}
        </div>
      )}

      {transactionHash && (
        <div className="mb-3">
          <p className="text-[11px] font-semibold tracking-widest uppercase text-[#9CA3AF] mb-1">
            Transaction
          </p>
          <p className="font-mono text-xs text-[#4A9EFF]">{formatTxHash(transactionHash)}</p>
        </div>
      )}

      {status === 'UNVERIFIED' && onSubmitDocument && (
        <div className="mt-4 space-y-2">
          <input
            ref={inputRef}
            type="file"
            accept=".txt,.pdf"
            onChange={handleFileChange}
            className="hidden"
            id={`file-upload-${title}`}
          />

          {!selectedFile ? (
            <label
              htmlFor={`file-upload-${title}`}
              className="flex items-center gap-2 cursor-pointer text-sm font-semibold px-4 py-2 rounded-lg border-2 border-dashed border-[#DDE1EA] text-[#4B5568] hover:border-[#4A9EFF] hover:text-[#4A9EFF] transition-colors w-full justify-center"
            >
              <span>📄</span> Upload Compliance Document
            </label>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-[#F8F9FC] border border-[#DDE1EA] rounded-lg px-3 py-2 text-xs text-[#4B5568] truncate">
                📄 {selectedFile.name}
              </div>
              <button
                onClick={() => {
                  setSelectedFile(null);
                  if (inputRef.current) inputRef.current.value = '';
                }}
                className="text-xs text-[#9CA3AF] hover:text-red-400 px-1"
                title="Remove file"
              >
                ✕
              </button>
            </div>
          )}

          {(selectedFile || isSubmitting) && (
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="w-full text-sm font-semibold px-4 py-2 rounded-lg bg-[#0D1428] text-white hover:bg-[#141E38] transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {isSubmitting && (
                <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              )}
              {isSubmitting ? 'Submitting to AI Attester...' : 'Submit for Verification'}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-4">
        {isActive && onSyncOnchain && verificationId && (
          <button
            onClick={onSyncOnchain}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#4A9EFF] text-[#4A9EFF] hover:bg-blue-50 transition-colors"
          >
            Sync Onchain
          </button>
        )}

        {onSimulate &&
          (status === 'UNVERIFIED' ||
            status === 'PENDING' ||
            status === 'PROCESSING' ||
            status === 'FAILED') && (
            <button
              onClick={onSimulate}
              disabled={isSimulating}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-dashed border-[#9CA3AF] text-[#9CA3AF] hover:border-[#4A9EFF] hover:text-[#4A9EFF] transition-colors disabled:opacity-50"
              title="Demo only — bypasses real AI Attester"
            >
              {isSimulating ? 'Simulating...' : '⚡ Demo: Simulate Verified'}
            </button>
          )}
      </div>
    </div>
  );
}
