'use client';

// 배지 획득 축하 모달 (습관 형성 — 획득 순간을 놓치지 않고 축하).
// dashboard 의 check_and_award_achievements 반환에서 newly_awarded===true 인 배지만 표시.
// 여러 개면 dashboard 가 큐로 순차 표시 (key=code 로 리마운트 → 애니메이션 재생).
// 남발 방지는 호출부 localStorage `badge_celebrated:{code}` 1회 가드.
// "공유하기" 는 실제 공유 시트 대신 프로필 배지 목록으로 링크만 (스펙).

import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { ACHIEVEMENTS } from '@/lib/achievements-data';

interface Props {
  code: string;
  onClose: () => void;
}

export default function BadgeCelebration({ code, onClose }: Props) {
  const { tt } = useI18n();
  const { user } = useAuth();
  const def = ACHIEVEMENTS[code];
  if (!def) return null; // 호출부에서 필터하지만 방어

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-6 bg-black/50 backdrop-blur-sm"
      style={{ animation: 'fadeIn 0.2s ease-out' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-xs rounded-3xl bg-white dark:bg-zinc-900 border border-emerald-200/60 dark:border-emerald-800/40 shadow-2xl shadow-emerald-500/20 p-6 text-center overflow-hidden animate-fade-in"
        onClick={e => e.stopPropagation()}
      >
        {/* confetti 느낌 — 기존 confettiFloat keyframe 재사용 */}
        <div className="pointer-events-none absolute inset-x-2 top-2 flex justify-between text-xl" aria-hidden>
          <span className="confetti-emoji">🎉</span>
          <span className="confetti-emoji">✨</span>
          <span className="confetti-emoji">🎊</span>
          <span className="confetti-emoji">✨</span>
          <span className="confetti-emoji">🎉</span>
        </div>

        <p className="mt-3 text-xs font-extrabold tracking-wide text-emerald-600 dark:text-emerald-400 uppercase">
          {tt('새 배지 획득!')}
        </p>

        <div className="my-4 badge-pop">
          <span className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950/60 dark:to-emerald-900/40 border-2 border-emerald-200/70 dark:border-emerald-800/50 text-5xl leading-none">
            {def.emoji}
          </span>
        </div>

        <h3 className="text-xl font-extrabold text-[var(--foreground)]">{tt(def.name)}</h3>
        <p className="text-sm text-[var(--muted)] mt-1">{tt(def.description)}</p>

        <div className="mt-5 space-y-2">
          <Link
            href={user ? `/social/user?id=${user.id}` : '/profile'}
            onClick={onClose}
            className="block w-full py-3 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold shadow-md shadow-emerald-500/30 active:scale-95 transition"
          >
            {tt('내 배지 자랑하러 가기')}
          </Link>
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl text-sm font-bold text-[var(--muted)] active:scale-95 transition"
          >
            {tt('닫기')}
          </button>
        </div>
      </div>
    </div>
  );
}
