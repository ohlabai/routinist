'use client';

// 오늘의 우리 동네 TOP 10 — 가로 스크롤 카드.
// 2026-07-12 CCSS #2: 구 단위 → 시/도 단위 (회원 수 적어 구 단위는 거의 항상 빈 카드).
// 유저 region_si 없으면 노출 안 함. (프로필 유도는 MatchedRankBanner 에서 맡음)

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { dataCache, CACHE_KEYS, onCacheInvalidated } from '@/lib/data-cache';
import { useI18n } from '@/lib/i18n';
import { normalizeSidoLabel } from '@/lib/regions';

interface LocalRunner {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  today_km: number;
  rank_position: number;
}

export default function TodayLocalTop() {
  const { profile } = useAuth();
  const { tt, locale } = useI18n();
  const [runners, setRunners] = useState<LocalRunner[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryKey, setRetryKey] = useState(0);

  // cache invalidate listen — PullToRefresh 가 fresh fetch 트리거
  useEffect(() => {
    const off = onCacheInvalidated((prefix) => {
      if (prefix === '' || 'home:localtop:'.startsWith(prefix) || prefix.startsWith('home:localtop:')) {
        setRetryKey(k => k + 1);
      }
    });
    return off;
  }, []);

  const sidoLabel = normalizeSidoLabel(profile?.region_si);

  useEffect(() => {
    if (!profile?.region_si) {
      setLoading(false);
      return;
    }
    const cacheKey = `home:localtop:${normalizeSidoLabel(profile.region_si)}`;
    // stale-while-revalidate: 캐시 있으면 즉시 set, retryKey === 0 면 거기서 끝.
    const cached = dataCache.get<LocalRunner[]>(cacheKey);
    if (cached) {
      setRunners(cached.value);
      setLoading(false);
      if (retryKey === 0) return;
    } else {
      setLoading(true);
    }
    (async () => {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase.rpc('today_region_top', {
          target_si: profile.region_si,
          top_n: 10,
        });
        if (error) throw error;
        const value = (data ?? []) as LocalRunner[];
        setRunners(value);
        dataCache.set(cacheKey, value);
      } catch (e) {
        console.warn('[TodayLocalTop] 조회 실패', e);
      } finally {
        setLoading(false);
      }
    })();
    void CACHE_KEYS;
  }, [profile?.region_si, retryKey]);

  if (!profile?.region_si || !sidoLabel) return null;
  if (loading) return null;
  if (runners.length === 0) {
    return (
      <div className="mx-4 mt-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-4">
        <p className="text-sm font-bold text-[var(--foreground)]">
          {locale === 'en' ? `Today's ${sidoLabel} runs` : `오늘 ${sidoLabel} 러닝 기록`}
        </p>
        <p className="text-xs text-[var(--muted)] mt-1">
          {locale === 'en'
            ? `No one logged today yet. ${tt('가장 먼저 기록해보세요')}!`
            : `아직 오늘 기록한 사람이 없어요. ${tt('가장 먼저 기록해보세요')}!`}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between px-4 mb-2">
        <h3 className="text-sm font-bold text-[var(--foreground)]">
          {locale === 'en'
            ? `Today's ${sidoLabel} TOP ${Math.min(runners.length, 10)}`
            : `오늘 ${sidoLabel} TOP ${Math.min(runners.length, 10)}`}
        </h3>
        <Link href="/social/rankings" className="text-xs text-[var(--accent)] font-medium">
          {locale === 'en' ? 'Full ranking' : '전체 랭킹'}
        </Link>
      </div>
      <div className="flex gap-3 overflow-x-auto px-4 pb-2 scrollbar-hide">
        {runners.map((r) => (
          <Link
            key={r.user_id}
            href={`/social/user?id=${r.user_id}`}
            className="flex-shrink-0 w-[112px] rounded-2xl bg-[var(--card)] border border-[var(--card-border)] p-3 text-center active:scale-[0.98] transition"
          >
            <div className="relative w-14 h-14 mx-auto mb-2 rounded-full bg-[var(--card-border)] overflow-hidden">
              {r.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-lg font-bold text-[var(--muted)]">
                  {r.display_name.slice(0, 1)}
                </div>
              )}
              <span
                className={`absolute -top-1 -left-1 w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center text-white ${
                  r.rank_position === 1 ? 'bg-amber-500' :
                  r.rank_position === 2 ? 'bg-gray-400' :
                  r.rank_position === 3 ? 'bg-amber-700' : 'bg-[var(--accent)]'
                }`}
              >
                {r.rank_position}
              </span>
            </div>
            <p className="text-xs font-medium text-[var(--foreground)] truncate">{r.display_name}</p>
            <p className="text-[11px] text-[var(--muted)] mt-0.5">{r.today_km.toFixed(1)}km</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
