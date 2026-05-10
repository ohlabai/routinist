'use client';

// 이번 주 내 친구들 미니 리더보드.
// 친구(=내가 팔로우한 유저) + 나 포함 이번 주 km 합계 비교.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import type { Profile } from '@/types';
import { Users } from 'lucide-react';
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

  return (
    <div className="mx-4 mt-3 rounded-2xl bg-[var(--card)] border border-[var(--card-border)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-[var(--foreground)]">이번 주 친구 비교</h3>
        <span className="text-[10px] text-[var(--muted)]">월요일 기준</span>
      </div>
      <div className="space-y-2">
        {rows.slice(0, 10).map((r, i) => (
          <Link
            key={r.user_id}
            href={r.isMe ? '/profile' : `/social/user?id=${r.user_id}`}
            className="flex items-center gap-2"
          >
            <span className={`w-5 text-xs font-bold text-center ${i === 0 ? 'text-amber-500' : 'text-[var(--muted)]'}`}>
              {i + 1}
            </span>
            <div className="w-7 h-7 rounded-full bg-[var(--card-border)] overflow-hidden flex-shrink-0">
              {r.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[10px] font-bold text-[var(--muted)]">
                  {r.display_name.slice(0, 1)}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between">
                <span className={`text-sm truncate ${r.isMe ? 'font-bold text-[var(--accent)]' : 'font-medium text-[var(--foreground)]'}`}>
                  {r.display_name}{r.isMe ? ' (나)' : ''}
                </span>
                <span className="text-xs text-[var(--muted)] ml-2">{r.km.toFixed(1)}km</span>
              </div>
              <div className="mt-1 h-1.5 bg-[var(--card-border)] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${r.isMe ? 'bg-[var(--accent)]' : 'bg-emerald-400/70'}`}
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
