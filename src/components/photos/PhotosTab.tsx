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
import { useI18n, type TranslationKey } from '@/lib/i18n';

type Sub = 'trending' | 'friends' | 'region' | 'recent' | 'liked';

const SUBS: { id: Sub; tKey: TranslationKey; Icon: typeof Flame }[] = [
  { id: 'trending', tKey: 'photos.subTrending', Icon: Flame },
  { id: 'friends', tKey: 'photos.subFriends', Icon: Users },
  { id: 'region', tKey: 'photos.subRegion', Icon: MapPin },
  { id: 'recent', tKey: 'photos.subRecent', Icon: Clock },
  { id: 'liked', tKey: 'photos.subLiked', Icon: Heart },
];

export default function PhotosTab() {
  const { user, profile } = useAuth();
  const { t } = useI18n();
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
        <span>{t('photos.uploadCta')}</span>
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
            {t(s.tKey)}
          </button>
        ))}
      </div>

      <PhotoGrid
        photos={photos}
        loading={loading}
        emptyText={
          sub === 'friends'
            ? t('photos.emptyFriends')
            : sub === 'region' && !profile?.region_gu
            ? t('photos.emptyRegionNoLoc')
            : sub === 'region'
            ? t('photos.emptyRegion').replace('{region}', profile?.region_gu ?? '')
            : sub === 'liked'
            ? t('photos.emptyLiked')
            : t('photos.emptyDefault')
        }
      />
    </div>
  );
}
