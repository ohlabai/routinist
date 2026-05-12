'use client';

// 이번 주 내 친구들 미니 리더보드.
// 친구(=내가 팔로우한 유저) + 나 포함 이번 주 km 합계 비교.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import type { Profile } from '@/types';
import { Users, ChevronRight } from 'lucide-react';
import { startOfWeekStr } from '@/lib/kst';

interface Row {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  km: number;
  isMe: boolean;
}

function startOfWeek(): string {
  return startOfWeekStr();
}

export default function FriendsLeaderboard() {
  const { user, profile } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data: followingRows } = await supabase
          .from('follows')
          .select('following_id, profiles!follows_following_id_fkey(id, display_name, avatar_url)')
          .eq('follower_id', user.id);

        const friends: { id: string; display_name: string; avatar_url: string | null }[] = (followingRows ?? [])
          .map((r: { profiles: unknown }) => r.profiles as Profile | null)
          .filter((p): p is Profile => !!p);

        const userIds = [user.id, ...friends.map(f => f.id)];
        if (userIds.length <= 1) {
          setRows([]);
          return;
        }

        const weekStart = startOfWeek();
        const { data: acts } = await supabase
          .from('activities')
          .select('user_id, distance_km')
          .in('user_id', userIds)
          .gte('activity_date', weekStart);

        const kmByUser = new Map<string, number>();
        (acts ?? []).forEach(a => kmByUser.set(a.user_id, (kmByUser.get(a.user_id) ?? 0) + Number(a.distance_km)));

        const all: Row[] = [
          {
            user_id: user.id,
            display_name: profile?.display_name ?? '나',
            avatar_url: profile?.avatar_url ?? null,
            km: kmByUser.get(user.id) ?? 0,
            isMe: true,
          },
          ...friends.map(f => ({
            user_id: f.id,
            display_name: f.display_name,
            avatar_url: f.avatar_url,
            km: kmByUser.get(f.id) ?? 0,
            isMe: false,
          })),
        ];
        all.sort((a, b) => b.km - a.km);
        setRows(all);
      } catch (e) {
        console.warn('[FriendsLeaderboard] 조회 실패', e);
        setRows([]);
      }
    })();
  }, [user, profile]);

  if (!rows) return null;

  if (rows.length <= 1) {
    return (
      <div className="mx-4 mt-3 rounded-2xl border border-dashed border-[var(--card-border)] p-4 text-center">
        <Users size={22} className="mx-auto text-[var(--muted)] mb-1" />
        <p className="text-sm font-medium text-[var(--foreground)]">친구와 함께 달려보세요</p>
        <p className="text-xs text-[var(--muted)] mt-1">랭킹에서 친구를 추가하면 이번 주 비교가 여기에 나타나요</p>
      </div>
    );
  }

  const maxKm = Math.max(...rows.map(r => r.km), 1);
  const visibleRows = rows.slice(0, 5);
  const hasMore = rows.length > 5;

  return (
    <div className="mx-4 mt-3 rounded-2xl bg-[var(--card)] border border-[var(--card-border)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-[var(--foreground)]">이번 주 친구 비교</h3>
        {hasMore ? (
          <Link
            href="/social?tab=friends"
            className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-0.5 active:scale-95 transition"
          >
            전체 {rows.length}명 보기 <ChevronRight size={11} />
          </Link>
        ) : (
          <span className="text-[10px] text-[var(--muted)]">월요일 기준</span>
        )}
      </div>
      <div className="space-y-2.5">
        {visibleRows.map((r, i) => (
          <Link
            key={r.user_id}
            href={r.isMe ? '/profile' : `/social/user?id=${r.user_id}`}
            className="flex items-center gap-2.5"
          >
            {/* Medal 스타일 랭킹 배지 — 동그라미 가운데 정렬 (사용자 피드백 build 100) */}
            <span className={`w-7 h-7 inline-flex items-center justify-center text-xs font-extrabold rounded-full flex-shrink-0 tabular-nums ${
              i === 0
                ? 'bg-gradient-to-br from-amber-300 to-yellow-500 text-white shadow-sm'
                : i === 1
                  ? 'bg-gradient-to-br from-slate-300 to-slate-500 text-white shadow-sm'
                  : i === 2
                    ? 'bg-gradient-to-br from-orange-300 to-amber-600 text-white shadow-sm'
                    : 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
            }`}>
              {i + 1}
            </span>
            <div className="w-8 h-8 rounded-full bg-[var(--card-border)] overflow-hidden flex-shrink-0">
              {r.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[11px] font-bold text-[var(--muted)]">
                  {r.display_name.slice(0, 1)}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between">
                <span className={`text-sm truncate ${r.isMe ? 'font-bold text-emerald-700 dark:text-emerald-400' : 'font-semibold text-[var(--foreground)]'}`}>
                  {r.display_name}{r.isMe ? ' (나)' : ''}
                </span>
                <span className="text-xs text-[var(--muted)] ml-2 font-semibold tabular-nums">{r.km.toFixed(1)}km</span>
              </div>
              <div className="mt-1 h-1.5 bg-[var(--card-border)] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${r.isMe ? 'bg-gradient-to-r from-emerald-400 to-emerald-600' : 'bg-emerald-400/70'}`}
                  style={{ width: `${(r.km / maxKm) * 100}%` }}
                />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
