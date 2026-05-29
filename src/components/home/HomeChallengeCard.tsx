'use client';

// 이번 주 도전 (build 100, 활성화 강화) — 자동 생성 거리 챌린지.
// 목표 = max(20, min(70, 최근 4주 평균 km × 1.2)). 신규 유저는 부드러운 20km.
// 클라이언트 계산만. 마일리지 보너스는 award_activity_milestones 트리거 기존 시스템 활용.

import { useMemo } from 'react';
import { useUserData } from '@/components/UserDataProvider';
import { startOfWeekStr } from '@/lib/kst';
import { Target, Trophy } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export default function HomeChallengeCard() {
  const { activities } = useUserData();
  const { tt, locale } = useI18n();

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

        <div className="flex items-center gap-2 text-sm font-bold text-[var(--foreground)]">
          <span className="text-lg">{msg.emoji}</span>
          <span>{msg.text}</span>
        </div>
      </div>
    </div>
  );
}
