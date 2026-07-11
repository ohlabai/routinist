'use client';

// 주간 목표 원탭 카드 (습관 코어 C2, 2026-07-11).
// 배경: weekly_run_goal 설정자 1/62명 — 설정 UI 가 /goals 구석에만 있어 발견성 문제.
//  - 미설정: "이번 주 몇 번 달릴까요?" + [주 2회][주 3회][주 4회] 원탭 → profiles UPDATE
//    (goals 페이지의 optimistic 저장 패턴 재사용) → 설정 즉시 같은 자리가 진행 카드로 전환.
//  - 설정: 이번 주 m/N회 + 월~일 요일 도트 (기존 HomeChallengeCard 도트 패턴 이전 —
//    도트/횟수 노출은 이 카드가 단일 소유. HomeChallengeCard 쪽 중복 노출은 정리됨).
// 신규 러너 모드에서도 렌더 (dashboard 배선 참조).

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/components/UserDataProvider';
import { startOfWeekStr, todayStr, toLocalDateStr } from '@/lib/kst';
import { runningOnly } from '@/lib/routinist-data';
import { CalendarCheck, Check, ChevronRight, Flame } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import AppToast from '@/components/AppToast';

const ONE_TAP_PRESETS = [2, 3, 4];

interface Props {
  /** 보호권 반영된 현재 주간 스트릭 — 설정자 진행 카드에 "🔥 N주 연속" 칩 표시 */
  weeklyStreak?: number;
}

