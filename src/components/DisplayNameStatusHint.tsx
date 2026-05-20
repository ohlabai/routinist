'use client';

import type { DisplayNameCheck } from '@/lib/useDisplayNameCheck';

const COLOR: Record<DisplayNameCheck['status'], string> = {
  idle: 'text-gray-400',
  invalid: 'text-rose-500',
  checking: 'text-gray-500',
  available: 'text-emerald-600',
  taken: 'text-rose-500',
  unchanged: 'text-gray-400',
};

const ICON: Partial<Record<DisplayNameCheck['status'], string>> = {
  available: '✓',
  taken: '✕',
  invalid: '✕',
  checking: '…',
};

export default function DisplayNameStatusHint({ check }: { check: DisplayNameCheck }) {
  if (!check.message) return null;
  const icon = ICON[check.status];
  return (
    <p className={`text-xs mt-1 ${COLOR[check.status]}`}>
      {icon ? `${icon} ` : ''}
      {check.message}
    </p>
  );
}
