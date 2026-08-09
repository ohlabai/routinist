'use client';

// 홈 히어로 — 경쟁·소셜 피벗(2026-04-21) 의 핵심 장치.
// build 101: 에메랄드 단색 통일 + 중앙 정렬 (사용자 피드백). 순위별 그라데이션 제거.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Trophy, ChevronRight, UserPlus, Crown, Sparkles } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { logClientInfo, logClientWarn } from '@/lib/error-logger';
import { dataCache, CACHE_KEYS, onCacheInvalidated } from '@/lib/data-cache';
import { useI18n, formatRank, rankSuffix, type TranslationKey } from '@/lib/i18n';
import { readRankingFilters, onRankingFiltersChanged, readRankingAxis, writeRankingAxis, onRankingAxisChanged, type RankingFilters } from '@/lib/ranking-filters';

// build 171 #4: 홈 hero axis 도 랭킹 페이지처럼 today → week. 의미 부족한 today 제거.
type TimeAxis = 'week' | 'month' | 'year';

interface HeroRank {
  scope_label: string;
  scope_type: string;
  rank_position: number;
  total_in_scope: number;
  my_km: number;
  km_to_next: number;
  target_rank: number;
  time_axis_out: TimeAxis;
}

const AXIS_OPTIONS: { id: TimeAxis; tKey: TranslationKey }[] = [
  { id: 'week', tKey: 'ranking.week' },
  { id: 'month', tKey: 'home.tabMonth' },
  { id: 'year', tKey: 'home.tabYear' },
];

// build 101: 모든 순위에 동일한 에메랄드 단색. tier label/아이콘만 순위에 따라 분기.
function getRankTier(rank: number, t: (k: TranslationKey) => string): { icon: string; label: string } {
  if (rank === 1) return { icon: '👑', label: t('homeHero.tierChamp') };
  if (rank === 2) return { icon: '🥈', label: t('homeHero.tierRunnerUp') };
  if (rank === 3) return { icon: '🥉', label: t('homeHero.tierMedal') };
  if (rank <= 10) return { icon: '⭐', label: t('homeHero.tierTop10') };
  return { icon: '🏃', label: t('homeHero.tierChallenging') };
}

const UNIFIED_STYLE = {
  cardBg: 'bg-gradient-to-br from-emerald-100/80 via-white to-emerald-50/40 dark:from-emerald-950/30 dark:via-zinc-900 dark:to-emerald-950/20',
  cardBorder: 'border-emerald-300/50 dark:border-emerald-800/40',
  halo: 'from-emerald-300/40 via-emerald-100/30 to-transparent',
  accent: 'text-emerald-700 dark:text-emerald-400',
  progressBg: 'bg-gradient-to-r from-emerald-400 to-emerald-600',
  numberText: 'text-emerald-600 dark:text-emerald-400',
  medalBg: 'bg-gradient-to-br from-emerald-400 to-emerald-600',
  medalShadow: 'shadow-[0_8px_24px_-4px_rgba(16,185,129,0.4)]',
};

interface RankPoint {
  date: string;
  rank: number;
  deltaDay: number | null;
  deltaWeek: number | null;
  deltaMonth: number | null;
}

/** 전일/전주/전월 대비 등락 배지 (2026-08-09 hans 요청).
 *  delta = 이전 순위 - 현재 순위 → 양수면 상승. 변동 없거나 비교 기록이 없으면 숨긴다. */