export default function WeeklyGoalCard({ weeklyStreak = 0 }: Props) {
  const { user, profile, refreshProfile } = useAuth();
  const { activities } = useUserData();
  const { tt, locale } = useI18n();

  // goals 페이지와 동일한 optimistic 패턴 — 탭 즉시 저장, 실패 시 rollback.
  const [goal, setGoal] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const [justSet, setJustSet] = useState(false); // 설정 직후 축하 라인 1회
  useEffect(() => {
    setGoal(profile?.weekly_run_goal ?? null);
  }, [profile?.weekly_run_goal]);

  // 월~일 7칸 도트 — 달린 날 (러닝만, 걷기 제외) 채움. HomeChallengeCard 에서 이전.
  const weekDots = useMemo(() => {
    const weekStart = startOfWeekStr(); // 월요일
    const today = todayStr();
    const ranDays = new Set(
      runningOnly(activities)
        .filter(a => a.activity_date >= weekStart)
        .map(a => a.activity_date)
    );
    const [wy, wm, wd] = weekStart.split('-').map(Number);
    const dots: { date: string; ran: boolean; isToday: boolean }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(wy, wm - 1, wd + i); // 로컬 자정 기준 — UTC 파싱 밀림 없음
      const ds = toLocalDateStr(d);
      dots.push({ date: ds, ran: ranDays.has(ds), isToday: ds === today });
    }
    return dots;
  }, [activities]);
  const weekRunCount = weekDots.filter(d => d.ran).length;

  const handleSetGoal = async (n: number) => {
    if (!user || saving) return;
    const prev = goal;
    setSaving(true);
    setGoal(n); // optimistic — 같은 자리가 즉시 진행 카드로 전환
    setJustSet(true);
    try {
      const { getSupabase } = await import('@/lib/supabase');
      const { error } = await getSupabase()
        .from('profiles')
        .update({ weekly_run_goal: n, updated_at: new Date().toISOString() })
        .eq('id', user.id);
      if (error) throw error;
      refreshProfile().catch(() => {}); // 스트릭 계산이 profile 을 읽음 — 실패해도 저장은 완료
      setToast({
        text: locale === 'en' ? `Weekly goal set — ${n} runs a week!` : `주 ${n}회 목표 설정 완료!`,
        tone: 'ok',
      });
    } catch (e) {
      console.warn('[home] weekly_run_goal 저장 실패', e);
      setGoal(prev); // rollback
      setJustSet(false);
      setToast({ text: tt('저장하지 못했어요. 잠시 후 다시 시도해주세요'), tone: 'warn' });
    } finally {
      setSaving(false);
    }
  };

  const dayLabels = locale === 'en'
    ? ['M', 'T', 'W', 'T', 'F', 'S', 'S']
    : ['월', '화', '수', '목', '금', '토', '일'];

  // ---- 미설정: 원탭 설정 카드 ----
  if (goal === null) {
    return (
      <>
        <div className="mx-4 card p-5">
          <div className="flex items-center gap-1.5 mb-1">
            <CalendarCheck size={14} className="text-emerald-600" />
            <h3 className="text-sm font-extrabold text-[var(--foreground)]">{tt('주간 목표')}</h3>
          </div>
          <p className="text-base font-bold text-[var(--foreground)] mb-1">
            {tt('이번 주 몇 번 달릴까요?')}
          </p>
          <p className="text-xs text-[var(--muted)] mb-3">
            {tt('거리보다 꾸준함! 횟수 목표를 채우면 주간 연속 기록이 쌓여요')}
          </p>
          <div className="flex gap-2">
            {ONE_TAP_PRESETS.map(n => (
              <button
                key={n}
                onClick={() => handleSetGoal(n)}
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-sm font-extrabold bg-gradient-to-br from-emerald-50 to-emerald-100/60 dark:from-emerald-950/40 dark:to-emerald-900/30 border border-emerald-200/60 dark:border-emerald-800/40 text-emerald-800 dark:text-emerald-200 active:scale-95 transition disabled:opacity-60"
              >
                {locale === 'en' ? `${n}×/week` : `주 ${n}회`}
              </button>
            ))}
          </div>
          <Link
            href="/goals"
            className="mt-2.5 flex items-center justify-center gap-0.5 text-xs font-semibold text-[var(--muted)] active:scale-95 transition"
          >
            {tt('다른 횟수로 정하기')}
            <ChevronRight size={12} />
          </Link>
        </div>
        {toast && (
          <AppToast text={toast.text} tone={toast.tone} position="top" onClose={() => setToast(null)} durationMs={2500} />
        )}
      </>
    );
  }

  // ---- 설정됨: 이번 주 진행 카드 (도트 + m/N회) ----
  const achieved = weekRunCount >= goal;

  return (
    <>
      <div className={`mx-4 card p-5 relative overflow-hidden ${achieved ? 'achievement-shimmer' : ''}`}>
        <div className="relative">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <CalendarCheck size={14} className={achieved ? 'text-amber-600' : 'text-emerald-600'} />
              <h3 className="text-sm font-extrabold text-[var(--foreground)]">{tt('주간 목표')}</h3>
            </div>
            <div className="flex items-center gap-2">
              {weeklyStreak >= 1 && (
                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-orange-500/10 text-[11px] font-extrabold text-orange-600">
                  <Flame size={11} />
                  {locale === 'en' ? `${weeklyStreak}-week streak` : `${weeklyStreak}주 연속`}
                </span>
              )}
              <Link href="/goals" className="text-xs font-semibold text-[var(--muted)] flex items-center gap-0.5 active:scale-95 transition">
                {tt('수정')}
                <ChevronRight size={12} />
              </Link>
            </div>
          </div>

          <div className="flex items-baseline gap-1 mb-3">
            <span className={`text-4xl font-extrabold leading-none ${achieved ? 'text-amber-600' : 'text-emerald-600'}`}>
              {weekRunCount}
            </span>
            <span className="text-base font-extrabold text-[var(--muted)]">
              {locale === 'en' ? `/ ${goal} runs` : `/ ${goal}회`}
            </span>
          </div>

          <div className="flex items-start justify-between gap-1 mb-2">
            {weekDots.map((d, i) => (
              <div key={d.date} className="flex flex-col items-center gap-1 flex-1">
                <span className={`text-[10px] font-bold ${d.isToday ? 'text-emerald-600' : 'text-[var(--muted)]'}`}>
                  {dayLabels[i]}
                </span>
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                    d.ran
                      ? 'bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-sm shadow-emerald-500/30'
                      : d.isToday
                        ? 'border-2 border-emerald-400 border-dashed'
                        : 'border-2 border-[var(--card-border)] border-dashed'
                  }`}
                >
                  {d.ran && <Check size={14} strokeWidth={3} />}
                </div>
              </div>
            ))}
          </div>

          <p className={`text-xs font-bold text-center ${achieved ? 'text-amber-600' : 'text-[var(--muted)]'}`}>
            {achieved
              ? (locale === 'en'
                  ? `🎉 ${goal} runs this week — weekly goal complete!`
                  : `🎉 주 ${goal}회 목표 달성! 이번 주도 해냈어요`)
              : justSet
                ? tt('좋아요! 이번 주부터 하나씩 채워봐요')
                : (locale === 'en'
                    ? `${Math.max(0, goal - weekRunCount)} more to go this week`
                    : `이번 주 ${Math.max(0, goal - weekRunCount)}번 남았어요`)}
          </p>
        </div>
      </div>
      {toast && (
        <AppToast text={toast.text} tone={toast.tone} position="top" onClose={() => setToast(null)} durationMs={2500} />
      )}
    </>
  );
}
