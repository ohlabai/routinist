'use client';

// 주간 스트릭 경고 카드 (습관 코어 C1, 2026-07-11 — 일 단위 → 주 단위 전환).
// 유저 전원이 주 2~4회 러너라 "오늘 자정까지" 일 단위 경고는 62명 중 2명에게만 작동했음.
//
//  - 경고 모드: 이번 주 미달성 + 남은 날 ≤ 2일 (토/일) + 지킬 스트릭 ≥ 1주
//    → "이번 주 X번만 더 달리면 N주 연속!" (기존 18시 게이트 제거 — 주말 게이트로 대체).
//  - 구출 모드: 지난주가 비어 스트릭이 이미 죽었지만, 보호권으로 지난주를 메꾸면 이어지는 경우
//    → [보호권 쓰기]. use_streak_freeze RPC 의 날짜 창 (어제/그제까지만 허용) 때문에
//    지난주에 속하는 어제·그제가 있는 월/화요일에만 실제로 성립.
//    보호권은 주 단위 재해석: 사용일이 포함된 "빈 주 1개" 를 통째로 메꿈.

import { useEffect, useMemo, useState } from 'react';
import { Flame, Shield } from 'lucide-react';
import { todayStr, daysAgoStr, startOfWeekStr } from '@/lib/kst';
import { getWeeklyStreak, addDaysStr, runningOnly } from '@/lib/routinist-data';
import type { Activity } from '@/types';
import { useI18n } from '@/lib/i18n';
import AppToast from '@/components/AppToast';

interface Props {
  activities: Activity[];
  /** 보호권 반영된 현재 주간 스트릭 (dashboard 에서 getWeeklyStreak(activities, goal, freezeUses)) */
  weeklyStreak: number;
  /** profiles.weekly_run_goal 원값 (미설정 null) — 달성 기준 = max(1, goal ?? 1) */
  weeklyGoal: number | null;
  /** 이번 주 러닝 일수 (m/goal 진행) */
  thisWeekRunDays: number;
  /** 보유 보호권 수 (RPC 실패/미배포 시 0) */
  freezeCount?: number;
  /** 최근 60일 보호권 사용일 Set */
  freezeUses?: Set<string>;
  /** 보호권 사용 성공 후 호출 — dashboard 가 freeze 상태 재조회 → 스트릭/카드 갱신 */
  onFreezeUsed?: () => void;
}

