'use client';

// 친구 활동 스토리 (build 100) — 친구들 최근 72시간 사진 가로 스크롤.
// 인스타 스토리 스타일 (작은 9:16 카드). 클릭 시 친구 프로필.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { useI18n, ttl } from '@/lib/i18n';
import PhotoLightbox, { type LightboxPhoto } from '@/components/PhotoLightbox';

interface Story {
  photo_id: string;
  user_id: string;
  activity_id: string | null;
  display_name: string;
  avatar_url: string | null;
  photo_url: string;
  activity_date: string;
  distance_km: number;
  created_at: string;
  // build 219 #3: 좋아요 상태 영속화. lightbox 가 onLikeChange 로 갱신.
  liked_by_me?: boolean;
  like_count?: number;
}

export default function HomeFriendStories() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  // build 205 #2: 친구 카드 클릭 시 공유카드 이미지가 풀스크린으로 우선 노출 → 거기서 프로필 진입.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

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
        // build 166 #4: 한 친구가 사진 여러 장 올리면 dedupe 후 1개만 남아 limit 10 안에서 친구
        // 다양성이 크게 줄어든다 (예: 친구 A 가 사진 4장 → 1개 카드 → 나머지 카드는 친구 B/C 활동).
        // limit 을 넉넉히 40 으로 잡고 client 에서 activity dedupe → top 10 슬라이스.
        const { data } = await supabase
          .from('activity_photos')
          .select(`id, user_id, photo_url, created_at, activity_id, share_in_gallery,
                   profiles!activity_photos_user_id_fkey(display_name, avatar_url),
                   activities!activity_photos_activity_id_fkey(distance_km, activity_date)`)
          .in('user_id', friendIds)
          .eq('share_in_gallery', true)
          .gte('created_at', cutoff)
          .order('created_at', { ascending: false })
          .limit(40);

        if (cancelled) return;
        const rows: Story[] = (data ?? []).map((r: {
          id: string;
          user_id: string;
          activity_id: string | null;
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
            activity_id: r.activity_id,
            photo_url: r.photo_url,
            created_at: r.created_at,
            display_name: prof?.display_name ?? ttl('러너'),
            avatar_url: prof?.avatar_url ?? null,
            distance_km: act?.distance_km ?? 0,
            activity_date: act?.activity_date ?? '',
          };
        });
        // build 165 #2: 한 활동에 사진 여러 장 올리면 친구피드에 같은 활동이 N번 반복 (사용자 신고).
        // activity_id 기준 dedupe — 가장 최근 사진 1장만 (이미 created_at desc 정렬).
        // activity_id 가 null 인 경우는 사진별 노출 (예외).
        const seen = new Set<string>();
        const deduped = rows.filter(r => {
          if (!r.activity_id) return true;
          if (seen.has(r.activity_id)) return false;
          seen.add(r.activity_id);
          return true;
        });
        // build 166 #4: 다양한 친구 활동 노출 — 친구별로 가장 최근 활동만 1장씩 우선 슬라이싱,
        // 그 후 채워지지 않은 슬롯에 같은 친구의 추가 활동을 채운다. (총 10장)
        const byUser = new Map<string, Story[]>();
        deduped.forEach(r => {
          const arr = byUser.get(r.user_id) ?? [];
          arr.push(r);
          byUser.set(r.user_id, arr);
        });
        const result: Story[] = [];
        // round-robin: 각 친구의 i 번째 활동을 차례로 추가
        let idx = 0;
        let added = true;
        while (added && result.length < 10) {
          added = false;
          for (const list of byUser.values()) {
            if (list[idx] && result.length < 10) {
              result.push(list[idx]);
              added = true;
            }
          }
          idx += 1;
        }
        setStories(result);
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
        <h3 className="text-sm font-bold text-[var(--foreground)]">{t('home.friendStoriesTitle')}</h3>
        <Link href="/social?tab=photos" className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
          {t('home.friendStoriesSeeAll')}
        </Link>
      </div>
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 px-4">
        {stories.map((s, i) => (
          <button
            key={s.photo_id}
            onClick={() => setLightboxIndex(i)}
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
          </button>
        ))}
      </div>
      {lightboxIndex !== null && (
        <PhotoLightbox
          photos={stories.map((s): LightboxPhoto => ({
            photo_id: s.photo_id,
            photo_url: s.photo_url,
            display_name: s.display_name,
            distance_km: s.distance_km,
            user_id: s.user_id,
            liked_by_me: s.liked_by_me,
            like_count: s.like_count,
          }))}
          initialIndex={lightboxIndex}
          showProfileLink
          onClose={() => setLightboxIndex(null)}
          onLikeChange={(photoId, liked, count) => {
            setStories(prev => prev.map(p => p.photo_id === photoId
              ? { ...p, liked_by_me: liked, like_count: count }
              : p));
          }}
        />
      )}
    </div>
  );
}
