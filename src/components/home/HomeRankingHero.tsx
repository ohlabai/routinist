'use client';

// 홈 히어로 — 경쟁·소셜 피벗(2026-04-21) 의 핵심 장치.
// build 100 재디자인: 순위별 컬러 시스템 (gold/silver/bronze/emerald) + halo deco + tier badge + 진행 progress bar.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Trophy, ChevronRight, UserPlus, Crown, Sparkles } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { logClientInfo, logClientWarn } from '@/lib/error-logger';
import { dataCache, CACHE_KEYS, onCacheInvalidated } from '@/lib/data-cache';

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

const AXIS_OPTIONS: { id: TimeAxis; label: string }[] = [
  { id: 'today', label: '오늘' },
  { id: 'month', label: '이달' },
  { id: 'year', label: '올해' },
];

// 순위별 컬러 시스템 — Tailwind JIT 가 스캔할 수 있도록 클래스 문자열 그대로 명시
function getRankStyle(rank: number) {
  if (rank === 1) {
    return {
      cardBg: 'bg-gradient-to-br from-amber-100 via-yellow-50 to-amber-50 dark:from-amber-950/40 dark:via-yellow-950/20 dark:to-amber-950/30',
      cardBorder: 'border-amber-300/60 dark:border-amber-700/40',
      halo: 'from-amber-300/50 via-yellow-200/30 to-transparent',
      numberText: 'bg-gradient-to-br from-amber-500 via-yellow-500 to-amber-700 bg-clip-text text-transparent',
      medalBg: 'bg-gradient-to-br from-amber-400 to-yellow-500',
      medalShadow: 'shadow-[0_8px_24px_-4px_rgba(245,158,11,0.5)]',
      accent: 'text-amber-700 dark:text-amber-400',
      progressBg: 'bg-gradient-to-r from-amber-400 to-yellow-500',
      icon: '👑',
      label: '챔피언',
    };
  }
  if (rank === 2) {
    return {
      cardBg: 'bg-gradient-to-br from-slate-100 via-zinc-50 to-slate-50 dark:from-slate-800/50 dark:via-zinc-900 dark:to-slate-800/40',
      cardBorder: 'border-slate-300/60 dark:border-slate-700/40',
      halo: 'from-slate-300/40 via-zinc-200/30 to-transparent',
      numberText: 'bg-gradient-to-br from-slate-500 via-zinc-500 to-slate-700 bg-clip-text text-transparent',
      medalBg: 'bg-gradient-to-br from-slate-300 to-slate-500',
      medalShadow: 'shadow-[0_8px_24px_-4px_rgba(100,116,139,0.4)]',
      accent: 'text-slate-700 dark:text-slate-300',
      progressBg: 'bg-gradient-to-r from-slate-300 to-slate-500',
      icon: '🥈',
      label: '준우승권',
    };
  }
  if (rank === 3) {
    return {
      cardBg: 'bg-gradient-to-br from-orange-100 via-amber-50 to-orange-50 dark:from-orange-950/40 dark:via-amber-950/20 dark:to-orange-950/30',
      cardBorder: 'border-orange-300/60 dark:border-orange-800/40',
      halo: 'from-orange-300/40 via-amber-200/30 to-transparent',
      numberText: 'bg-gradient-to-br from-orange-500 via-amber-600 to-orange-700 bg-clip-text text-transparent',
      medalBg: 'bg-gradient-to-br from-orange-400 to-amber-600',
      medalShadow: 'shadow-[0_8px_24px_-4px_rgba(234,88,12,0.4)]',
      accent: 'text-orange-700 dark:text-orange-400',
      progressBg: 'bg-gradient-to-r from-orange-400 to-amber-600',
      icon: '🥉',
      label: '메달권',
    };
  }
  if (rank <= 10) {
    return {
      cardBg: 'bg-gradient-to-br from-emerald-100/70 via-white to-emerald-50/40 dark:from-emerald-950/30 dark:via-zinc-900 dark:to-emerald-950/20',
      cardBorder: 'border-emerald-300/50 dark:border-emerald-800/40',
      halo: 'from-emerald-300/40 via-emerald-100/30 to-transparent',
      numberText: 'text-emerald-600 dark:text-emerald-400',
      medalBg: 'bg-gradient-to-br from-emerald-400 to-emerald-600',
      medalShadow: 'shadow-[0_8px_24px_-4px_rgba(16,185,129,0.35)]',
      accent: 'text-emerald-700 dark:text-emerald-400',
      progressBg: 'bg-gradient-to-r from-emerald-400 to-emerald-600',
      icon: '⭐',
      label: 'TOP 10',
    };
  }
  return {
    cardBg: 'bg-gradient-to-br from-zinc-50 via-white to-emerald-50/30 dark:from-zinc-900 dark:via-zinc-900 dark:to-emerald-950/10',
    cardBorder: 'border-[var(--card-border)]/60',
    halo: 'from-emerald-200/30 via-transparent to-transparent',
    numberText: 'text-[var(--foreground)]',
    medalBg: 'bg-gradient-to-br from-emerald-100 to-emerald-200 dark:from-emerald-950/40 dark:to-emerald-900/40',
    medalShadow: '',
    accent: 'text-emerald-700 dark:text-emerald-400',
    progressBg: 'bg-gradient-to-r from-emerald-400 to-emerald-500',
    icon: '🏃',
    label: '도전 중',
  };
}

