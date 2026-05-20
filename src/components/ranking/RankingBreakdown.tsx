'use client';

// 내 랭킹 다축 시각화 (build 100, Phase 3 + build 152 칩 토글).
// Hero: 6개 칩 토글(대한민국/지역시/지역구/성별/연령대/동기) → 조합 코호트의 내 순위.
// 별 누르면 해당 필터 OFF → 더 넓은 범위 랭킹.
// 그 외 4축 작은 카드 + 코호트 인라인 리스트는 별도 정보로 유지.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { Globe, MapPin, Cake, Sparkles, Trophy, ChevronRight, Users, Star } from 'lucide-react';
import CohortLeaderboardInline from './CohortLeaderboardInline';

type TimeAxis = 'today' | 'month' | 'year';

interface RankBreakdown {
  scope_type: 'nation' | 'region' | 'decade' | 'starter';
  scope_label: string;
  rank_position: number;
  total_in_scope: number;
  my_km: number;
  km_to_top10: number;
  km_to_next: number;
  target_rank: number;
}

interface CombinedRank {
  scope_label: string;
  rank_position: number;
  total_in_scope: number;
  my_km: number;
  km_to_top10: number;
  km_to_next: number;
  target_rank: number;
  country_label: string | null;
  region_si_label: string | null;
  region_gu_label: string | null;
  gender_label: string | null;
  decade_label: string | null;
  starter_label: string | null;
}

type FilterKey = 'country' | 'region_si' | 'region_gu' | 'gender' | 'decade' | 'starter';

interface Props {
  axis: TimeAxis;
}

const SCOPE_META: Record<RankBreakdown['scope_type'], {
  Icon: typeof Globe;
  bg: string;
  iconColor: string;
  barColor: string;
}> = {
  nation: {
    Icon: Globe,
    bg: 'from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/20',
    iconColor: 'text-emerald-600',
    barColor: 'bg-emerald-500',
  },
  region: {
    Icon: MapPin,
    bg: 'from-blue-50 to-cyan-50 dark:from-blue-950/30 dark:to-cyan-950/20',
    iconColor: 'text-blue-600',
    barColor: 'bg-blue-500',
  },
  decade: {
    Icon: Cake,
    bg: 'from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/20',
    iconColor: 'text-amber-600',
    barColor: 'bg-amber-500',
  },
  starter: {
    Icon: Sparkles,
    bg: 'from-purple-50 to-pink-50 dark:from-purple-950/30 dark:to-pink-950/20',
    iconColor: 'text-purple-600',
    barColor: 'bg-purple-500',
  },
};

function motivationText(rank: number, kmToNext: number, kmToTop10: number, target: number): { emoji: string; text: string } {
  if (rank === 1) return { emoji: '👑', text: '챔피언! 자리를 지켜요' };
  if (rank <= 3) return { emoji: '🥇', text: `${target}위까지 ${Number(kmToNext).toFixed(1)}km` };
  if (rank <= 10) return { emoji: '⭐', text: `${target}위까지 ${Number(kmToNext).toFixed(1)}km` };
  if (Number(kmToTop10) > 0) return { emoji: '🚀', text: `TOP 10 까지 ${Number(kmToTop10).toFixed(1)}km` };
  return { emoji: '💪', text: '한 발 더, 어제의 나를 이겨요' };
}

