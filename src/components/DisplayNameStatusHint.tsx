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

// build 169 #5: 닉네임 입력 시 메시지가 조건부 렌더되어 입력창이 위·아래로 흔들리는 jitter 발생.
// 항상 같은 높이의 자리를 차지하도록 min-h-[18px] reserved space 부여 (메시지 없을 땐 빈 박스).
export default function DisplayNameStatusHint({ check }: { check: DisplayNameCheck }) {
  const icon = check.message ? ICON[check.status] : undefined;
  return (
    <p className={`text-xs mt-1 min-h-[18px] leading-[18px] ${COLOR[check.status]}`}>
      {check.message ? `${icon ? `${icon} ` : ''}${check.message}` : '\u00A0'}
    </p>
  );
}
