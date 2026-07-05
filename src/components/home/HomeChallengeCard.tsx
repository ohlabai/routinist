'use client';

// 이번 주 도전 (build 100, 활성화 강화) — 자동 생성 거리 챌린지.
// 목표 = max(20, min(70, 최근 4주 평균 km × 1.2)). 신규 유저는 부드러운 20km.
// 클라이언트 계산만. 마일리지 보너스는 award_activity_milestones 트리거 기존 시스템 활용.

import { useMemo } from 'react';
import Link from 'next/link';
import { useUserData } from '@/components/UserDataProvider';
import { useAuth } from '@/components/AuthProvider';
import { startOfWeekStr, todayStr, toLocalDateStr } from '@/lib/kst';
import { runningOnly } from '@/lib/routinist-data';
import { Target, Trophy, Check, ChevronRight } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export default function HomeChallengeCard() {
  const { activities } = useUserData();
  const { profile } = useAuth();
  const { tt, locale } = useI18n();

  // 습관 형성: 주간 러닝 횟수 목표 (goals 페이지에서 설정, 1~7 또는 미설정)
  const weeklyRunGoal = profile?.weekly_run_goal ?? null;

  // 월~일 7칸 도트 — 달린 날 (러닝만, 걷기 제외) 채움
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
  const weeklyGoalAchieved = weeklyRunGoal !== null && weekRunCount >= weeklyRunGoal;

  const challenge = useMemo(() => {
    const weekStart = startOfWeekStr();
    const fourWeeksAgo = new Date();
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    const fwStr = (() => {
      try {
        return new Intl.DateTimeFormat('en-CA', {
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul',
          year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(fourWeeksAgo);
      } catch {
        return fourWeeksAgo.toISOString().slice(0, 10);
      }
    })();

    let thisWeekKm = 0;
    let last4WeeksKm = 0;
    let runsLast4 = 0;
    activities.forEach(a => {
      if (a.activity_date >= weekStart) thisWeekKm += Number(a.distance_km);
      else if (a.activity_date >= fwStr) {
        last4WeeksKm += Number(a.distance_km);
        runsLast4++;
      }
    });

    const avg = last4WeeksKm / 4;
    let target = Math.max(20, Math.min(70, Math.round(avg * 1.2)));
    // 신규 유저 (활동 적음) — 부드러운 목표
    if (runsLast4 < 2) target = 20;

    const progress = target > 0 ? Math.min(100, (thisWeekKm / target) * 100) : 0;
    const remaining = Math.max(0, target - thisWeekKm);
    const achieved = thisWeekKm >= target;

    return { thisWeekKm, target, progress, remaining, achieved };
  }, [activities]);

  const { thisWeekKm, target, progress, remaining, achieved } = challenge;

  let msg: { emoji: string; text: string };
  if (achieved) msg = { emoji: '🏆', text: tt('이번 주 목표 달성! 멋져요') };
  else if (progress >= 75) msg = { emoji: '🔥', text: locale === 'en' ? `Only ${remaining.toFixed(1)}km left!` : `${remaining.toFixed(1)}km 만 더!` };
  else if (progress >= 50) msg = { emoji: '💪', text: tt('절반 넘어왔어요. 계속!') };
  else if (progress >= 25) msg = { emoji: '🚀', text: locale === 'en' ? 'Great start' : '좋은 시작이에요' };
  else msg = { emoji: '👟', text: tt('이번 주도 한 번 달려볼까요?') };

  return (
    <div className={`mx-4 card p-5 relative overflow-hidden ${
      achieved ? 'achievement-shimmer' : ''
    }`}>
      <div className="relative">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Target size={14} className={achieved ? 'text-amber-600' : 'text-emerald-600'} />
            <h3 className="text-sm font-extrabold text-[var(--foreground)]">{tt('이번 주 도전')}</h3>
          </div>
          {achieved && <Trophy size={16} className="text-amber-500" />}
        </div>

        <div className="flex items-baseline gap-1 mb-2">
          <span className={`text-4xl font-extrabold leading-none ${
            achieved ? 'text-amber-600' : 'text-emerald-600'
          }`}>
            {thisWeekKm.toFixed(1)}
          </span>
          <span className="text-base font-extrabold text-[var(--muted)]">/ {target}km</span>
        </div>

        <div className="h-2.5 bg-[var(--card-border)]/40 rounded-full overflow-hidden mb-3">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              achieved
                ? 'bg-gradient-to-r from-amber-400 to-yellow-500'
                : 'bg-gradient-to-r from-emerald-400 to-emerald-600'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* 습관 형성 — 요일 도트 줄 (월~일). 달린 날 채움 (러닝만). */}
        <div className="mb-3">
          <div className="flex items-start justify-between gap-1">
            {weekDots.map((d, i) => {
              const dayLabels = locale === 'en'
                ? ['M', 'T', 'W', 'T', 'F', 'S', 'S']
                : ['월', '화', '수', '목', '금', '토', '일'];
              return (
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
              );
            })}
          </div>
          {weeklyRunGoal !== null ? (
            <p className={`mt-2 text-xs font-bold text-center ${
              weeklyGoalAchieved ? 'text-amber-600' : 'text-[var(--muted)]'
            }`}>
              {weeklyGoalAchieved
                ? (locale === 'en'
                    ? `🎉 ${weeklyRunGoal} runs this week — weekly goal complete!`
                    : `🎉 주 ${weeklyRunGoal}회 목표 달성! 이번 주도 해냈어요`)
                : (locale === 'en'
                    ? `${weekRunCount}/${weeklyRunGoal} runs this week`
                    : `이번 주 ${weekRunCount}/${weeklyRunGoal}회`)}
            </p>
          ) : (
            <Link
              href="/goals"
              className="mt-2 flex items-center justify-center gap-0.5 text-xs font-bold text-emerald-600 active:scale-95 transition"
            >
              {tt('주 몇 번 달릴까요? 횟수 목표 정하기')}
              <ChevronRight size={13} />
            </Link>
          )}
        </div>

        <div className="flex items-center gap-2 text-sm font-bold text-[var(--foreground)]">
          <span className="text-lg">{msg.emoji}</span>
          <span>{msg.text}</span>
        </div>
      </div>
    </div>
  );
}
