'use client';

// "작년 오늘의 나" 회고 카드 (Day One 스타일).
// 2026-04-21 컨셉 피벗 일환 — 재진입/감정 훅. 누적 러닝이 적은 유저에게는 노출 X.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Clock, Sparkles } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';

interface OnThisDayActivity {
  activity_id: string;
  distance_km: number;
  activity_date: string;
  duration_seconds: number | null;
  pace_per_km: number | null;
  years_ago: number;
}

export default function OnThisDayCard() {
  const { user } = useAuth();
  const { locale } = useI18n();
  const [activity, setActivity] = useState<OnThisDayActivity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        const today = new Date();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const thisYear = today.getFullYear();

        // 과거 같은 월일 활동 검색 (5년까지)
        const { data } = await supabase
          .from('activities')
          .select('id, distance_km, activity_date, duration_seconds')
          .eq('user_id', user.id)
          .lt('activity_date', `${thisYear}-01-01`)
          .gte('activity_date', `${thisYear - 5}-${mm}-${dd}`)
          .order('activity_date', { ascending: false });

        if (!data || data.length === 0) {
          if (!cancelled) setLoading(false);
          return;
        }

        // 월/일 일치 찾기 (이번 년 제외)
        const match = data.find(a => {
          const [, m, d] = a.activity_date.split('-');
          return m === mm && d === dd;
        });

        if (!match) {
          if (!cancelled) setLoading(false);
          return;
        }

        const pastYear = parseInt(match.activity_date.split('-')[0], 10);
        const pace = match.duration_seconds && match.distance_km
          ? match.duration_seconds / match.distance_km
          : null;

        if (!cancelled) {
          setActivity({
            activity_id: match.id,
            distance_km: Number(match.distance_km),
            activity_date: match.activity_date,
            duration_seconds: match.duration_seconds,
            pace_per_km: pace,
            years_ago: thisYear - pastYear,
          });
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (loading || !activity) return null;

  return (
    <Link
      href={`/activity?id=${activity.activity_id}`}
      className="mx-4 mt-4 block rounded-3xl bg-gradient-to-br from-purple-100 via-pink-50 to-amber-50 dark:from-purple-950/30 dark:via-pink-950/20 dark:to-amber-950/20 border border-purple-200/50 dark:border-purple-900/30 p-5 shadow-sm active:scale-[0.99] transition"
    >
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center shadow-md flex-shrink-0">
          <Clock size={22} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 text-xs font-bold text-purple-600 dark:text-purple-400">
            <Sparkles size={12} />
            {locale === 'en'
              ? (activity.years_ago === 1 ? 'A year ago today' : `${activity.years_ago} years ago today`)
              : `${activity.years_ago === 1 ? '작년' : `${activity.years_ago}년 전`} 오늘의 러닝`}
          </div>
          <p className="text-lg font-extrabold text-[var(--foreground)] mt-0.5">
            {locale === 'en'
              ? `Ran ${activity.distance_km.toFixed(2)}km`
              : `${activity.distance_km.toFixed(2)}km 달렸어요`}
            {activity.years_ago === 1 && ' 🎉'}
          </p>
          <p className="text-[13px] text-[var(--muted)]">
            {locale === 'en'
              ? `${activity.activity_date.slice(0, 4)}-${activity.activity_date.split('-')[1]}-${activity.activity_date.split('-')[2]}`
              : `${activity.activity_date.slice(0, 4)}년 ${parseInt(activity.activity_date.split('-')[1])}월 ${parseInt(activity.activity_date.split('-')[2])}일`}
          </p>
        </div>
      </div>
    </Link>
  );
}
