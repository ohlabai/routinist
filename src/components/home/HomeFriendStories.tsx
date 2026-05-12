'use client';

// 친구 활동 스토리 (build 100) — 친구들 최근 72시간 사진 가로 스크롤.
// 인스타 스토리 스타일 (작은 9:16 카드). 클릭 시 친구 프로필.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';

interface Story {
  photo_id: string;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  photo_url: string;
  activity_date: string;
  distance_km: number;
  created_at: string;
}

export default function HomeFriendStories() {
  const { user } = useAuth();
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data: followingRows } = await supabase
          .from('follows')
          .select('following_id')
          .eq('follower_id', user.id);
        const friendIds = (followingRows ?? []).map((r: { following_id: string }) => r.following_id);
        if (friendIds.length === 0) {
          setLoading(false);
          return;
        }

        const cutoff = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
        const { data } = await supabase
          .from('activity_photos')
          .select(`id, user_id, photo_url, created_at, activity_id, share_in_gallery,
                   profiles!activity_photos_user_id_fkey(display_name, avatar_url),
                   activities!activity_photos_activity_id_fkey(distance_km, activity_date)`)
          .in('user_id', friendIds)
          .eq('share_in_gallery', true)
          .gte('created_at', cutoff)
          .order('created_at', { ascending: false })
          .limit(10);

        if (cancelled) return;
        const rows: Story[] = (data ?? []).map((r: {
          id: string;
          user_id: string;
          photo_url: string;
          created_at: string;
          profiles?: { display_name?: string; avatar_url?: string | null } | { display_name?: string; avatar_url?: string | null }[];
          activities?: { distance_km?: number; activity_date?: string } | { distance_km?: number; activity_date?: string }[];
        }) => {
          const prof = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
          const act = Array.isArray(r.activities) ? r.activities[0] : r.activities;
          return {
            photo_id: r.id,
            user_id: r.user_id,
            photo_url: r.photo_url,
            created_at: r.created_at,
            display_name: prof?.display_name ?? '러너',
            avatar_url: prof?.avatar_url ?? null,
            distance_km: act?.distance_km ?? 0,
            activity_date: act?.activity_date ?? '',
          };
        });
        setStories(rows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (loading || stories.length === 0) return null;

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2 mx-4">
        <h3 className="text-sm font-bold text-[var(--foreground)]">친구 활동 · 최근 72시간</h3>
        <Link href="/social?tab=photos" className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
          전체 보기 →
        </Link>
      </div>
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 px-4">
        {stories.map(s => (
          <Link
            key={s.photo_id}
            href={`/social/user?id=${s.user_id}`}
            className="flex-shrink-0 w-24 h-32 rounded-2xl overflow-hidden bg-[var(--card-border)] relative shadow-sm active:scale-95 transition"
          >
            <Image src={s.photo_url} alt="" fill className="object-cover" sizes="96px" unoptimized />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
            <div className="absolute top-1.5 left-1.5 right-1.5 flex items-center gap-1">
              <div className="w-6 h-6 rounded-full overflow-hidden ring-2 ring-white flex-shrink-0 bg-zinc-300">
                {s.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : null}
              </div>
              <p className="text-[10px] font-bold text-white truncate drop-shadow">{s.display_name}</p>
            </div>
            <p className="absolute bottom-1.5 left-2 right-2 text-[11px] font-extrabold text-white drop-shadow">
              {Number(s.distance_km).toFixed(1)}km
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
