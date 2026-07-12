'use client';

// build 167 #11: Run of the Day — 종합 점수 (거리 50% + 속도 50%) 상위 1건.
// 2026-07-12 CCSS: latest_run_of_the_day RPC 가 cron 테이블 대신 라이브 계산으로 전환 —
// 최근 7일 중 가장 최근 날짜(오늘 포함)의 최고 스코어 러닝. 매일 (오늘 달린 사람이
// 생기면 하루 중에도) 갱신됨. 비경쟁자도 영감 받게 — "누가 가장 잘 달렸나" 호기심 트리거.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Crown, MapPin, Zap, Heart } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { todayStr } from '@/lib/kst';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/components/AuthProvider';
import { sendCheer } from '@/lib/cheer-data';

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
  // 2026-07-11 v2: 이모지 선택창 (CheerButton) 이 Link 안에서 내비게이션과 충돌해 화면이
  // 흔들리던 버그 → 원탭 하트로 교체. 탭 즉시 채워진 하트 + 팝 애니메이션 (optimistic).
  const [cheered, setCheered] = useState(false);
  const [popping, setPopping] = useState(false);

  const handleHeart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (cheered || !pick) return;
    setCheered(true);
    setPopping(true);
    setTimeout(() => setPopping(false), 450);
    void sendCheer(pick.user_id, '❤️', 'run_of_the_day');
  };

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
        {/* 동적 라벨 — 오늘 기록이면 TODAY'S, 이전 날짜면 RUN OF THE DAY (라벨-데이터 일치) */}
        <h3 className="text-xs font-extrabold text-amber-700 dark:text-amber-300 tracking-wide">
          {pick.pick_date === todayStr() ? "TODAY'S BEST RUN" : 'RUN OF THE DAY'}
        </h3>
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
        {user && pick.user_id !== user.id && (
          <button
            onClick={handleHeart}
            aria-label={tt('응원 보내기')}
            className="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center bg-white/70 dark:bg-white/10 active:scale-90 transition"
          >
            <Heart
              size={22}
              className={`transition-transform duration-300 ${popping ? 'scale-150' : 'scale-100'} ${
                cheered ? 'text-rose-500 fill-rose-500' : 'text-rose-400'
              }`}
            />
          </button>
        )}
      </div>
    </Link>
  );
}
