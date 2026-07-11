'use client';

// build 299: Apple Health 환영 sync 완료 시트 — 첫 로그인 background sync 가
// 러닝을 가져오면 (synced > 0) 1회만 하단 슬라이드 시트로 축하.
// 신규 유저 대부분이 import 경로인데 (활동 99%) 지금까지 보상 순간이 아예 없었음.
// @capacitor/local-notifications 미설치 프로젝트라 알림 예약 대신 격려 문구 + 닫기만 (스펙 폴백).
// 노출 1회 보장은 호출부 (layout) 의 localStorage `welcome_sync_celebrated:{userId}` 키.

import { ttl } from '@/lib/i18n';

interface Props {
  /** 환영 sync 로 가져온 활동 수 (> 0 일 때만 렌더하도록 호출부에서 보장) */
  count: number;
  onClose: () => void;
}

export default function WelcomeSyncSheet({ count, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 backdrop-blur-sm"
      style={{ animation: 'fadeIn 0.2s ease-out' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-lg rounded-t-3xl bg-[var(--background)] border-t border-emerald-200/60 dark:border-emerald-800/40 shadow-2xl shadow-emerald-500/20 px-6 pt-7 pb-[max(env(safe-area-inset-bottom),20px)] text-center animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        {/* confetti 느낌 — BadgeCelebration 과 같은 confettiFloat keyframe 재사용 */}
        <div className="pointer-events-none absolute inset-x-4 top-3 flex justify-between text-xl" aria-hidden>
          <span className="confetti-emoji">🎉</span>
          <span className="confetti-emoji">✨</span>
          <span className="confetti-emoji">🎉</span>
        </div>

        <div className="badge-pop">
          <span className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950/60 dark:to-emerald-900/40 border-2 border-emerald-200/70 dark:border-emerald-800/50 text-4xl leading-none">
            🎉
          </span>
        </div>

        <h3 className="mt-4 text-xl font-extrabold text-[var(--foreground)]">
          {ttl('러닝 {n}개를 가져왔어요!').replace('{n}', count.toLocaleString())}
        </h3>
        <p className="mt-1.5 text-sm text-[var(--muted)]">
          {ttl('지금까지의 기록이 모두 준비됐어요.')}
        </p>
        <p className="mt-0.5 text-sm font-bold text-emerald-600 dark:text-emerald-400">
          {ttl('이번 주 첫 러닝, 가볍게 달려볼까요? 👟')}
        </p>

        <button
          onClick={onClose}
          className="mt-6 w-full py-3.5 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-base shadow-md shadow-emerald-500/30 active:scale-[0.98] transition"
        >
          {ttl('좋아요, 시작할게요!')}
        </button>
      </div>
    </div>
  );
}
