'use client';

// build 167 #11: Run of the Day — 어제 활동 중 종합 점수 상위 1건 자동 선정.
// SQL pick_run_of_the_day() 가 매일 cron 으로 채워짐. latest_run_of_the_day RPC 로 조회.
// 비경쟁자도 영감 받게 — "어제는 누가 가장 잘 달렸나" 호기심 트리거.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Crown, MapPin, Zap } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/components/AuthProvider';
import CheerButton from '@/components/social/CheerButton';

interface RunOfTheDay {
  pick_date: string;
  activity_id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  distance_km: number;
  pace_avg_sec_per_km: number | null;
  region_label: string | null;
}

function paceLabel(sec: number | null): string {
  if (!sec || sec <= 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}'${String(s).padStart(2, '0')}"`;
}

export default function RunOfTheDayCard() {
  const { tt } = useI18n();
  const { user } = useAuth();
  const [pick, setPick] = useState<RunOfTheDay | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await getSupabase().rpc('latest_run_of_the_day');
        if (error) throw error;
        if (cancelled) return;
        const row = Array.isArray(data) ? data[0] : data;
        if (row) setPick({ ...row, distance_km: Number(row.distance_km) });
      } catch (e) {
        // silent — 데이터 없으면 카드 미표시
        console.debug('[RunOfTheDay] load fail (silent):', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!pick) return null;

  return (
    <Link
      href={`/activity?id=${pick.activity_id}`}
      className="mx-4 block rounded-2xl bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50 dark:from-yellow-950/30 dark:via-amber-950/30 dark:to-orange-950/30 border border-amber-200 dark:border-amber-800 p-4 shadow-md shadow-amber-500/10 active:scale-[0.99] transition"
    >
      <div className="flex items-center gap-2 mb-2">
        <Crown size={16} className="text-amber-500" />
        <h3 className="text-xs font-extrabold text-amber-700 dark:text-amber-300 tracking-wide">RUN OF THE DAY</h3>
        <span className="ml-auto text-[10px] text-[var(--muted)] font-semibold">{pick.pick_date}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0 w-12 h-12 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center font-extrabold text-base shadow-md overflow-hidden">
          {pick.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pick.avatar_url} alt={pick.display_name ?? 'runner'} className="w-full h-full object-cover" />
          ) : (
            (pick.display_name ?? 'R')[0]?.toUpperCase() ?? 'R'
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold text-[var(--foreground)] truncate">{pick.display_name ?? tt('러너')}</p>
          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[var(--muted)]">
            <span className="font-bold text-amber-600 dark:text-amber-400">{pick.distance_km.toFixed(2)}km</span>
            <span className="inline-flex items-center gap-0.5">
              <Zap size={10} className="text-emerald-500" />
              {paceLabel(pick.pace_avg_sec_per_km)}
            </span>
            {pick.region_label && (
              <span className="inline-flex items-center gap-0.5 truncate">
                <MapPin size={10} />
                {pick.region_label}
              </span>
            )}
          </div>
        </div>
        {/* 2026-07-11 피드백: 어제의 주인공에게 바로 응원 — 카드 Link 와 분리 (propagation 차단) */}
        {user && pick.user_id !== user.id && (
          <div className="flex-shrink-0" onClick={(e) => e.preventDefault()}>
            <CheerButton toUserId={pick.user_id} context="profile" size="sm" />
          </div>
        )}
      </div>
    </Link>
  );
}
