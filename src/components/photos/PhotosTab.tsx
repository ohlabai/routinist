'use client';

// 소셜 > 포토 탭 — 5개 sub: 인기 / 친구 / 동네 / 최신 / 좋아요함
// Pinterest 2컬럼 그리드 + 상단 "사진 올리기" CTA (그린 잔디블록 테마).

import { useCallback, useEffect, useState } from 'react';
import { Flame, Users, MapPin, Clock, Heart, Camera } from 'lucide-react';
import PhotoGrid from './PhotoGrid';
import PhotoUploader from './PhotoUploader';
import {
  fetchTrendingPhotos,
  fetchRecentPhotos,
  fetchFriendPhotos,
  fetchRegionPhotos,
  fetchMyLikedPhotos,
  applyLikedFlags,
  type RoutinePhoto,
} from '@/lib/routine-photos';
import { fetchFollowing } from '@/lib/social-data';
import { useAuth } from '@/components/AuthProvider';

type Sub = 'trending' | 'friends' | 'region' | 'recent' | 'liked';

const SUBS: { id: Sub; label: string; Icon: typeof Flame }[] = [
  { id: 'trending', label: '인기', Icon: Flame },
  { id: 'friends', label: '친구', Icon: Users },
  { id: 'region', label: '동네', Icon: MapPin },
  { id: 'recent', label: '최신', Icon: Clock },
  { id: 'liked', label: '좋아요', Icon: Heart },
];

export default function PhotosTab() {
  const { user, profile } = useAuth();
  const [sub, setSub] = useState<Sub>('trending');
  const [photos, setPhotos] = useState<RoutinePhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    let result: RoutinePhoto[] = [];
    try {
      if (sub === 'trending') {
        result = await fetchTrendingPhotos(50);
      } else if (sub === 'friends') {
        const following = await fetchFollowing(user.id);
        result = await fetchFriendPhotos(following.map(f => f.id), { limit: 50 });
      } else if (sub === 'region') {
        if (profile?.region_gu) {
          result = await fetchRegionPhotos(profile.region_gu, { limit: 50 });
        }
      } else if (sub === 'recent') {
        result = await fetchRecentPhotos({ limit: 50 });
      } else if (sub === 'liked') {
        result = await fetchMyLikedPhotos({ limit: 50 });
      }
      // view 에 liked_by_me 가 비어있을 수 있어 클라사이드 일괄 적용.
      // 좋아요 탭은 모두 liked 라 skip.
      if (sub !== 'liked') {
        result = await applyLikedFlags(result);
      } else {
        result = result.map(p => ({ ...p, liked_by_me: true }));
      }
    } catch (e) {
      console.warn('[PhotosTab] load 실패', e);
    }
    setPhotos(result);
    setLoading(false);
  }, [sub, user, profile?.region_gu]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [load, reloadKey]);

  return (
    <div className="space-y-4">
      {/* 업로드 CTA — 상단 고정 (그린) */}
      <PhotoUploader
        className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-bold text-base shadow-md active:scale-[0.99] transition"
        onUploaded={() => setReloadKey(k => k + 1)}
      >
        <Camera size={20} />
        <span>오늘 러닝 사진 올리기</span>
      </PhotoUploader>

      {/* Sub 탭 — 가로 스크롤 pill */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-1 px-1">
        {SUBS.map(s => (
          <button
            key={s.id}
            onClick={() => setSub(s.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-semibold whitespace-nowrap transition-all ${
              sub === s.id
                ? 'bg-emerald-500 text-white shadow-sm'
                : 'bg-[var(--card-bg)] text-[var(--muted)] border border-[var(--card-border)]'
            }`}
          >
            <s.Icon size={15} />
            {s.label}
          </button>
        ))}
      </div>

      <PhotoGrid
        photos={photos}
        loading={loading}
        emptyText={
          sub === 'friends'
            ? '친구가 올린 사진이 없어요. 친구 탭에서 러너를 친구로 추가해보세요!'
            : sub === 'region' && !profile?.region_gu
            ? '지역을 설정하면 내 동네 사진이 여기 보여요'
            : sub === 'region'
            ? `${profile?.region_gu} 에서 올린 사진이 아직 없어요`
            : sub === 'liked'
            ? '아직 좋아요한 사진이 없어요'
            : '오늘 러닝 기록이 있다면 위 버튼으로 공유카드를 만들어 첫 번째 루틴포토가 되어보세요!'
        }
      />
    </div>
  );
}
