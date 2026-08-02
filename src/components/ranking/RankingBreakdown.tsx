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
import { useI18n, formatRank, rankSuffix, type TranslationKey } from '@/lib/i18n';
import { readRankingFilters, writeRankingFilters, onRankingFiltersChanged } from '@/lib/ranking-filters';

type TimeAxis = 'today' | 'week' | 'month' | 'year';

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
    bg: 'from-amber-50 to-yellow-50 dark:from-amber-950/30 dark:to-yellow-950/20',
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

function motivationText(
  rank: number,
  kmToNext: number,
  kmToTop10: number,
  target: number,
  t: (key: TranslationKey) => string,
): { emoji: string; text: string } {
  if (rank === 1) return { emoji: '👑', text: t('rankingHero.champion') };
  if (rank <= 3) return { emoji: '🥇', text: t('rankingHero.toRank').replace('{target}', String(target)).replace('{km}', Number(kmToNext).toFixed(1)) };
  if (rank <= 10) return { emoji: '⭐', text: t('rankingHero.toRank').replace('{target}', String(target)).replace('{km}', Number(kmToNext).toFixed(1)) };
  if (Number(kmToTop10) > 0) return { emoji: '🚀', text: t('rankingHero.toTop10').replace('{km}', Number(kmToTop10).toFixed(1)) };
  return { emoji: '💪', text: t('rankingHero.oneStep') };
}

