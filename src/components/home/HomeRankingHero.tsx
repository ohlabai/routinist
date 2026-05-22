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
import { useI18n, type TranslationKey } from '@/lib/i18n';

type TimeAxis = 'today' | 'month' | 'year';

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
  { id: 'today', tKey: 'home.tabToday' },
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

export default function HomeRankingHero() {
  const { user, profile } = useAuth();
  const { t, locale } = useI18n();
  const router = useRouter();
  const [axis, setAxis] = useState<TimeAxis>('month');
  const [rank, setRank] = useState<HeroRank | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const hasDemographics = !!(profile?.region_gu || profile?.birth_year || profile?.gender);

  useEffect(() => {
    if (!user) return;
    if (!hasDemographics) { setLoading(false); return; }
    let cancelled = false;

    const cacheKey = CACHE_KEYS.heroRank(user.id, axis);
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
        const { data, error: rpcError } = await supabase.rpc('find_hero_rank', {
          target_user_id: user.id,
          time_axis: axis,
        });
        if (cancelled) return;
        clearTimeout(timeoutId);
        if (rpcError) throw rpcError;
        const row = Array.isArray(data) ? data[0] : data;
        const value = row ? (row as HeroRank) : null;
        setRank(value);
        dataCache.set(cacheKey, value);
        logClientInfo('HomeRankingHero', 'RPC ok', { ms: Date.now() - t0, hasRow: !!row, axis });
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        logClientWarn('HomeRankingHero', 'RPC fail', { reason, ms: Date.now() - t0, axis, hasCached });
        if (!cancelled && !hasCached) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [user, axis, retryKey, hasDemographics]);

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
            className="text-[11px] font-semibold text-[var(--muted)] underline underline-offset-2 active:scale-95 flex-shrink-0 self-start mt-1"
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
  const periodLabel = axis === 'today' ? t('home.tabToday') : axis === 'month' ? t('home.tabMonth') : t('home.tabYear');
  const name = profile?.display_name ?? t('homeHero.runner');
  const kmToNext = Math.max(0, Number(rank.km_to_next) || 0);
  const myKm = Number(rank.my_km) || 0;

  const progressToNext = !isTopRank && kmToNext > 0 && myKm > 0
    ? Math.min(95, Math.max(15, (myKm / (myKm + kmToNext)) * 100))
    : 100;

  const goDetail = () => router.push(`/social?scope=${rank.scope_type}&axis=${axis}`);

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
                className={`leading-[0.85] font-extrabold tracking-tighter tabular-nums ${style.numberText}`}
                style={{ fontSize: '128px' }}
              >
                1
              </span>
              <span className="text-3xl font-extrabold text-[var(--foreground)] self-end pb-2">{t('ranking.rank')}</span>
            </div>
            <p className={`text-sm font-extrabold ${style.accent} mt-1`}>{t('homeHero.holdSpot')}</p>
          </div>
        ) : (
          // 2위 이하 — 기존 압축형 (메달은 top3 만, 숫자 + 위)
          <>
            <div className="flex items-center justify-center gap-3">
              {isTop3 && (
                <div className={`w-14 h-14 rounded-2xl ${style.medalBg} ${style.medalShadow} flex items-center justify-center flex-shrink-0`}>
                  <span className="text-2xl drop-shadow-sm">{tier.icon}</span>
                </div>
              )}
              <div className="flex items-baseline">
                <span
                  className={`leading-[0.85] font-extrabold tracking-tighter tabular-nums ${style.numberText}`}
                  style={{ fontSize: '96px' }}
                >
                  {rank.rank_position}
                </span>
                <span className="text-3xl font-extrabold text-[var(--foreground)] ml-1">{t('ranking.rank')}</span>
              </div>
            </div>
            <p className="mt-1 text-xs text-[var(--muted)] font-bold">
              {t('rankingHero.peopleSlash').replace('{n}', rank.total_in_scope.toLocaleString())}
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
            <div className="flex items-center justify-between mb-1.5 text-[11px]">
              <span className="font-semibold text-[var(--muted)]">{rank.rank_position}{t('ranking.rank')}</span>
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