export default function RankingBreakdown({ axis }: Props) {
  const { user } = useAuth();
  const [rows, setRows] = useState<RankBreakdown[]>([]);
  const [loading, setLoading] = useState(true);

  // build 152: 칩 토글 filters. 모두 ON 으로 시작 — 가장 좁은 코호트.
  const [filters, setFilters] = useState<Record<FilterKey, boolean>>({
    country: true,
    region_si: true,
    region_gu: true,
    gender: true,
    decade: true,
    starter: true,
  });
  const [combined, setCombined] = useState<CombinedRank | null>(null);
  const [combinedLoading, setCombinedLoading] = useState(true);

  // 다축 breakdown — 작은 카드 + Inline 용 (변동 X)
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase.rpc('find_my_rankings_breakdown', {
          target_user_id: user.id,
          time_axis: axis,
        });
        if (cancelled) return;
        if (error) {
          console.warn('[RankingBreakdown] RPC 실패', error);
          setRows([]);
        } else {
          setRows((data ?? []) as RankBreakdown[]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, axis]);

  // 조합 랭킹 — filters 또는 axis 변경 시 재호출
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setCombinedLoading(true);
    (async () => {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase.rpc('find_my_combined_ranking', {
          target_user_id: user.id,
          time_axis: axis,
          use_country: filters.country,
          use_region_si: filters.region_si,
          use_region_gu: filters.region_gu,
          use_gender: filters.gender,
          use_decade: filters.decade,
          use_starter: filters.starter,
        });
        if (cancelled) return;
        if (error) {
          console.warn('[RankingBreakdown] combined RPC 실패', error);
          setCombined(null);
        } else {
          setCombined((Array.isArray(data) && data[0] ? data[0] : null) as CombinedRank | null);
        }
      } finally {
        if (!cancelled) setCombinedLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, axis, filters]);

  // 사용 가능한 칩 — profile 에 값이 있는 것만 노출
  const chips = useMemo(() => {
    if (!combined) return [] as { key: FilterKey; label: string }[];
    const list: { key: FilterKey; label: string }[] = [];
    if (combined.country_label) list.push({ key: 'country', label: combined.country_label });
    if (combined.region_si_label) list.push({ key: 'region_si', label: combined.region_si_label });
    if (combined.region_gu_label) list.push({ key: 'region_gu', label: combined.region_gu_label });
    if (combined.gender_label) list.push({ key: 'gender', label: combined.gender_label });
    if (combined.decade_label) list.push({ key: 'decade', label: combined.decade_label });
    if (combined.starter_label) list.push({ key: 'starter', label: combined.starter_label });
    return list;
  }, [combined]);

  const toggleFilter = (key: FilterKey) => {
    setFilters(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // build 152 fix: 최초 로딩만 전체 skeleton — 칩 토글 시엔 hero 만 dim (다른 카드는 유지).
  const isInitialLoad = loading && rows.length === 0 && !combined;
  if (isInitialLoad) {
    return (
      <div className="space-y-3">
        <div className="h-44 rounded-3xl bg-[var(--card-border)]/30 animate-pulse" />
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-36 rounded-2xl bg-[var(--card-border)]/30 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (rows.length === 0 && (!combined || combined.rank_position === 0)) {
    return (
      <div className="card p-6 text-center">
        <Trophy size={32} className="mx-auto text-[var(--muted)] opacity-50 mb-2" />
        <p className="text-sm font-semibold text-[var(--foreground)]">
          {axis === 'today' ? '오늘' : axis === 'month' ? '이달' : '올해'} 아직 기록이 없어요
        </p>
        <p className="text-xs text-[var(--muted)] mt-1">한 번 달리고 랭킹에 들어가봐요!</p>
      </div>
    );
  }

  // 나머지 작은 카드 — combined 와 별개로 4축 정보
  const others = [...rows].sort((a, b) => a.rank_position - b.rank_position);

  // Hero 표시
  const isTop = combined ? combined.rank_position === 1 : false;
  const isTop10 = combined ? combined.rank_position <= 10 : false;
  const heroMot = combined
    ? motivationText(combined.rank_position, Number(combined.km_to_next), Number(combined.km_to_top10), combined.target_rank)
    : { emoji: '💪', text: '한 발 더' };
  const heroProgressPct = combined && !isTop && Number(combined.km_to_top10) > 0 && combined.rank_position > 10
    ? Math.min(95, Math.max(15, (Number(combined.my_km) / (Number(combined.my_km) + Number(combined.km_to_top10))) * 100))
    : isTop10 ? 100 : 0;

  return (
    <div className="space-y-3">
      {/* Hero — 칩 토글 + 조합 랭킹 (build 152) */}
      <div className="rounded-3xl bg-gradient-to-br from-emerald-100/80 via-white to-emerald-50/40 dark:from-emerald-950/30 dark:via-zinc-900 dark:to-emerald-950/20 border border-emerald-300/50 dark:border-emerald-800/40 p-5 shadow-sm relative overflow-hidden">
        <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full bg-gradient-to-br from-emerald-300/40 via-emerald-100/30 to-transparent blur-3xl pointer-events-none" />

        {/* 칩 토글 — 별 누르면 필터 OFF/ON */}
        {chips.length > 0 && (
          <div className="relative flex flex-wrap gap-1.5 mb-3 justify-center">
            {chips.map(c => {
              const active = filters[c.key];
              return (
                <button
                  key={c.key}
                  onClick={() => toggleFilter(c.key)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold transition active:scale-95 ${
                    active
                      ? 'bg-emerald-500 text-white shadow-sm'
                      : 'bg-white/70 dark:bg-zinc-800/60 text-[var(--muted)] border border-[var(--card-border)]'
                  }`}
                >
                  <Star size={11} fill={active ? 'white' : 'none'} strokeWidth={active ? 0 : 2} />
                  {c.label}
                </button>
              );
            })}
          </div>
        )}

        {combined && (
          <div className="relative text-center">
            <p className="text-[11px] font-bold text-[var(--muted)] uppercase tracking-wide mb-1">
              {combined.scope_label}
            </p>
            <div className="flex items-baseline justify-center gap-1.5 mb-1">
              <span className="text-6xl font-extrabold leading-none tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400">
                {combined.rank_position}
              </span>
              <span className="text-2xl font-extrabold text-[var(--foreground)]">위</span>
            </div>
            <p className="text-xs text-[var(--muted)] font-bold mb-2">
              / {combined.total_in_scope.toLocaleString()}명 · {Number(combined.my_km).toFixed(1)}km
            </p>

            {!isTop && Number(combined.km_to_top10) > 0 && combined.rank_position > 10 && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1 text-[11px]">
                  <span className="font-semibold text-[var(--muted)]">{combined.rank_position}위</span>
                  <span className="font-extrabold text-emerald-700 dark:text-emerald-400">
                    TOP 10 까지 {Number(combined.km_to_top10).toFixed(1)}km
                  </span>
                </div>
                <div className="h-2 bg-white/60 dark:bg-zinc-800/60 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all"
                    style={{ width: `${heroProgressPct}%` }}
                  />
                </div>
              </div>
            )}

            <div className="mt-3 mx-auto inline-flex items-center justify-center gap-2 rounded-xl bg-white/70 dark:bg-zinc-900/60 backdrop-blur-sm px-3 py-2">
              <span className="text-lg">{heroMot.emoji}</span>
              <span className="text-sm font-bold text-[var(--foreground)]">{heroMot.text}</span>
            </div>

            <p className="mt-2 text-[10px] text-[var(--muted)] leading-snug">
              별을 눌러서 필터를 풀면 더 넓은 범위 랭킹이 보여요
            </p>
          </div>
        )}
      </div>

      {/* 나머지 축 — 2칸 grid (참고 정보) */}
      {others.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {others.map(r => {
            const meta = SCOPE_META[r.scope_type];
            const mot = motivationText(r.rank_position, Number(r.km_to_next), Number(r.km_to_top10), r.target_rank);
            const progressTo10 = r.rank_position > 10 && Number(r.km_to_top10) > 0
              ? Math.min(95, Math.max(10, (Number(r.my_km) / (Number(r.my_km) + Number(r.km_to_top10))) * 100))
              : r.rank_position <= 10 ? 100 : 0;
            const isTopHere = r.rank_position <= 10;
            return (
              <Link
                key={r.scope_type}
                href={`/ranking/cohort?scope=${r.scope_type}&axis=${axis}`}
                className={`block rounded-2xl bg-gradient-to-br ${meta.bg} border border-[var(--card-border)]/40 p-3.5 active:scale-[0.98] transition`}
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  <meta.Icon size={12} className={meta.iconColor} />
                  <p className="text-[10px] font-bold text-[var(--muted)] truncate">{r.scope_label}</p>
                </div>
                <div className="flex items-baseline gap-0.5 mb-1">
                  <span className={`text-3xl font-extrabold leading-none tabular-nums ${isTopHere ? meta.iconColor : 'text-[var(--foreground)]'}`}>
                    {r.rank_position}
                  </span>
                  <span className="text-base font-bold text-[var(--foreground)]">위</span>
                  <span className="ml-auto text-[10px] text-[var(--muted)] font-bold">
                    / {r.total_in_scope.toLocaleString()}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--muted)] mb-2">{Number(r.my_km).toFixed(1)}km</p>
                {!isTopHere && Number(r.km_to_top10) > 0 && (
                  <div className="h-1.5 bg-white/60 dark:bg-zinc-800/60 rounded-full overflow-hidden mb-1.5">
                    <div className={`h-full ${meta.barColor}`} style={{ width: `${progressTo10}%` }} />
                  </div>
                )}
                <p className="text-[11px] font-bold text-[var(--foreground)] leading-tight">
                  <span className="mr-0.5">{mot.emoji}</span>
                  <span className="text-[var(--muted)]">{mot.text}</span>
                </p>
                <p className="mt-1 text-[9px] text-[var(--muted)] inline-flex items-center gap-0.5">
                  전체 보기 <ChevronRight size={9} />
                </p>
              </Link>
            );
          })}
        </div>
      )}

      {/* 4축 코호트 인라인 (TOP 10 / 내 위치 토글) */}
      <CohortLeaderboardInline scope="region" axis={axis} title="우리 동네 TOP 10" subtitle="같은 구 러너끼리" Icon={MapPin} />
      <CohortLeaderboardInline scope="decade" axis={axis} title="내 또래 TOP 10" subtitle="같은 연령대·성별 전국" Icon={Cake} />
      <CohortLeaderboardInline scope="gender" axis={axis} title="같은 성별 TOP 10" subtitle="성별 기준 전국" Icon={Users} />
      <CohortLeaderboardInline scope="starter" axis={axis} title="동기 러너 TOP 10" subtitle="비슷한 시기에 가입한 러너" Icon={Sparkles} />
    </div>
  );
}
