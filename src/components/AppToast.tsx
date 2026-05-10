'use client';

// 공용 토스트 — 흰 배경 + emerald 보더 + emerald-700 텍스트.
// 검정 배경/흰 글씨 디자인은 사진/카드 위에서 튀고, 시각적 피로감 — 일관된 깔끔한 톤.

import { useEffect } from 'react';
import { Check, AlertCircle, X } from 'lucide-react';

export type ToastTone = 'ok' | 'warn' | 'info';

interface Props {
  text: string;
  tone?: ToastTone;
  position?: 'top' | 'bottom';
  onClose?: () => void;
  /** ms — 0 이면 auto-dismiss 안 함 */
  durationMs?: number;
}

export default function AppToast({ text, tone = 'ok', position = 'bottom', onClose, durationMs = 2500 }: Props) {
  useEffect(() => {
    if (!durationMs || !onClose) return;
    const id = setTimeout(onClose, durationMs);
    return () => clearTimeout(id);
  }, [durationMs, onClose]);

  const Icon = tone === 'ok' ? Check : tone === 'warn' ? AlertCircle : null;
  const accent = tone === 'warn' ? 'text-amber-600 border-amber-200' : 'text-emerald-700 border-emerald-200';
  const iconColor = tone === 'warn' ? 'text-amber-500' : 'text-emerald-500';

  return (
    <div
      className={`fixed left-1/2 -translate-x-1/2 z-[80] max-w-[90%] flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-white dark:bg-zinc-900 border ${accent} shadow-lg shadow-emerald-100/40 dark:shadow-black/40 animate-[slide-up_0.2s_ease-out]
        ${position === 'top' ? 'top-16' : 'bottom-24'}`}
      role="status"
    >
      {Icon && <Icon size={16} className={iconColor} />}
      <span className={`text-sm font-semibold whitespace-pre-line ${tone === 'warn' ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-800 dark:text-emerald-200'}`}>
        {text}
      </span>
      {onClose && (
        <button onClick={onClose} className="ml-1 text-[var(--muted)] active:scale-90" aria-label="닫기">
          <X size={14} />
        </button>
      )}
    </div>
  );
}