function RankDeltaBadges({ history, t, accent }: {
  history: RankPoint[]; t: (k: TranslationKey) => string; accent: string;
}) {
  const last = history.length ? history[history.length - 1] : null;
  if (!last) return null;
  const items: { key: string; label: string; delta: number }[] = [];
  if (last.deltaDay) items.push({ key: 'd', label: t('rankingHero.vsDay'), delta: last.deltaDay });
  if (last.deltaWeek) items.push({ key: 'w', label: t('rankingHero.vsWeek'), delta: last.deltaWeek });
  if (last.deltaMonth) items.push({ key: 'm', label: t('rankingHero.vsMonth'), delta: last.deltaMonth });
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-0.5 items-start">
      {items.map((it) => {
        const up = it.delta > 0;
        return (
          <div key={it.key} className="flex items-center gap-1 whitespace-nowrap">
            <span className="text-[10px] font-bold text-[var(--muted)]">{it.label}</span>
            <span className={`text-[11px] font-extrabold tabular-nums ${up ? accent : 'text-rose-500 dark:text-rose-400'}`}>
              {up ? '▲' : '▼'}{Math.abs(it.delta)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** 최근 순위 추이 스파크라인. 순위는 낮을수록 좋으므로 y 를 뒤집어 그린다
 *  (위로 갈수록 상위권). 점이 2개 미만이면 그리지 않는다. */
function RankSparkline({ history, t }: { history: RankPoint[]; t: (k: TranslationKey) => string }) {
  if (history.length < 2) return null;
  const W = 260, H = 44, PAD = 4;
  const ranks = history.map(h => h.rank);
  const best = Math.min(...ranks);          // 가장 좋은(작은) 순위
  const worst = Math.max(...ranks);
  const span = Math.max(worst - best, 1);
  const pts = history.map((h, i) => {
    const x = PAD + (i * (W - PAD * 2)) / (history.length - 1);
    // rank 가 작을수록 위 → (rank - best) 비율만큼 아래로.
    const y = PAD + ((h.rank - best) / span) * (H - PAD * 2);
    return [x, y] as const;
  });
  const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${d} L${pts[pts.length - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`;
  const lastPt = pts[pts.length - 1];
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-1 px-0.5">
        <span className="text-[11px] font-bold text-[var(--muted)]">{t('rankingHero.trendTitle')}</span>
        <span className="text-[11px] font-bold text-[var(--muted)] tabular-nums">
          {t('rankingHero.trendBest').replace('{rank}', String(best))}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="rankTrendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(16,185,129)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="rgb(16,185,129)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#rankTrendFill)" />
        <path d={d} fill="none" stroke="rgb(16,185,129)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={lastPt[0]} cy={lastPt[1]} r="3.5" fill="rgb(16,185,129)" />
      </svg>
    </div>
  );
}

export default function HomeRankingHero() {
  const { user, profile } = useAuth();
  const { t, locale } = useI18n();
  const router = useRouter();
  // build 209 #4-2: 기본 axis localStorage 에서. 'week' 이 디폴트. /ranking 탭과 양방향 동기화.
  const [axis, setAxisState] = useState<TimeAxis>(() => {
    const a = readRankingAxis();
    return a === 'today' ? 'week' : a;  // hero 는 today 미지원 → week 로 폴백
  });
  const setAxis = (a: TimeAxis) => { setAxisState(a); writeRankingAxis(a); };
  const [rank, setRank] = useState<HeroRank | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  // 랭킹 변동 (2026-08-09) — 최근 14일 시계열 + 전일/전주/전월 대비 등락
  const [history, setHistory] = useState<RankPoint[]>([]);
  // build 208 #3: /ranking 탭과 필터 공유. 변경되면 즉시 재호출.
  const [filters, setFilters] = useState<RankingFilters>(() => readRankingFilters());

  // 2026-07-15 리뷰 fix: 시/도 코호트 전환 후 si-only (해외 포함) 유저가 랭킹에서 영구 차단되던 게이트 — region_si 포함
  const hasDemographics = !!(profile?.region_si || profile?.region_gu || profile?.birth_year || profile?.gender);

  useEffect(() => {
    const off = onRankingFiltersChanged((f) => setFilters(f));
    return off;
  }, []);
  useEffect(() => {
    const off = onRankingAxisChanged((a) => {
      const next = a === 'today' ? 'week' : a;
      setAxisState(next);
    });
    return off;
  }, []);

  useEffect(() => {
    if (!user) return;
    if (!hasDemographics) { setLoading(false); return; }
    let cancelled = false;

    const filterKey = `${filters.country?1:0}${filters.region_si?1:0}${filters.region_gu?1:0}${filters.gender?1:0}${filters.decade?1:0}${filters.starter?1:0}`;
    const cacheKey = `${CACHE_KEYS.heroRank(user.id, axis)}:${filterKey}`;
    const cached = dataCache.get<HeroRank | null>(cacheKey);
    const hasCached = !!cached;

    if (cached) {
      setRank(cached.value);
      setLoading(false);
      if (retryKey === 0) return;
    } else {
      setLoading(true);
    }
    setError(false);
    const t0 = Date.now();

    const timeoutId = setTimeout(() => {
      if (!cancelled) {
        logClientWarn('HomeRankingHero', 'RPC 15s timeout', { axis });
        setError(true);
        setLoading(false);
      }
    }, 15000);

    (async () => {
      try {
        const supabase = getSupabase();
        // build 208 #3: find_hero_rank (자동) → find_my_combined_ranking (필터 적용).
        // /ranking 탭 RankingBreakdown 과 동일 RPC + 동일 filters → 결과 동기화.
        const { data, error: rpcError } = await supabase.rpc('find_my_combined_ranking', {
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
        clearTimeout(timeoutId);
        if (rpcError) throw rpcError;
        const row = Array.isArray(data) ? data[0] : data;
        const value: HeroRank | null = row ? {
          scope_label: row.scope_label ?? '',
          scope_type: row.scope_type ?? 'region',
          rank_position: Number(row.rank_position) || 0,
          total_in_scope: Number(row.total_in_scope) || 0,
          my_km: Number(row.my_km) || 0,
          km_to_next: Number(row.km_to_next) || 0,
          target_rank: Number(row.target_rank) || 1,
          time_axis_out: axis,
        } : null;
        setRank(value);
        dataCache.set(cacheKey, value);
        logClientInfo('HomeRankingHero', 'RPC ok', { ms: Date.now() - t0, hasRow: !!row, axis, filterKey });

        // 2026-08-09: 오늘 순위를 하루 1행으로 적재 → 변동 그래프·등락 배지의 원천.
        // 이미 계산해서 받은 값을 그대로 넘기므로 추가 집계 비용이 없다. 실패해도 무시.
        if (value && value.rank_position > 0) {
          void supabase.rpc('record_rank_snapshot', {
            p_axis: axis, p_rank: value.rank_position,
            p_total: value.total_in_scope, p_km: value.my_km,
          }).then(() => supabase.rpc('get_rank_history', { p_axis: axis, p_days: 14 }))
            .then(({ data: h }) => {
              if (cancelled || !Array.isArray(h)) return;
              setHistory(h.map((r: Record<string, unknown>) => ({
                date: String(r.snapshot_date),
                rank: Number(r.rank_position) || 0,
                deltaDay: r.delta_day == null ? null : Number(r.delta_day),
                deltaWeek: r.delta_week == null ? null : Number(r.delta_week),
                deltaMonth: r.delta_month == null ? null : Number(r.delta_month),
              })));
            }, () => {});
        }
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        logClientWarn('HomeRankingHero', 'RPC fail', { reason, ms: Date.now() - t0, axis, hasCached });
        if (!cancelled && !hasCached) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [user, axis, retryKey, hasDemographics, filters]);

  useEffect(() => {
    const off = onCacheInvalidated((prefix) => {
      if (prefix === '' || 'hero:rank:'.startsWith(prefix) || prefix.startsWith('hero:rank:')) {
        setRetryKey(k => k + 1);
      }
    });
    return off;
  }, []);

  if (loading) {
    return (
      <div className="mx-4 mt-3 rounded-3xl bg-gradient-to-br from-emerald-100/70 via-white to-emerald-50/40 dark:from-emerald-950/30 dark:via-zinc-900 dark:to-emerald-950/10 border border-emerald-200/50 dark:border-emerald-900/30 p-5 h-[180px] animate-pulse" />
    );
  }

  if (error && hasDemographics) {
    return (
      <div className="mx-4 mt-3 rounded-3xl bg-slate-50 dark:bg-zinc-900/50 border border-slate-200/60 dark:border-zinc-800 p-5">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white dark:bg-zinc-900 flex items-center justify-center flex-shrink-0 opacity-60">
            <Trophy size={20} className="text-slate-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold text-slate-700 dark:text-slate-300 leading-tight">
              {t('homeHero.rankingPrepping')}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
              {t('homeHero.rankingPreppingSub')}
            </p>
          </div>
          <button
            onClick={() => setRetryKey(k => k + 1)}
            className="text-xs font-bold text-slate-600 dark:text-slate-400 px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 active:scale-95 transition"
          >
            {t('homeHero.retry')}
          </button>
        </div>
      </div>
    );
  }

  if (!hasDemographics) {
    return (
      <Link
        href="/profile/edit"
        className="mx-4 mt-3 block rounded-3xl bg-gradient-to-br from-emerald-100/80 via-white to-emerald-50 dark:from-emerald-950/30 dark:via-zinc-900 dark:to-emerald-950/10 border border-emerald-200/60 dark:border-emerald-900/30 p-5 active:scale-[0.99] transition shadow-sm"
      >
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white dark:bg-zinc-900 shadow-md flex items-center justify-center flex-shrink-0">
            <UserPlus size={24} className="text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-lg font-bold text-[var(--foreground)] leading-tight">
              {t('homeHero.seeMyRanking')}
            </p>
            <p className="text-sm text-[var(--muted)] mt-1 leading-5">
              {t('homeHero.seeMyRankingSub')}
            </p>
          </div>
          <ChevronRight size={20} className="text-emerald-600 flex-shrink-0" />
        </div>
      </Link>
    );
  }

  if (!rank) {
    const birthLabel = profile?.birth_year ? (locale === 'en' ? `Born ${profile.birth_year}` : `${profile.birth_year}년생`) : null;
    const genderLabel = profile?.gender === 'male' ? t('profile.male') : profile?.gender === 'female' ? t('profile.female') : null;
    const conditionLabel = [
      profile?.region_si,
      profile?.region_gu,
      birthLabel,
      genderLabel,
    ].filter(Boolean).join(' · ');

    return (
      <div className="mx-4 mt-3 rounded-3xl bg-gradient-to-br from-emerald-100/80 via-white to-emerald-50 dark:from-emerald-950/30 dark:via-zinc-900 dark:to-emerald-950/10 border border-emerald-200/60 dark:border-emerald-900/30 p-5 shadow-sm">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-12 h-12 rounded-2xl bg-white dark:bg-zinc-900 shadow flex items-center justify-center flex-shrink-0">
            <Trophy size={22} className="text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-bold text-[var(--foreground)]">{t('homeHero.myRankingCondition')}</p>
            <p className="text-sm text-emerald-700 dark:text-emerald-400 font-semibold mt-0.5 truncate">
              {conditionLabel || t('homeHero.conditionDone')}
            </p>
          </div>
          {/* build 170 #1: "수정" 버튼 톤 다운 — 이미 세팅한 사용자가 "또 입력하라"고 느끼지 않게.
              border/배경 제거 + 작은 텍스트 링크. */}
          <Link
            href="/profile/edit"
            className="text-[13px] font-semibold text-[var(--muted)] underline underline-offset-2 active:scale-95 flex-shrink-0 self-start mt-1"
          >
            {t('homeHero.edit')}
          </Link>
        </div>
        <p className="text-sm text-[var(--muted)] leading-snug">
          {t('homeHero.waitingForOthers')}
        </p>
      </div>
    );
  }

  const style = UNIFIED_STYLE;
  const tier = getRankTier(rank.rank_position, t);
  const isTopRank = rank.rank_position === 1;
  const isTop3 = rank.rank_position <= 3;
  const periodLabel = axis === 'week' ? t('ranking.week') : axis === 'month' ? t('home.tabMonth') : t('home.tabYear');
  const name = profile?.display_name ?? t('homeHero.runner');
  const kmToNext = Math.max(0, Number(rank.km_to_next) || 0);
  const myKm = Number(rank.my_km) || 0;

  const progressToNext = !isTopRank && kmToNext > 0 && myKm > 0
    ? Math.min(95, Math.max(15, (myKm / (myKm + kmToNext)) * 100))
    : 100;

  // 2026-07-15 리뷰 fix: /social 은 tab 파라미터만 해석해 scope/axis 가 무시되고 친구 탭에
  // 착지했음 — 랭킹 상세는 /ranking (RankingBreakdown) 이 목적지.
  const goDetail = () => router.push('/ranking');

  return (
    <div className={`mx-4 mt-3 rounded-3xl ${style.cardBg} border ${style.cardBorder} shadow-sm overflow-hidden relative`}>
      <div className={`absolute -top-16 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full bg-gradient-to-br ${style.halo} blur-3xl pointer-events-none`} />

      <div role="tablist" className="relative flex p-1 mx-4 mt-4 rounded-full bg-white/60 dark:bg-zinc-900/60 backdrop-blur-md border border-white/40 dark:border-zinc-800">
        {AXIS_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setAxis(opt.id)}
            className={`flex-1 py-1.5 rounded-full text-xs font-bold transition-all active:scale-95 ${
              axis === opt.id
                ? `bg-white dark:bg-zinc-800 ${style.accent} shadow-sm`
                : 'text-[var(--muted)]'
            }`}
          >
            {t(opt.tKey)}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={goDetail}
        className="relative w-full px-5 pt-3 pb-4 text-center active:scale-[0.99] transition"
      >
        {/* build 168 #2: 1위 상패 산만 — scope·tier 라벨 한 줄로 압축, 부가 장식 제거.
            "자리를 지키고 있어요" 박스 + Crown + Sparkles 중복 → 메달 박스 안 아이콘 하나로 정리. */}
        <div className="flex items-center justify-center gap-1.5 mb-2 text-[13px] text-[var(--muted)] font-bold tracking-wide">
          <span>{rank.scope_label}</span>
          <span className="text-[var(--card-border)]">·</span>
          <span>{periodLabel}</span>
        </div>

        {isTopRank ? (
          // build 169 #10: 메달 박스 제거 — "1" 숫자가 주인공. Crown 은 작게 옆에 장식.
          <div className="flex flex-col items-center">
            <div className="flex items-center justify-center gap-2">
              <Crown size={32} className={`${style.accent} drop-shadow`} strokeWidth={2.5} />
              <span
                className={`leading-[0.9] font-extrabold tracking-tighter tabular-nums ${style.numberText}`}
                style={{ fontSize: '80px' }}
              >
                1
              </span>
              <span className="text-2xl font-extrabold text-[var(--foreground)] self-end pb-2">{rankSuffix(1, locale)}</span>
              <RankDeltaBadges history={history} t={t} accent={style.accent} />
            </div>
            <p className={`text-sm font-extrabold ${style.accent} mt-1`}>{t('homeHero.holdSpot')}</p>
            <p className="mt-0.5 text-[13px] text-[var(--muted)] font-bold">
              {t('rankingHero.outOfTotal')
                .replace('{total}', rank.total_in_scope.toLocaleString())
                .replace('{rank}', '1')}
            </p>
          </div>
        ) : (
          // 2위 이하 — 2026-08-09 hans: 숫자 축소(96→64px) + "총 N명 중 M등" 로 문맥 제공.
          <>
            <div className="flex items-center justify-center gap-3">
              {isTop3 && (
                <div className={`w-12 h-12 rounded-2xl ${style.medalBg} ${style.medalShadow} flex items-center justify-center flex-shrink-0`}>
                  <span className="text-xl drop-shadow-sm">{tier.icon}</span>
                </div>
              )}
              <div className="flex items-baseline">
                <span
                  className={`leading-[0.9] font-extrabold tracking-tighter tabular-nums ${style.numberText}`}
                  style={{ fontSize: '64px' }}
                >
                  {rank.rank_position}
                </span>
                <span className="text-2xl font-extrabold text-[var(--foreground)] ml-1">{rankSuffix(rank.rank_position, locale)}</span>
              </div>
              <RankDeltaBadges history={history} t={t} accent={style.accent} />
            </div>
            <p className="mt-1 text-[13px] text-[var(--muted)] font-bold">
              {t('rankingHero.outOfTotal')
                .replace('{total}', rank.total_in_scope.toLocaleString())
                .replace('{rank}', rank.rank_position.toLocaleString())}
            </p>
          </>
        )}

        <p className="mt-2 text-base">
          <span className={`font-bold ${style.accent}`}>{name}</span>
          <span className="text-[var(--muted)]"> · </span>
          <span className="font-semibold text-[var(--foreground)]">{myKm.toFixed(1)}km</span>
        </p>

        {!isTopRank && kmToNext > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-1.5 text-[13px]">
              <span className="font-semibold text-[var(--muted)]">{formatRank(rank.rank_position, locale)}</span>
              <span className={`font-extrabold ${style.accent}`}>
                <span className="font-black">{t('homeHero.kmMore').replace('{km}', kmToNext.toFixed(1))}</span> {t('homeHero.toRankAbbr').replace('{rank}', String(rank.target_rank))}
              </span>
            </div>
            <div className="h-2 rounded-full bg-white/60 dark:bg-zinc-800/60 overflow-hidden shadow-inner">
              <div
                className={`h-full rounded-full transition-all duration-1000 ease-out ${style.progressBg}`}
                style={{ width: `${progressToNext}%` }}
              />
            </div>
          </div>
        )}

        <RankSparkline history={history} t={t} />

        {!isTopRank && (
          <div className="mt-3 flex items-center justify-center gap-1 text-xs font-bold text-[var(--muted)]">
            <span>{t('homeHero.viewFullRanking')}</span>
            <ChevronRight size={12} />
          </div>
        )}
      </button>
    </div>
  );
}
