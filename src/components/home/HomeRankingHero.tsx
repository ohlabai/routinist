'use client';

// 홈 히어로 — 경쟁·소셜 피벗(2026-04-21) 의 핵심 장치.
// 그린 잔디블록 테마로 재디자인 (build 17+). 큰 타이포·심플한 정보 밀도.
// 탭 버튼 클릭 시 전체 카드가 다른 페이지로 네비게이션되는 버그 수정 — 외부 Link 제거.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Trophy, Sparkles, ChevronRight, UserPlus, TrendingUp } from 'lucide-react';
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

const AXIS_OPTIONS: { id: TimeAxis; label: string; emoji: string }[] = [
  { id: 'today', label: '오늘', emoji: '🔥' },
  { id: 'month', label: '이달', emoji: '📅' },
  { id: 'year', label: '올해', emoji: '🏆' },
];

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

    // 신문 모델 + stale-while-revalidate:
    // - 캐시 있으면 즉시 표시. retryKey === 0 면 거기서 끝 (네트워크 X).
    // - retryKey > 0 (사용자 새로고침 / cache-invalidated 이벤트) 면 캐시 표시 유지하면서 백그라운드 fresh fetch.
    //   → "잠시 hero 사라짐" 회귀 방지.
    // - build 59: fetch 실패해도 캐시 있으면 setError 안 함 — 사용자에게 일시 에러 보이지 않게.
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
        // 캐시 있으면 silent fallback — 사용자에게 일시 에러 안 보임. 백그라운드 갱신 실패는 무시.
        if (!cancelled && !hasCached) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [user, axis, retryKey, hasDemographics]);

  // PullToRefresh / 다른 곳에서 cache invalidate 이벤트 발사하면 재시도 트리거.
  // foreground 복귀 시 자동 재시도는 제거 — 매번 retry 가 hero 깜빡거림 유발 (build 58 회고).
  useEffect(() => {
    const off = onCacheInvalidated((prefix) => {
      // 우리 hero key 영향 받는 prefix 만 반응 (빈 prefix = clearAll, 'hero:' = hero 모두, 'hero:rank:' = 정확)
      if (prefix === '' || 'hero:rank:'.startsWith(prefix) || prefix.startsWith('hero:rank:')) {
        setRetryKey(k => k + 1);
      }
    });
    return off;
  }, []);

  if (loading) {
    return (
      <div className="mx-4 mt-3 rounded-3xl bg-gradient-to-br from-emerald-100/70 via-white to-emerald-50/40 dark:from-emerald-950/30 dark:via-zinc-900 dark:to-emerald-950/10 border border-emerald-200/50 dark:border-emerald-900/30 p-5 h-[120px] animate-pulse" />
    );
  }

  // 에러(RPC 타임아웃·실패) — 프로필은 있지만 불러오기 실패한 경우.
  // 빨간 alert 스타일 대신 부드러운 회색 placeholder + 작은 재시도 — UI 가 안 튐.
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

  // 1순위: 조건 미입력 → 입력 안내 CTA
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

  // 2순위: 조건은 입력됐지만 코호트 데이터 부족 → 입력된 조건 표시 + 안내
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

  const isTop3 = rank.rank_position <= 3;
  const isTop10 = rank.rank_position <= 10;
  const name = profile?.display_name ?? '러너';
  const kmToNext = Math.max(0, Number(rank.km_to_next) || 0);
  const hasProgressHint = kmToNext > 0 && rank.rank_position > 1;
  const isTopRank = rank.rank_position === 1;

  const goDetail = () => router.push(`/social?scope=${rank.scope_type}&axis=${axis}`);

  return (
    <div className="mx-4 mt-3 rounded-3xl overflow-hidden bg-gradient-to-br from-emerald-100/80 via-white to-emerald-50/40 dark:from-emerald-950/40 dark:via-zinc-900 dark:to-emerald-950/10 border border-emerald-200/60 dark:border-emerald-900/30 shadow-sm">
      {/* 시간축 탭 — 독립 컨트롤, 네비게이션 안 일어남 */}
      <div role="tablist" className="flex gap-1 px-4 pt-4">
        {AXIS_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setAxis(opt.id)}
            className={`flex items-center gap-1 px-3.5 py-2 rounded-full text-sm font-semibold transition-all ${
              axis === opt.id
                ? 'bg-emerald-500 text-white shadow-sm'
                : 'text-[var(--muted)] hover:text-emerald-600'
            }`}
          >
            <span>{opt.emoji}</span>
            <span>{opt.label}</span>
          </button>
        ))}
      </div>

      {/* 순위 표시 영역 — 탭하면 상세 이동 */}
      <button
        type="button"
        onClick={goDetail}
        className="w-full p-4 pt-3 text-left active:scale-[0.99] transition"
      >
        <div className="flex items-start gap-4">
          <div
            className={`w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-md ${
              isTop3
                ? 'bg-gradient-to-br from-emerald-400 to-emerald-600'
                : isTop10
                ? 'bg-gradient-to-br from-emerald-300 to-emerald-500'
                : 'bg-gradient-to-br from-emerald-200 to-emerald-400'
            }`}
          >
            {isTop3 ? (
              <Sparkles size={28} className="text-white drop-shadow" />
            ) : (
              <Trophy size={28} className="text-white drop-shadow" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-base text-[var(--muted)] leading-tight">
              <span className="font-bold text-emerald-700">{name}</span>님은{' '}
              <span className="font-semibold">{rank.scope_label}</span>에서
            </p>
            <div className="flex items-baseline gap-1 mt-1">
              <span
                className={`text-[64px] leading-none font-extrabold ${
                  isTop3
                    ? 'text-emerald-600'
                    : isTop10
                    ? 'text-emerald-500'
                    : 'text-[var(--foreground)]'
                }`}
              >
                {rank.rank_position}
              </span>
              <span className="text-3xl font-bold text-[var(--foreground)]">위</span>
              <span className="text-base text-[var(--muted)] ml-1">
                / {rank.total_in_scope}명
              </span>
            </div>
            <p className="text-base text-[var(--muted)] mt-1 font-semibold">
              {axis === 'today' ? '오늘' : axis === 'month' ? '이달' : '올해'} {Number(rank.my_km).toFixed(1)}km
            </p>
          </div>
        </div>

        {isTopRank ? (
          <div className="mt-4 rounded-2xl bg-white/80 backdrop-blur px-4 py-3.5">
            {/* 한 줄 보장: 폰트 살짝 줄이고 (lg → base) 메시지 간결화. 이전엔 좁은 카드에서 줄바꿈돼 "자리를 지켜보세 요." 처럼 끊김. */}
            <p className="text-base font-bold text-emerald-700 flex items-center gap-1.5 whitespace-nowrap">
              👑 {axis === 'today' ? '오늘의' : axis === 'month' ? '이달의' : '올해의'} 1위! 자리를 지켜요
            </p>
          </div>
        ) : hasProgressHint ? (
          <div className="mt-4 rounded-2xl bg-white/80 backdrop-blur px-4 py-3.5 flex items-center gap-2">
            <TrendingUp size={20} className="text-emerald-600 flex-shrink-0" />
            <p className="text-lg font-semibold text-[var(--foreground)] leading-snug">
              <span className="text-emerald-700 font-extrabold">{kmToNext.toFixed(1)}km</span> 더 달리면{' '}
              <span className="text-emerald-700 font-extrabold">{rank.target_rank}위</span>로 올라가요!
            </p>
          </div>
        ) : null}
      </button>
    </div>
  );
}