export default function StreakWarningCard({
  activities, weeklyStreak, weeklyGoal, thisWeekRunDays, freezeCount = 0, freezeUses, onFreezeUsed,
}: Props) {
  const { tt, locale } = useI18n();
  // 1분 tick 으로 날짜/요일 변화 감지 — 금요일 밤에 mount 한 채 토요일로 넘어가도 표시.
  const [today, setToday] = useState(() => todayStr());
  useEffect(() => {
    const id = setInterval(() => setToday(todayStr()), 60_000);
    return () => clearInterval(id);
  }, []);

  const [using, setUsing] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const goal = Math.max(1, weeklyGoal ?? 1);
  const thisWeekStart = startOfWeekStr();
  const lastWeekStart = addDaysStr(thisWeekStart, -7);

  // 이번 주 달성 여부 — 러닝 일수 또는 보호권 사용일이 이번 주에 있으면 달성.
  const thisWeekCovered =
    thisWeekRunDays >= goal ||
    [...(freezeUses ?? [])].some(d => d >= thisWeekStart);

  // 구출 모드: 지난주가 통째로 비어 스트릭이 죽었을 때, 보호권으로 지난주를 메꾸면 살아나는 스트릭.
  // use_streak_freeze 는 어제/그제까지만 허용 → 지난주에 속하는 가장 최근 spendable 날짜를 찾는다.
  const yesterday = daysAgoStr(1);
  const dayBefore = daysAgoStr(2);
  const rescueDate =
    yesterday >= lastWeekStart && yesterday < thisWeekStart ? yesterday
    : dayBefore >= lastWeekStart && dayBefore < thisWeekStart ? dayBefore
    : null;

  // 지난주 실제 달린 일수 — "쉬어갔어요" (0일) 와 "목표 미달" (1일~) 카피를 구분.
  // 주 5회 목표 유저가 3일 달리고도 "쉬어갔어요" 를 보면 버그로 오인한다 (2026-08-10 hans 신고).
  const lastWeekRunDays = useMemo(() => {
    const days = new Set(
      runningOnly(activities)
        .map(a => a.activity_date)
        .filter(d => d >= lastWeekStart && d < thisWeekStart)
    );
    return days.size;
  }, [activities, lastWeekStart, thisWeekStart]);

  const rescueStreak = useMemo(() => {
    if (weeklyStreak > 0 || thisWeekCovered || !rescueDate) return 0;
    const merged = new Set(freezeUses ?? []);
    merged.add(rescueDate);
    return getWeeklyStreak(activities, weeklyGoal, merged);
  }, [activities, weeklyGoal, weeklyStreak, thisWeekCovered, freezeUses, rescueDate]);
  // >=2 (보호권 주 + 그 전의 실제 달성 주 체인) 여야 지킬 가치가 있음.
  const rescueMode = rescueStreak >= 2 && freezeCount > 0;
  // build 299: 보호권 0개인데 지킬 스트릭이 있으면 100P 구매 제안 (월 1개 무료 + 추가 구매)
  const buyMode = rescueStreak >= 2 && freezeCount <= 0;

  const handleUseFreeze = async () => {
    if (using || !rescueDate) return;
    setUsing(true);
    try {
      const { spendStreakFreeze } = await import('@/lib/streak-freeze');
      const r = await spendStreakFreeze(rescueDate);
      if (r.ok) {
        const remainTail = typeof r.remaining === 'number'
          ? (locale === 'en' ? ` (${r.remaining} left)` : ` (남은 보호권 ${r.remaining}개)`)
          : '';
        setToast({
          text: (locale === 'en'
            ? `Last week is covered — your streak lives on! 🛡️`
            : `보호권으로 지난주를 메꿨어요 — 연속 기록이 이어져요! 🛡️`) + remainTail,
          tone: 'ok',
        });
        onFreezeUsed?.();
      } else if (r.reason === 'already_covered') {
        setToast({ text: tt('지난주는 이미 지켜져 있어요'), tone: 'ok' });
        onFreezeUsed?.();
      } else if (r.reason === 'no_freezes') {
        setToast({ text: tt('남은 보호권이 없어요'), tone: 'warn' });
        onFreezeUsed?.();
      } else {
        setToast({ text: tt('지금은 보호권을 쓸 수 없어요. 잠시 후 다시 시도해주세요'), tone: 'warn' });
      }
    } finally {
      setUsing(false);
    }
  };

  if (thisWeekCovered) return null;

  // ---- 구출 모드 (요일 게이트 없음 — 날짜 창이 지나면 지난주를 메꿀 수 없게 됨) ----
  // build 299: 보호권 없음 + 지킬 스트릭 있음 → 구매 후 즉시 사용 (100P)
  const handleBuyAndUse = async () => {
    if (using || !rescueDate) return;
    setUsing(true);
    try {
      const { buyStreakFreeze, spendStreakFreeze } = await import('@/lib/streak-freeze');
      const b = await buyStreakFreeze();
      if (!b.ok) {
        setToast({
          text: b.error === 'insufficient_balance'
            ? (locale === 'en' ? 'Not enough mileage (100P needed)' : '마일리지가 부족해요 (100P 필요)')
            : tt('지금은 보호권을 쓸 수 없어요. 잠시 후 다시 시도해주세요'),
          tone: 'warn',
        });
        return;
      }
      const r = await spendStreakFreeze(rescueDate);
      if (r.ok) {
        setToast({
          text: locale === 'en'
            ? 'Freeze bought (−100P) — your streak lives on! 🛡️'
            : '보호권 구매 (−100P) — 연속 기록이 이어져요! 🛡️',
          tone: 'ok',
        });
        onFreezeUsed?.();
      } else {
        // 구매는 됐는데 사용 실패 — 보호권은 보유 상태로 남음 (다음 시도 가능)
        setToast({ text: tt('지금은 보호권을 쓸 수 없어요. 잠시 후 다시 시도해주세요'), tone: 'warn' });
        onFreezeUsed?.();
      }
    } finally {
      setUsing(false);
    }
  };

  if (rescueMode || buyMode) {
    return (
      <>
        <div className="card p-4 bg-gradient-to-r from-sky-50 to-emerald-50 dark:from-sky-950/30 dark:to-emerald-950/30 border-emerald-200 dark:border-emerald-800/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
              <Shield size={22} className="text-emerald-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-[var(--foreground)]">
                {lastWeekRunDays > 0
                  ? (locale === 'en'
                      ? `Last week fell just short (${lastWeekRunDays}/${goal} days) — you can still save your ${rescueStreak}-week streak`
                      : `지난주는 목표에 조금 못 미쳤어요 (${lastWeekRunDays}/${goal}일) — 아직 ${rescueStreak}주 연속을 지킬 수 있어요`)
                  : (locale === 'en'
                      ? `Last week was a rest week — you can still save your ${rescueStreak}-week streak`
                      : `지난주는 쉬어갔어요 — 아직 ${rescueStreak}주 연속을 지킬 수 있어요`)}
              </p>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                {buyMode
                  ? (locale === 'en'
                      ? 'No freezes left · buy one for 100P and your streak carries on'
                      : '보호권이 없어요 · 100P 로 구매하면 연속 기록이 이어져요')
                  : (locale === 'en'
                      ? `${freezeCount} freeze${freezeCount === 1 ? '' : 's'} left · skip a week and your streak carries on`
                      : `보호권 ${freezeCount}개 보유 · 한 주를 건너뛰어도 연속 기록이 이어져요`)}
              </p>
            </div>
            <button
              onClick={buyMode ? handleBuyAndUse : handleUseFreeze}
              disabled={using}
              className="flex-shrink-0 px-3.5 py-2 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-sm font-extrabold shadow-md shadow-emerald-500/30 active:scale-95 transition disabled:opacity-50"
            >
              {using ? tt('사용 중...') : buyMode ? (locale === 'en' ? 'Buy & use (100P)' : '구매 후 사용 (100P)') : tt('보호권 쓰기')}
            </button>
          </div>
        </div>
        {toast && (
          <AppToast text={toast.text} tone={toast.tone} position="top" onClose={() => setToast(null)} durationMs={3000} />
        )}
      </>
    );
  }

  // ---- 경고 모드 ----
  // 조건:
  // 1) 이번 주 남은 날 ≤ 2일 — 토(6)/일(0). 주중엔 아직 시간 충분 → 알림 부담 X.
  // 2) 이번 주 미달성 (위에서 체크)
  // 3) weeklyStreak >= 1 (끊길 게 있어야 위협)
  const [ty, tm, td] = today.split('-').map(Number);
  const dow = new Date(ty, tm - 1, td).getDay();
  const isWeekend = dow === 6 || dow === 0;
  if (!isWeekend) return null;
  if (weeklyStreak < 1) return null;

  const runsLeft = Math.max(1, goal - thisWeekRunDays);

  return (
    <>
      <div className="card p-4 bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-950/30 dark:to-red-950/30 border-orange-200 dark:border-orange-800/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-orange-500/15 flex items-center justify-center flex-shrink-0">
            <Flame size={22} className="text-orange-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-[var(--foreground)]">
              {locale === 'en'
                ? `${runsLeft} more run${runsLeft === 1 ? '' : 's'} this week makes it a ${weeklyStreak + 1}-week streak!`
                : `이번 주 ${runsLeft}번만 더 달리면 ${weeklyStreak + 1}주 연속!`}
            </p>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              {locale === 'en'
                ? `The week wraps up Sunday — a short 1km counts too`
                : `일요일까지예요 — 짧게 1km 만 달려도 채워져요`}
            </p>
            {/* 보호권 보유 안내 — 이번 주를 통째로 쉬어도 다음 주 초에 메꿀 수 있음 (안심 문구만) */}
            {freezeCount > 0 && (
              <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 mt-1 flex items-center gap-1">
                <Shield size={12} className="flex-shrink-0" />
                {locale === 'en'
                  ? `${freezeCount} streak freeze${freezeCount === 1 ? '' : 's'} in your pocket — even a skipped week can be covered`
                  : `보호권 ${freezeCount}개 보유 — 이번 주를 건너뛰어도 연속 기록을 이을 수 있어요`}
              </p>
            )}
          </div>
        </div>
      </div>
      {toast && (
        <AppToast text={toast.text} tone={toast.tone} position="top" onClose={() => setToast(null)} durationMs={3000} />
      )}
    </>
  );
}
