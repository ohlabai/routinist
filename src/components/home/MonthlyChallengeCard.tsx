'use client';

// 월드런 기본 챌린지 — 매달 42.195km / 100P (2026-07-20 hans).
// "저렴한 기본 챌린지로 매달 풀코스 거리를 달리게 계속 자극" — 홈 + 월드탭 상단 공용 카드.
// 매월 KST 달력월 기준 자동 리셋. 월드투어와 병행 가능한 베이스라인 목표.

import { useCallback, useEffect, useState } from 'react';
import { Flame, Trophy, Coins, CalendarDays, Loader2 } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import {
  fetchMonthlyChallenge,
  joinMonthlyChallenge,
  type MonthlyChallenge,
} from '@/lib/monthly-challenge';
import AppToast from '@/components/AppToast';

export default function MonthlyChallengeCard({ embedded = false }: { embedded?: boolean }) {
  const { user } = useAuth();
  const { locale } = useI18n();
  const [data, setData] = useState<MonthlyChallenge | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [joining, setJoining] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2400);
  };

  const load = useCallback(async () => {
    const d = await fetchMonthlyChallenge();
    setData(d);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchMonthlyChallenge()
      .then(d => { if (!cancelled) setData(d); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

  const handleJoin = async () => {
    setJoining(true);
    try {
      const r = await joinMonthlyChallenge();
      if (r.already_joined) {
        showToast(locale === 'en' ? 'Already joined this month!' : '이미 이달 챌린지에 참가했어요!');
      } else {
        showToast(
          locale === 'en'
            ? `Let's go! -${r.fee_charged}P (balance ${r.balance.toLocaleString()})`
            : `🎉 도전 시작! ${r.fee_charged}P 차감 (잔액 ${r.balance.toLocaleString()})`
        );
      }
      setConfirming(false);
      await load();
    } catch (e) {
      const msg = (typeof e === 'object' && e !== null && 'message' in e && typeof (e as { message: unknown }).message === 'string')
        ? (e as { message: string }).message
        : (locale === 'en' ? 'Failed to join. Please try again.' : '참가에 실패했어요. 잠시 후 다시 시도해주세요');
      showToast(msg, 'warn');
    } finally {
      setJoining(false);
    }
  };

  if (loading || !data) return null;

  const pct = Math.min(100, Math.max(0, (data.progress_km / data.target_km) * 100));
  const remain = Math.max(0, data.target_km - data.progress_km);
  const completed = !!data.completed_at;

  const wrapCls = embedded ? '' : 'mx-4 mt-3';

  return (
    <div className={wrapCls}>
      <div
        className={`rounded-2xl border p-4 shadow-sm ${
          completed
            ? 'bg-gradient-to-br from-amber-50 via-white to-emerald-50/50 dark:from-amber-950/20 dark:via-zinc-900 dark:to-emerald-950/20 border-amber-200/70 dark:border-amber-900/40'
            : 'bg-gradient-to-br from-orange-50 via-white to-rose-50/40 dark:from-orange-950/20 dark:via-zinc-900 dark:to-rose-950/10 border-orange-200/60 dark:border-orange-900/40'
        }`}
      >
        {/* 헤더 */}
        <div className="flex items-center gap-2 mb-3">
          <div className={`w-9 h-9 rounded-2xl flex items-center justify-center ${
            completed ? 'bg-amber-100 dark:bg-amber-900/40' : 'bg-orange-100 dark:bg-orange-900/40'
          }`}>
            {completed
              ? <Trophy size={18} className="text-amber-500" />
              : <Flame size={18} className="text-orange-500" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-[12px] font-extrabold tracking-widest uppercase ${
              completed ? 'text-amber-600 dark:text-amber-400' : 'text-orange-600 dark:text-orange-400'
            }`}>
              {locale === 'en' ? 'Monthly Basic Challenge' : '이달의 기본 챌린지'}
            </p>
            <p className="text-sm font-extrabold text-[var(--foreground)]">
              {locale === 'en' ? 'Full course · 42.195km' : '풀코스 거리 · 42.195km'}
            </p>
          </div>
          {!completed && (
            <span className="inline-flex items-center gap-0.5 text-[13px] font-bold text-[var(--muted)] flex-shrink-0">
              <CalendarDays size={12} />
              {locale === 'en' ? `${data.days_left}d left` : `${data.days_left}일 남음`}
            </span>
          )}
        </div>

        {/* 진행 바 */}
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-sm font-bold text-[var(--foreground)]">
            {completed
              ? (locale === 'en' ? '🎉 Completed!' : '🎉 이달 완주!')
              : (locale === 'en' ? 'This month' : '이달 누적')}
          </span>
          <span className="text-xs font-bold tabular-nums text-[var(--muted)]">
            {data.progress_km.toFixed(1)} / {data.target_km}km
          </span>
        </div>
        <div className="h-2.5 rounded-full bg-[var(--card-border)]/40 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              completed
                ? 'bg-gradient-to-r from-amber-400 to-amber-500'
                : 'bg-gradient-to-r from-orange-400 to-rose-500'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* 상태 문구 + CTA */}
        {completed ? (
          <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mt-2">
            {locale === 'en'
              ? 'A full marathon this month — incredible! See you next month 🔥'
              : '이번 달 풀코스 거리 완주, 대단해요! 다음 달에도 함께 달려요 🔥'}
          </p>
        ) : data.joined ? (
          <p className="text-xs font-semibold text-[var(--muted)] mt-2">
            {locale === 'en'
              ? `${pct.toFixed(0)}% · ${remain.toFixed(1)}km to go this month`
              : `${pct.toFixed(0)}% · 이달 완주까지 ${remain.toFixed(1)}km`}
          </p>
        ) : (
          <>
            <p className="text-xs font-semibold text-[var(--muted)] mt-2 mb-3 leading-relaxed">
              {data.progress_km > 0
                ? (locale === 'en'
                    ? `You've already run ${data.progress_km.toFixed(1)}km this month. Join and finish the full course!`
                    : `이미 이달 ${data.progress_km.toFixed(1)}km 달렸어요. 참가하고 풀코스를 완주해봐요!`)
                : (locale === 'en'
                    ? 'Run a full-marathon distance this month. Just a small entry to keep you going.'
                    : '이번 달 안에 풀코스 거리를 달려봐요. 아주 저렴한 참가비로 나를 자극해요.')}
            </p>
            <button
              onClick={() => setConfirming(true)}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 text-white text-sm font-extrabold active:scale-[0.99] shadow-md shadow-orange-500/25 inline-flex items-center justify-center gap-1.5"
            >
              <Flame size={15} />
              {locale === 'en'
                ? `Join · ${data.entry_fee}P`
                : `도전하기 · ${data.entry_fee}P`}
            </button>
          </>
        )}
      </div>

      {/* 참가 확인 다이얼로그 */}
      {confirming && (
        <div className="fixed inset-0 z-[80] bg-black/65 flex items-center justify-center p-4"
          onClick={() => !joining && setConfirming(false)}>
          <div className="w-full max-w-sm bg-[var(--background)] rounded-3xl p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex flex-col items-center gap-2 mb-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-100 to-rose-50 dark:from-orange-900/40 dark:to-rose-950/40 flex items-center justify-center">
                <Coins size={24} className="text-orange-600" />
              </div>
              <h3 className="text-base font-extrabold text-center">
                🔥 {locale === 'en' ? 'Monthly Full Course' : '이달의 풀코스 챌린지'}
              </h3>
              <p className="text-sm text-[var(--muted)] text-center leading-relaxed">
                {locale === 'en' ? 'Entry ' : '참가비 '}
                <span className="font-extrabold text-orange-600">{data.entry_fee}{locale === 'en' ? 'P' : ' 마일리지'}</span>
                {locale === 'en'
                  ? ` — run 42.195km before this month ends. This month's runs already count!`
                  : ` 차감하고 이달 안에 42.195km 도전!`}
                {locale !== 'en' && <><br />이번 달에 달린 거리도 함께 쌓여요.</>}
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setConfirming(false)} disabled={joining}
                className="flex-1 py-3 rounded-xl bg-[var(--card-border)]/30 font-semibold text-sm disabled:opacity-50">
                {locale === 'en' ? 'Cancel' : '취소'}
              </button>
              <button onClick={handleJoin} disabled={joining}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 text-white font-extrabold text-sm disabled:opacity-50 active:scale-95 inline-flex items-center justify-center gap-1">
                {joining ? <Loader2 size={14} className="animate-spin" /> : <Flame size={14} />}
                {locale === 'en' ? 'Go!' : '출발! 🚀'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2400} />}
    </div>
  );
}