export default function HomeRankingHero() {
  const { user, profile } = useAuth();
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
              랭킹 준비 중...
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
              네트워크가 안정되면 자동으로 표시돼요
            </p>
          </div>
          <button
            onClick={() => setRetryKey(k => k + 1)}
            className="text-xs font-bold text-slate-600 dark:text-slate-400 px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 active:scale-95 transition"
          >
            다시
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
              내 랭킹 보러가기 🏃‍♂️
            </p>
            <p className="text-sm text-[var(--muted)] mt-1 leading-5">
              지역·성별·출생년도를 입력하면<br/>비슷한 러너들 중 내 순위를 알려드려요
            </p>
          </div>
          <ChevronRight size={20} className="text-emerald-600 flex-shrink-0" />
        </div>
      </Link>
    );
  }

  if (!rank) {
    const conditionLabel = [
      profile?.region_si,
      profile?.region_gu,
      profile?.birth_year ? `${profile.birth_year}년생` : null,
      profile?.gender === 'male' ? '남성' : profile?.gender === 'female' ? '여성' : null,
    ].filter(Boolean).join(' · ');

    return (
      <div className="mx-4 mt-3 rounded-3xl bg-gradient-to-br from-emerald-100/80 via-white to-emerald-50 dark:from-emerald-950/30 dark:via-zinc-900 dark:to-emerald-950/10 border border-emerald-200/60 dark:border-emerald-900/30 p-5 shadow-sm">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-12 h-12 rounded-2xl bg-white dark:bg-zinc-900 shadow flex items-center justify-center flex-shrink-0">
            <Trophy size={22} className="text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-bold text-[var(--foreground)]">내 랭킹 조건</p>
            <p className="text-sm text-emerald-700 dark:text-emerald-400 font-semibold mt-0.5 truncate">
              {conditionLabel || '조건 입력 완료'}
            </p>
          </div>
          <Link
            href="/profile/edit"
            className="text-xs font-bold text-emerald-700 dark:text-emerald-300 px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-800 border border-emerald-200 dark:border-emerald-800 active:scale-95 transition flex-shrink-0"
          >
            수정
          </Link>
        </div>
        <p className="text-sm text-[var(--muted)] leading-snug">
          같은 조건의 다른 러너가 모이면 순위가 표시됩니다. 친구를 초대해보세요!
        </p>
      </div>
    );
  }

  const style = getRankStyle(rank.rank_position);
  const isTopRank = rank.rank_position === 1;
  const isTop3 = rank.rank_position <= 3;
  const periodLabel = axis === 'today' ? '오늘' : axis === 'month' ? '이달' : '올해';
  const name = profile?.display_name ?? '러너';
  const kmToNext = Math.max(0, Number(rank.km_to_next) || 0);
  const myKm = Number(rank.my_km) || 0;

  // 다음 순위까지 진행률 — my_km / (my_km + km_to_next).
  // 단순화: 0~100% 범위로 표시 (실제 의미는 "현재 위치에서 한 단계 위로 가는 거리감")
  const progressToNext = !isTopRank && kmToNext > 0 && myKm > 0
    ? Math.min(95, Math.max(15, (myKm / (myKm + kmToNext)) * 100))
    : 100;

  const goDetail = () => router.push(`/social?scope=${rank.scope_type}&axis=${axis}`);

  return (
    <div className={`mx-4 mt-3 rounded-3xl ${style.cardBg} border ${style.cardBorder} shadow-sm overflow-hidden relative`}>
      {/* 배경 halo deco — 우상단 미묘한 blur 그라데이션 (Top3 일수록 강렬) */}
      <div className={`absolute -top-16 -right-16 w-56 h-56 rounded-full bg-gradient-to-br ${style.halo} blur-3xl pointer-events-none`} />

      {/* segmented control — 글래스모피즘 */}
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
            {opt.label}
          </button>
        ))}
      </div>

      {/* 메인 영역 */}
      <button
        type="button"
        onClick={goDetail}
        className="relative w-full px-5 pt-4 pb-5 text-left active:scale-[0.99] transition"
      >
        {/* 메타 + tier badge */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted)] font-semibold tracking-wide uppercase">
            <span>{rank.scope_label}</span>
            <span className="text-[var(--card-border)]">·</span>
            <span>{periodLabel}</span>
          </div>
          <span className={`inline-flex items-center gap-1 text-[10px] font-extrabold ${style.accent} px-2 py-0.5 rounded-full bg-white/70 dark:bg-zinc-800/70 backdrop-blur-sm shadow-sm`}>
            <span>{style.icon}</span>
            <span>{style.label}</span>
          </span>
        </div>

        {/* 메인 — 메달 (Top3) + 큰 숫자 */}
        <div className="flex items-center gap-4">
          {isTop3 && (
            <div className={`w-16 h-16 rounded-2xl ${style.medalBg} ${style.medalShadow} flex items-center justify-center flex-shrink-0`}>
              <span className="text-3xl drop-shadow-sm">{style.icon}</span>
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span
                className={`leading-[0.85] font-extrabold tracking-tighter tabular-nums ${style.numberText}`}
                style={{ fontSize: isTop3 ? '64px' : '72px' }}
              >
                {rank.rank_position}
              </span>
              <span className="text-xl font-extrabold text-[var(--foreground)]">위</span>
              <span className="ml-auto text-[11px] text-[var(--muted)] font-bold whitespace-nowrap">
                / {rank.total_in_scope.toLocaleString()}명
              </span>
            </div>
            <p className="mt-2 text-sm">
              <span className={`font-bold ${style.accent}`}>{name}</span>
              <span className="text-[var(--muted)]"> · </span>
              <span className="font-semibold text-[var(--foreground)]">{myKm.toFixed(1)}km</span>
            </p>
          </div>
        </div>

        {/* 다음 순위까지 progress bar */}
        {!isTopRank && kmToNext > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-1.5 text-[11px]">
              <span className="font-semibold text-[var(--muted)]">{rank.rank_position}위</span>
              <span className={`font-extrabold ${style.accent}`}>
                <span className="font-black">{kmToNext.toFixed(1)}km</span> 더 → {rank.target_rank}위
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

        {/* 1위 메시지 박스 */}
        {isTopRank && (
          <div className="mt-4 px-3 py-2.5 rounded-xl bg-white/70 dark:bg-zinc-900/60 backdrop-blur-sm flex items-center gap-2 text-sm shadow-sm">
            <Crown size={16} className="text-amber-600 flex-shrink-0" />
            <span className="font-extrabold text-amber-700 dark:text-amber-400">자리를 지키고 있어요</span>
            <Sparkles size={14} className="ml-auto text-amber-500" />
          </div>
        )}

        {/* 일반 CTA hint */}
        {!isTopRank && (
          <div className="mt-3 flex items-center justify-end gap-1 text-xs font-bold text-[var(--muted)]">
            <span>전체 랭킹 보기</span>
            <ChevronRight size={12} />
          </div>
        )}
      </button>
    </div>
  );
}
