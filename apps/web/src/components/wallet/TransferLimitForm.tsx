'use client';

import { useState } from 'react';

type Props = {
  currentLimit: number;
  onSave: (newLimit: number) => Promise<void>;
};

export function TransferLimitForm({ currentLimit, onSave }: Props) {
  const [value, setValue] = useState(String(currentLimit));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseFloat(value);
    if (isNaN(amount) || amount < 0) {
      setError('Enter a valid amount (0 or greater)');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(amount);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Failed to update limit. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="text-xs text-[#4B5568] block mb-1.5">Daily transfer limit (USDC)</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#9CA3AF]">$</span>
            <input
              type="number"
              min={0}
              step={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full pl-7 pr-3 py-2 text-sm border border-[#DDE1EA] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4A9EFF] focus:border-transparent"
              placeholder="e.g. 5000"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-sm font-semibold bg-[#4A9EFF] hover:bg-[#3a8eef] text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save'}
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </form>
  );
}
