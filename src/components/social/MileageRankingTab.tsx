'use client';

// 마일리지 랭킹 — profiles.mileage_balance DESC. 전체 / 우리 동네 / 우리 또래 필터.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Trophy, MapPin, UserCircle2 } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { dataCache, onCacheInvalidated } from '@/lib/data-cache';

type Scope = 'all' | 'gu' | 'age';

interface Row {
  id: string;
  display_name: string;
  avatar_url: string | null;
  region_gu: string | null;
  birth_year: number | null;
  gender: string | null;
  mileage_balance: number;
}

const TABS: { id: Scope; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'gu', label: '우리 동네' },
  { id: 'age', label: '우리 또래' },
];

export default function MileageRankingTab() {
  const { user, profile } = useAuth();
  const [scope, setScope] = useState<Scope>('all');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryKey, setRetryKey] = useState(0);

  // cache invalidation 이벤트 listen — PullToRefresh 에서 발사 시 fresh fetch
  useEffect(() => {
    const off = onCacheInvalidated((prefix) => {
      if (prefix === '' || prefix.startsWith('ranking:mileage')) {
        setRetryKey(k => k + 1);
      }
    });
    return off;
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const cacheKey = `ranking:mileage:${scope}:${profile?.region_gu ?? ''}:${profile?.birth_year ?? ''}:${profile?.gender ?? ''}`;

    // 캐시 우선
    const cached = dataCache.get<Row[]>(cacheKey);
    if (cached && retryKey === 0) {
      setRows(cached.value);
      setLoading(false);
      return;
    }
    if (!cached) setLoading(true);

    (async () => {
      try {
        const supabase = getSupabase();
        let q = supabase
          .from('profiles')
          .select('id, display_name, avatar_url, region_gu, birth_year, gender, mileage_balance')
          .eq('is_public', true)
          .gt('mileage_balance', 0)
          .order('mileage_balance', { ascending: false })
          .limit(100);

        if (scope === 'gu' && profile?.region_gu) {
          q = q.eq('region_gu', profile.region_gu);
        } else if (scope === 'age' && profile?.birth_year && profile?.gender) {
          // 또래: 같은 10년 단위 + 같은 성별
          const decade = Math.floor((profile.birth_year - 1900) / 10) * 10 + 1900;
          q = q.gte('birth_year', decade)
               .lt('birth_year', decade + 10)
               .eq('gender', profile.gender);
        }

        const { data, error } = await q;
        if (cancelled) return;
        if (error) throw error;
        const value = (data ?? []) as Row[];
        setRows(value);
        if (value.length > 0) dataCache.set(cacheKey, value);
      } catch (e) {
        console.warn('[MileageRanking] 조회 실패', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, scope, profile?.region_gu, profile?.birth_year, profile?.gender, retryKey]);

  // 또래/동네 탭에서 프로필 정보 누락 시 안내
  const cantUseScope =
    (scope === 'gu' && !profile?.region_gu) ||
    (scope === 'age' && (!profile?.birth_year || !profile?.gender));

  return (
    <div className="px-4 pt-2">
      {/* 필터 */}
      <div className="flex gap-2 mb-3">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setScope(t.id)}
            className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-colors ${
              scope === t.id
                ? 'bg-emerald-500 text-white'
                : 'bg-[var(--card)] text-[var(--muted)] border border-[var(--card-border)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {cantUseScope && (
        <div className="card p-4 text-center">
          <p className="text-sm text-[var(--muted)] mb-3">
            {scope === 'gu' ? '지역(시·구)' : '출생연도·성별'} 정보를 입력하면 표시됩니다
          </p>
          <Link href="/profile/edit" className="text-sm font-semibold text-emerald-600">
            내 프로필 편집 →
          </Link>
        </div>
      )}

      {!cantUseScope && loading && (
        <div className="flex justify-center py-8">
          <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
        </div>
      )}

      {!cantUseScope && !loading && rows.length === 0 && (
        <div className="card p-6 text-center">
          <Trophy size={28} className="mx-auto text-[var(--muted)] opacity-40 mb-2" />
          <p className="text-sm text-[var(--muted)]">아직 마일리지를 모은 러너가 없어요</p>
          <p className="text-xs text-[var(--muted)] mt-1">달리고 첫 번째 1위가 되세요!</p>
        </div>
      )}

      {!cantUseScope && rows.length > 0 && (
        <div className="card divide-y divide-[var(--card-border)]">
          {rows.map((r, idx) => {
            const isMe = r.id === user?.id;
            return (
              <div key={r.id} className={`flex items-center gap-3 p-3 ${isMe ? 'bg-emerald-50/60 dark:bg-emerald-950/20' : ''}`}>
                <span className={`w-7 text-center text-sm font-bold ${idx < 3 ? 'text-emerald-600' : 'text-[var(--muted)]'}`}>
                  {idx + 1}
                </span>
                <div className="w-9 h-9 rounded-full bg-[var(--card-border)] overflow-hidden flex-shrink-0">
                  {r.avatar_url ? (
                    <Image src={r.avatar_url} alt="" width={36} height={36} className="w-full h-full object-cover" />
                  ) : (
                    <UserCircle2 size={36} className="text-[var(--muted)]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--foreground)] truncate">
                    {r.display_name}{isMe && <span className="ml-1 text-emerald-600">(나)</span>}
                  </p>
                  {r.region_gu && (
                    <p className="text-xs text-[var(--muted)] flex items-center gap-1">
                      <MapPin size={11} /> {r.region_gu}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-base font-bold text-emerald-600 tabular-nums">{r.mileage_balance.toLocaleString()}</p>
                  <p className="text-[10px] text-[var(--muted)]">마일</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
