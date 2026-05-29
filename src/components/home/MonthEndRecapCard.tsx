'use client';

// build 167 #10: 월말 정산 카드 — 매월 마지막 3일 + 다음 달 첫 7일 동안 홈 상단에 표시.
// 이달 km / 일수 / 베스트 페이스 / 신기록 강조. 공유 CTA → ShareCard 동영상.
// 푸시 (enqueue_month_end_recaps) 의 deep_link 와 같은 데이터를 보여줌.

import { useMemo, useState } from 'react';
import { Trophy, Sparkles, Share2 } from 'lucide-react';
import type { Activity } from '@/types';
import ShareCard from '@/components/activity/ShareCard';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';

interface Props {
  activities: Activity[];
}

function paceLabel(sec: number | null | undefined): string {
  if (!sec || sec <= 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}'${String(s).padStart(2, '0')}"`;
}

export default function MonthEndRecapCard({ activities }: Props) {
  const { profile } = useAuth();
  const { tt, locale } = useI18n();
  const [showShare, setShowShare] = useState(false);

  // KST 기준 오늘.
  const now = new Date();
  const today = new Date(now.getTime() + (now.getTimezoneOffset() + 9 * 60) * 60 * 1000);
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1; // 1..12
  const day = today.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  // 표시 윈도우:
  //   (1) 이달 마지막 3일 (lastDay-2 ~ lastDay) → "5월 정산 미리보기"
  //   (2) 다음 달 1~7일 → "5월 정산이 도착했어요!"
  const isEndOfMonth = day >= lastDay - 2 && day <= lastDay;
  const isStartOfNextMonth = day <= 7;
  if (!isEndOfMonth && !isStartOfNextMonth) return null;

  // 대상 월: end-of-month 면 이달, start-of-next-month 면 지난 달
  const targetYear = isEndOfMonth ? year : (month === 1 ? year - 1 : year);
  const targetMonth = isEndOfMonth ? month : (month === 1 ? 12 : month - 1);

  const monthActs = useMemo(() => {
    return activities.filter(a => {
      const d = new Date(a.activity_date);
      return d.getFullYear() === targetYear && d.getMonth() + 1 === targetMonth;
    });
  }, [activities, targetYear, targetMonth]);

  if (monthActs.length === 0) return null;

  const totalKm = monthActs.reduce((s, a) => s + Number(a.distance_km), 0);
  const runDays = new Set(monthActs.map(a => a.activity_date)).size;
  const bestPace = monthActs
    .map(a => a.pace_avg_sec_per_km)
    .filter((p): p is number => !!p && p > 0)
    .reduce<number | null>((min, p) => (min === null || p < min ? p : min), null);
  const longestRun = monthActs.reduce<Activity | null>((best, a) =>
    !best || Number(a.distance_km) > Number(best.distance_km) ? a : best,
  null);

  const monthName = locale === 'en'
    ? new Date(targetYear, targetMonth - 1, 1).toLocaleString('en-US', { month: 'long' })
    : `${targetMonth}월`;
  const headline = isEndOfMonth
    ? (locale === 'en' ? `🌟 ${monthName} is almost over` : `🌟 ${monthName}이 거의 끝나가요`)
    : (locale === 'en' ? `🎉 ${monthName} recap is here!` : `🎉 ${monthName} 정산이 도착했어요!`);
  const sub = isEndOfMonth
    ? tt('한 달 동안 정말 잘 달렸어요. 마지막까지 달려봐요')
    : (locale === 'en' ? 'Great job this month' : '한 달 동안 정말 수고 많으셨어요');

  return (
    <>
      <div className="mx-4 mb-1 rounded-2xl bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 dark:from-amber-950/30 dark:via-orange-950/30 dark:to-rose-950/30 border border-amber-200 dark:border-amber-800 p-4 shadow-md shadow-amber-500/10">
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-shrink-0 w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center shadow-md shadow-amber-500/30">
            <Sparkles size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold text-amber-700 dark:text-amber-300">{headline}</p>
            <p className="text-xs text-amber-700/80 dark:text-amber-300/80 mt-0.5 leading-relaxed">{sub}</p>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2 text-center bg-white/50 dark:bg-black/20 rounded-xl py-3">
          <div>
            <p className="text-lg font-extrabold text-amber-700 dark:text-amber-300">{totalKm.toFixed(1)}</p>
            <p className="text-[10px] text-[var(--muted)] mt-0.5">{locale === 'en' ? 'Total km' : '총 km'}</p>
          </div>
          <div>
            <p className="text-lg font-extrabold text-[var(--foreground)]">{runDays}</p>
            <p className="text-[10px] text-[var(--muted)] mt-0.5">{locale === 'en' ? 'Days run' : '달린 일'}</p>
          </div>
          <div>
            <p className="text-lg font-extrabold text-[var(--foreground)]">{paceLabel(bestPace)}</p>
            <p className="text-[10px] text-[var(--muted)] mt-0.5">{locale === 'en' ? 'Best pace' : '베스트 페이스'}</p>
          </div>
          <div>
            <p className="text-lg font-extrabold text-[var(--foreground)]">{longestRun ? Number(longestRun.distance_km).toFixed(1) : '—'}</p>
            <p className="text-[10px] text-[var(--muted)] mt-0.5">{locale === 'en' ? 'Longest km' : '최장 km'}</p>
          </div>
        </div>

        {longestRun && (
          <button
            onClick={() => setShowShare(true)}
            className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold text-sm shadow-md shadow-amber-500/30 active:scale-[0.99]"
          >
            <Share2 size={14} />
            {locale === 'en' ? `Share ${monthName} best run` : `${monthName} 베스트 러닝 공유하기`}
          </button>
        )}
      </div>

      {showShare && longestRun && (
        <ShareCard
          activity={longestRun}
          displayName={profile?.display_name ?? tt('러너')}
          onClose={() => setShowShare(false)}
        />
      )}
    </>
  );
}
