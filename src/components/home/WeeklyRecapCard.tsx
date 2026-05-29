'use client';

// 주간 회고 카드 — 월요일 자정~정오 사이에 지난 주(월~일) 회고 표시.
// 사용자에게 "한 주 잘 달렸다" 또는 "다음 주 더 달려보자" 동기 부여.
// 시점은 KST 기준 월요일 0~12시.

import { Trophy, TrendingUp } from 'lucide-react';
import { todayStr, daysAgoStr } from '@/lib/kst';
import type { Activity } from '@/types';
import { useI18n } from '@/lib/i18n';

interface Props {
  activities: Activity[];
}

export default function WeeklyRecapCard({ activities }: Props) {
  const { tt, locale } = useI18n();
  // 월요일 정오까지만 표시. 일요일 밤 사용자도 일부 노출 가능 (선택).
  const now = new Date();
  const isMonday = now.getDay() === 1;
  const isMondayMorning = isMonday && now.getHours() < 12;
  if (!isMondayMorning) return null;

  // 지난 주 = 1~7일 전 (오늘이 월요일이면 월요일은 새 주, 1일 전 일요일이 지난 주의 마지막)
  const todayDate = todayStr();
  const weekAgo = daysAgoStr(7);
  const lastWeek = activities.filter(a => a.activity_date >= weekAgo && a.activity_date < todayDate);
  if (lastWeek.length === 0) return null;

  const totalKm = lastWeek.reduce((s, a) => s + Number(a.distance_km), 0);
  const runs = lastWeek.length;
  const longest = lastWeek.reduce<Activity | null>((best, a) =>
    !best || Number(a.distance_km) > Number(best.distance_km) ? a : best,
  null);

  return (
    <div className="card p-4 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 border-emerald-200 dark:border-emerald-800/50">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp size={18} className="text-emerald-500" />
        <h3 className="text-sm font-bold text-[var(--foreground)]">{tt('지난 주 회고')}</h3>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-2xl font-extrabold text-emerald-600">{totalKm.toFixed(1)}</p>
          <p className="text-xs text-[var(--muted)] mt-0.5">{locale === 'en' ? 'Total km' : '총 km'}</p>
        </div>
        <div>
          <p className="text-2xl font-extrabold text-[var(--foreground)]">{runs}</p>
          <p className="text-xs text-[var(--muted)] mt-0.5">{locale === 'en' ? 'Runs' : '러닝'}</p>
        </div>
        <div>
          <p className="text-2xl font-extrabold text-[var(--foreground)]">
            {longest ? Number(longest.distance_km).toFixed(1) : '—'}
          </p>
          <p className="text-xs text-[var(--muted)] mt-0.5">{locale === 'en' ? 'Longest km' : '최장 km'}</p>
        </div>
      </div>
      {longest && (
        <div className="mt-3 pt-3 border-t border-emerald-200/50 dark:border-emerald-800/40 flex items-center gap-2">
          <Trophy size={14} className="text-amber-500 flex-shrink-0" />
          <p className="text-xs text-[var(--muted)]">
            {tt('이번 주 베스트:')}{' '}
            <span className="font-semibold text-[var(--foreground)]">
              {new Date(longest.activity_date).toLocaleDateString(locale === 'en' ? 'en-US' : 'ko-KR', { month: 'short', day: 'numeric' })}
            </span>{' '}
            {Number(longest.distance_km).toFixed(2)}km
          </p>
        </div>
      )}
    </div>
  );
}
