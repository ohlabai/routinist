'use client';

// 이번 주 "나를 쫓는 사람" + "따라잡기 타겟" — 경쟁 자극 위젯.
// 내 앞 3명 (따라잡기 대상) + 나 + 내 뒤 3명 (나를 쫓는 사람).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Zap } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { dataCache, CACHE_KEYS, onCacheInvalidated } from '@/lib/data-cache';

interface Neighbor {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  region_gu: string | null;
  weekly_km: number;
  rank_position: number;
  is_me: boolean;
}

export default function RankNeighbors() {
  const { user, profile } = useAuth();
  const [rows, setRows] = useState<Neighbor[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryKey, setRetryKey] = useState(0);

  // cache-invalidated 이벤트 listen — PullToRefresh 가 발사하면 fresh fetch.
  useEffect(() => {
    const off = onCacheInvalidated((prefix) => {
      if (prefix === '' || 'hero:neighbors:'.startsWith(prefix) || prefix.startsWith('hero:neighbors:')) {
        setRetryKey(k => k + 1);
      }
    });
    return off;
  }, []);

  useEffect(() => {
    if (!user) return;
    if (!profile?.region_gu) { setLoading(false); return; }
    let cancelled = false;

    const cacheKey = CACHE_KEYS.rankNeighbors(user.id);
    // stale-while-revalidate: 캐시 있으면 즉시 set + retryKey === 0 면 거기서 끝.
    const cached = dataCache.get<Neighbor[]>(cacheKey);
    if (cached) {
      setRows(cached.value);
      setLoading(false);
      if (retryKey === 0) return;
    } else {
      setLoading(true);
    }

    (async () => {
      try {
        const supabase = getSupabase();
        const result = await Promise.race([
          supabase.rpc('weekly_rank_neighbors', {
            target_user_id: user.id,
            neighbor_count: 3,
          }),
          new Promise<{ data: null }>((resolve) =>
            setTimeout(() => resolve({ data: null }), 10000)
          ),
        ]);
        if (!cancelled) {
          const value = (result.data ?? []) as Neighbor[];
          if (value.length > 0) {
            setRows(value);
            dataCache.set(cacheKey, value);
          }
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, profile?.region_gu, retryKey]);

  // 로딩/빈 상태에선 자리 차지 없이 사라짐 — 신규 사용자 첫 인상 개선
  if (loading || rows.length <= 1) return null;

  const meIdx = rows.findIndex(r => r.is_me);
  const ahead = rows.slice(0, meIdx);
  const me = rows[meIdx];
  const behind = rows.slice(meIdx + 1);
  const target = ahead[ahead.length - 1]; // 바로 앞 러너
  const chaser = behind[0]; // 바로 뒤 러너

  const kmToTarget = target ? target.weekly_km - me.weekly_km : 0;
  const kmFromChaser = chaser ? me.weekly_km - chaser.weekly_km : 0;

  return (
    <div className="mx-4 mt-4 rounded-3xl bg-gradient-to-br from-emerald-50 via-white to-emerald-50/30 dark:from-emerald-950/30 dark:via-zinc-900 dark:to-emerald-950/10 border border-emerald-200/60 dark:border-emerald-900/30 p-4 shadow-sm">
      <div className="flex items-center gap-1.5 mb-3">
        <Zap size={18} className="text-emerald-600" />
        <h3 className="text-base font-bold text-[var(--foreground)]">이번 주 내 주변 러너</h3>
        <span className="text-xs text-[var(--muted)] ml-auto">월요일 기준</span>
      </div>

      {/* 따라잡기 타겟 (바로 앞) */}
      {target && (
        <div className="mb-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/20 flex items-center gap-2">
          <span className="text-sm">🎯</span>
          <p className="text-xs font-semibold text-[var(--foreground)] flex-1">
            <span className="text-amber-600 font-extrabold">{kmToTarget.toFixed(1)}km</span> 더 달리면{' '}
            <span className="font-bold">{target.display_name}</span>님을 제칠 수 있어요!
          </p>
        </div>
      )}

      <div className="space-y-1">
        {rows.map(r => (
          <Link
            key={r.user_id}
            href={r.is_me ? '/profile' : `/social/user?id=${r.user_id}`}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${
              r.is_me ? 'bg-gradient-to-r from-emerald-100 to-emerald-200/70 dark:from-emerald-950/40 dark:to-emerald-900/40 ring-2 ring-emerald-300 dark:ring-emerald-700' : ''
            }`}
          >
            <span className={`w-6 text-center text-xs font-bold ${r.rank_position <= 3 ? 'text-amber-500' : 'text-[var(--muted)]'}`}>
              {r.rank_position}
            </span>
            <div className="w-6 h-6 rounded-full bg-[var(--card-border)] overflow-hidden flex-shrink-0">
              {r.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[9px] font-bold text-[var(--muted)]">
                  {r.display_name.slice(0, 1)}
                </div>
              )}
            </div>
            <span className={`flex-1 text-xs truncate ${r.is_me ? 'font-extrabold text-emerald-700 dark:text-emerald-400' : 'font-medium text-[var(--foreground)]'}`}>
              {r.display_name}{r.is_me ? ' (나)' : ''}
            </span>
            <span className="text-xs text-[var(--muted)] font-semibold">
              {r.weekly_km.toFixed(1)}km
            </span>
          </Link>
        ))}
      </div>

      {/* 나를 쫓는 사람 */}
      {chaser && kmFromChaser >= 0 && (
        <div className="mt-2 px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/20 flex items-center gap-2">
          <span className="text-sm">⚠️</span>
          <p className="text-xs font-semibold text-[var(--foreground)] flex-1">
            <span className="font-bold">{chaser.display_name}</span>님이{' '}
            <span className="text-rose-600 font-extrabold">{kmFromChaser.toFixed(1)}km</span> 차이로 쫓고 있어요
          </p>
        </div>
      )}

      <Link
        href="/social?tab=friends"
        className="mt-3 flex items-center justify-center gap-0.5 text-xs font-semibold text-emerald-600"
      >
        전체 랭킹 보기 <ChevronRight size={14} />
      </Link>
    </div>
  );
}