export default function RankingBreakdown({ axis }: Props) {
  const { user } = useAuth();
  const { t, tt, locale } = useI18n();
  const [rows, setRows] = useState<RankBreakdown[]>([]);
  const [loading, setLoading] = useState(true);

  // build 205: 회원 1천명 미만 단계 — 디폴트는 국가+도시(시/도) 2단계만 ON.
  // build 208 #3: 동일 필터를 HomeRankingHero 와 공유 (localStorage 기반).
  const [filters, setFilters] = useState<Record<FilterKey, boolean>>(() => readRankingFilters());
  useEffect(() => {
    const off = onRankingFiltersChanged((f) => setFilters(f));
    return off;
  }, []);
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
    setFilters(prev => {
      const next = { ...prev, [key]: !prev[key] };
      writeRankingFilters(next);
      return next;
    });
  };

  // build 207: scope_label 은 한국어 토큰 (e.g. "전국 50대 남성") — 영어 locale 일 땐
  // 토큰별로 tt 매핑 후 " · " 로 join. 단일 토큰이면 그대로 tt.
  const localizeScopeLabel = (label: string | null | undefined): string => {
    if (!label) return '';
    if (locale === 'ko') return label;
    // 공백 분리 후 토큰별 tt. 매핑 없는 토큰은 원문 유지.
    const tokens = label.split(/\s+/).filter(Boolean);
    if (tokens.length <= 1) return tt(label);
    return tokens.map(tk => tt(tk)).join(' · ');
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
    const axisLabel = axis === 'today' ? t('ranking.today') : axis === 'week' ? t('ranking.week') : axis === 'month' ? t('ranking.month') : t('ranking.year');
    return (
      <div className="card p-6 text-center">
        <Trophy size={32} className="mx-auto text-[var(--muted)] opacity-50 mb-2" />
        <p className="text-sm font-semibold text-[var(--foreground)]">
          {axisLabel} {t('rankingHero.noRecord')}
        </p>
        <p className="text-xs text-[var(--muted)] mt-1">{t('rankingHero.runOnceCta')}</p>
      </div>
    );
  }

  // 나머지 작은 카드 — combined 와 별개로 4축 정보
  const others = [...rows].sort((a, b) => a.rank_position - b.rank_position);

  // Hero 표시
  const isTop = combined ? combined.rank_position === 1 : false;
  const isTop10 = combined ? combined.rank_position <= 10 : false;
  const heroMot = combined
    ? motivationText(combined.rank_position, Number(combined.km_to_next), Number(combined.km_to_top10), combined.target_rank, t)
    : { emoji: '💪', text: t('rankingHero.oneStep') };
  const heroProgressPct = combined && !isTop && Number(combined.km_to_top10) > 0 && combined.rank_position > 10
    ? Math.min(95, Math.max(15, (Number(combined.my_km) / (Number(combined.my_km) + Number(combined.km_to_top10))) * 100))
    : isTop10 ? 100 : 0;

  return (
    <div className="space-y-3">
      {/* Hero — 칩 토글 + 조합 랭킹 (build 152) */}
      <div className="rounded-3xl bg-gradient-to-br from-emerald-100/80 via-white to-emerald-50/40 dark:from-emerald-950/30 dark:via-zinc-900 dark:to-emerald-950/20 border border-emerald-300/50 dark:border-emerald-800/40 p-5 shadow-sm relative overflow-hidden">
        <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full bg-gradient-to-br from-emerald-300/40 via-emerald-100/30 to-transparent blur-3xl pointer-events-none" />

        {/* 칩 토글 — 별 누르면 필터 OFF/ON. build 154: 크기 키움 + 안내. */}
        {chips.length > 0 && (
          <div className="relative flex flex-wrap gap-2 mb-3 justify-center">
            {chips.map(c => {
              const active = filters[c.key];
              return (
                <button
                  key={c.key}
                  onClick={() => toggleFilter(c.key)}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-bold transition active:scale-95 ${
                    active
                      ? 'bg-emerald-500 text-white shadow-sm'
                      : 'bg-white/80 dark:bg-zinc-800/60 text-[var(--muted)] border border-[var(--card-border)]'
                  }`}
                >
                  <Star size={14} fill={active ? 'white' : 'none'} strokeWidth={active ? 0 : 2} />
                  {tt(c.label)}
                </button>
              );
            })}
          </div>
        )}

        {combined && (
          <div className="relative text-center">
            <p className="text-[13px] font-bold text-[var(--muted)] uppercase tracking-wide mb-1">
              {localizeScopeLabel(combined.scope_label)}
            </p>
            <div className="flex items-baseline justify-center gap-1.5 mb-1">
              <span className="text-6xl font-extrabold leading-none tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400">
                {combined.rank_position}
              </span>
              <span className="text-2xl font-extrabold text-[var(--foreground)]">{rankSuffix(combined.rank_position, locale)}</span>
            </div>
            <p className="text-xs text-[var(--muted)] font-bold mb-2">
              {t('rankingHero.peopleSlash').replace('{n}', combined.total_in_scope.toLocaleString())} · {Number(combined.my_km).toFixed(1)}km
            </p>

            {!isTop && Number(combined.km_to_top10) > 0 && combined.rank_position > 10 && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1 text-[13px]">
                  <span className="font-semibold text-[var(--muted)]">{formatRank(combined.rank_position, locale)}</span>
                  <span className="font-extrabold text-emerald-700 dark:text-emerald-400">
                    {t('rankingHero.toTop10').replace('{km}', Number(combined.km_to_top10).toFixed(1))}
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

            <p className="mt-2 text-[13px] text-[var(--muted)] leading-relaxed px-2">
              {t('rankingHero.starHint')}
              <br />
              <span className="text-[12px] opacity-80">{t('rankingHero.starExample')}</span>
            </p>
          </div>
        )}
      </div>

      {/* 나머지 축 — 2칸 grid (참고 정보) */}
      {others.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {others.map(r => {
            const meta = SCOPE_META[r.scope_type];
            const mot = motivationText(r.rank_position, Number(r.km_to_next), Number(r.km_to_top10), r.target_rank, t);
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
                  <p className="text-[12px] font-bold text-[var(--muted)] truncate">{localizeScopeLabel(r.scope_label)}</p>
                </div>
                <div className="flex items-baseline gap-0.5 mb-1">
                  <span className={`text-3xl font-extrabold leading-none tabular-nums ${isTopHere ? meta.iconColor : 'text-[var(--foreground)]'}`}>
                    {r.rank_position}
                  </span>
                  <span className="text-base font-bold text-[var(--foreground)]">{rankSuffix(r.rank_position, locale)}</span>
                  <span className="ml-auto text-[12px] text-[var(--muted)] font-bold">
                    / {r.total_in_scope.toLocaleString()}
                  </span>
                </div>
                <p className="text-[13px] text-[var(--muted)] mb-2">{Number(r.my_km).toFixed(1)}km</p>
                {!isTopHere && Number(r.km_to_top10) > 0 && (
                  <div className="h-1.5 bg-white/60 dark:bg-zinc-800/60 rounded-full overflow-hidden mb-1.5">
                    <div className={`h-full ${meta.barColor}`} style={{ width: `${progressTo10}%` }} />
                  </div>
                )}
                <p className="text-[13px] font-bold text-[var(--foreground)] leading-tight">
                  <span className="mr-0.5">{mot.emoji}</span>
                  <span className="text-[var(--muted)]">{mot.text}</span>
                </p>
                <p className="mt-1 text-[11px] text-[var(--muted)] inline-flex items-center gap-0.5">
                  {t('rankingHero.viewAll')} <ChevronRight size={9} />
                </p>
              </Link>
            );
          })}
        </div>
      )}

      {/* 4축 코호트 인라인 (TOP 10 / 내 위치 토글) */}
      <CohortLeaderboardInline scope="region" axis={axis} title={t('rankingHero.regionTitle')} subtitle={t('rankingHero.regionSub')} Icon={MapPin} />
      <CohortLeaderboardInline scope="decade" axis={axis} title={t('rankingHero.decadeTitle')} subtitle={t('rankingHero.decadeSub')} Icon={Cake} />
      <CohortLeaderboardInline scope="gender" axis={axis} title={t('rankingHero.genderTitle')} subtitle={t('rankingHero.genderSub')} Icon={Users} />
      <CohortLeaderboardInline scope="starter" axis={axis} title={t('rankingHero.starterTitle')} subtitle={t('rankingHero.starterSub')} Icon={Sparkles} />
    </div>
  );
}
