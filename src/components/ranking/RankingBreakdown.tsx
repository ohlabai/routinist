'use client';

// 내 랭킹 다축 시각화 (build 100, Phase 3).
// 4축 동시 표시: 전국 / 지역(구) / 나이대(전국 성별·10대) / 시작 기간(가입일 ±60일 코호트)
// 시간축 (today/month/year) 은 부모(/ranking) 가 prop 으로 전달.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { Globe, MapPin, Cake, Sparkles, Trophy, ChevronRight, Users } from 'lucide-react';
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

interface Props {
  axis: TimeAxis;
}

// Tailwind JIT 가 dynamic 클래스 못 잡으니 모든 색상 명시.
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

function motivationText(r: RankBreakdown): { emoji: string; text: string } {
  if (r.rank_position === 1) return { emoji: '👑', text: '챔피언! 자리를 지켜요' };
  if (r.rank_position <= 3) return { emoji: '🥇', text: `${r.target_rank}위까지 ${Number(r.km_to_next).toFixed(1)}km` };
  if (r.rank_position <= 10) return { emoji: '⭐', text: `${r.target_rank}위까지 ${Number(r.km_to_next).toFixed(1)}km` };
  if (Number(r.km_to_top10) > 0) return { emoji: '🚀', text: `TOP 10 까지 ${Number(r.km_to_top10).toFixed(1)}km` };
  return { emoji: '💪', text: '한 발 더, 어제의 나를 이겨요' };
}

export default function RankingBreakdown({ axis }: Props) {
  const { user } = useAuth();
  const [rows, setRows] = useState<RankBreakdown[]>([]);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
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

  if (rows.length === 0) {
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

  // hero = 가장 좋은 (낮은) 순위. 동률이면 nation 우선.
  const sorted = [...rows].sort((a, b) => {
    if (a.rank_position !== b.rank_position) return a.rank_position - b.rank_position;
    const order = ['nation', 'region', 'decade', 'starter'] as const;
    return order.indexOf(a.scope_type) - order.indexOf(b.scope_type);
  });
  const hero = sorted[0];
  const others = sorted.slice(1);
  const heroMeta = SCOPE_META[hero.scope_type];
  const heroMot = motivationText(hero);
  const isTop = hero.rank_position === 1;
  const isTop10 = hero.rank_position <= 10;
  const heroProgressPct = !isTop && Number(hero.km_to_top10) > 0 && hero.rank_position > 10
    ? Math.min(95, Math.max(15, (Number(hero.my_km) / (Number(hero.my_km) + Number(hero.km_to_top10))) * 100))
    : isTop10 ? 100 : 0;

  return (
    <div className="space-y-3">
      {/* Hero — 가장 좋은 순위 (build 101: 에메랄드 단색 + 중앙 정렬) */}
      <Link
        href={`/ranking/cohort?scope=${hero.scope_type}&axis=${axis}`}
        className="block rounded-3xl bg-gradient-to-br from-emerald-100/80 via-white to-emerald-50/40 dark:from-emerald-950/30 dark:via-zinc-900 dark:to-emerald-950/20 border border-emerald-300/50 dark:border-emerald-800/40 p-5 shadow-sm relative overflow-hidden active:scale-[0.99] transition"
      >
        <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full bg-gradient-to-br from-emerald-300/40 via-emerald-100/30 to-transparent blur-3xl pointer-events-none" />
        <div className="relative text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <heroMeta.Icon size={14} className="text-emerald-600" />
            <p className="text-[11px] font-bold text-[var(--muted)] uppercase tracking-wide">
              최고 순위 · {hero.scope_label}
            </p>
          </div>
          <div className="flex items-baseline justify-center gap-1.5 mb-1">
            <span className="text-6xl font-extrabold leading-none tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400">
              {hero.rank_position}
            </span>
            <span className="text-2xl font-extrabold text-[var(--foreground)]">위</span>
          </div>
          <p className="text-xs text-[var(--muted)] font-bold mb-2">
            / {hero.total_in_scope.toLocaleString()}명 · {Number(hero.my_km).toFixed(1)}km
          </p>

          {!isTop && Number(hero.km_to_top10) > 0 && hero.rank_position > 10 && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1 text-[11px]">
                <span className="font-semibold text-[var(--muted)]">{hero.rank_position}위</span>
                <span className="font-extrabold text-emerald-700 dark:text-emerald-400">
                  TOP 10 까지 {Number(hero.km_to_top10).toFixed(1)}km
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

          <div className="mt-2 flex items-center justify-center gap-0.5 text-[11px] font-bold text-[var(--muted)]">
            <span>전체 보기</span>
            <ChevronRight size={11} />
          </div>
        </div>
      </Link>

      {/* 나머지 축 — 2칸 grid (각 카드 클릭 시 코호트 리스트로) */}
      {others.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {others.map(r => {
            const meta = SCOPE_META[r.scope_type];
            const mot = motivationText(r);
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
              </Link>
            );
          })}
        </div>
      )}

      {/* build 104: 4축 코호트 인라인 (TOP 10 / 내 위치 토글) */}
      <CohortLeaderboardInline scope="region" axis={axis} title="우리 동네 TOP 10" subtitle="같은 구 러너끼리" Icon={MapPin} />
      <CohortLeaderboardInline scope="decade" axis={axis} title="내 또래 TOP 10" subtitle="같은 연령대·성별 전국" Icon={Cake} />
      <CohortLeaderboardInline scope="gender" axis={axis} title="같은 성별 TOP 10" subtitle="성별 기준 전국" Icon={Users} />
      <CohortLeaderboardInline scope="starter" axis={axis} title="동기 러너 TOP 10" subtitle="비슷한 시기에 가입한 러너" Icon={Sparkles} />
    </div>
  );
}
