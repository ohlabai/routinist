'use client';

// 인스타식 사진 캐러셀 + lightbox (build 118).
// 좌우 swipe / 화살표 / 키보드. 풀스크린.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { X, ChevronLeft, ChevronRight, Heart, MessageCircle } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/components/AuthProvider';
import { togglePhotoLike } from '@/lib/routine-photos';

export interface LightboxPhoto {
  photo_id: string;
  photo_url: string;
  display_name?: string;
  caption?: string | null;
  distance_km?: number | null;
  // build 205 #2: 친구 스토리에서 띄울 때 프로필 진입점 노출.
  user_id?: string | null;
  // build 215 #2: 좋아요 + 쪽지 액션 추가. 소셜 탭과 동일.
  liked_by_me?: boolean;
  like_count?: number;
}

interface Props {
  photos: LightboxPhoto[];
  initialIndex?: number;
  onClose: () => void;
  // 프로필 보기 버튼 노출 (친구 활동 entry 에서만 true).
  showProfileLink?: boolean;
  // build 219 #3: 좋아요 변경을 부모에 알려 photos prop 의 like_count/liked_by_me 를 영속화.
  // 부모가 안 받으면 닫았다 다시 열 때 상태가 초기값으로 돌아가 사용자에게 "DB 저장 안 됨" 으로 보임.
  onLikeChange?: (photoId: string, liked: boolean, count: number) => void;
}

export default function PhotoLightbox({ photos, initialIndex = 0, onClose, showProfileLink = false, onLikeChange }: Props) {
  const [index, setIndex] = useState(Math.max(0, Math.min(initialIndex, photos.length - 1)));
  const { tt } = useI18n();
  const { user } = useAuth();
  const startX = useRef<number | null>(null);
  const deltaX = useRef(0);
  // build 215 #2: 좋아요 optimistic 상태 — photo_id 별로 추적.
  // build 219 #3: photos prop 변경 시 초기값을 다시 흡수 (parent 가 like 업데이트 후 photos 를 갱신해 재오픈하면 반영).
  const [likeState, setLikeState] = useState<Map<string, { liked: boolean; count: number }>>(() => {
    const m = new Map<string, { liked: boolean; count: number }>();
    photos.forEach(p => m.set(p.photo_id, { liked: !!p.liked_by_me, count: p.like_count ?? 0 }));
    return m;
  });
  useEffect(() => {
    setLikeState(prev => {
      const m = new Map(prev);
      photos.forEach(p => {
        const cur = m.get(p.photo_id);
        // 이미 optimistic 상태가 있으면 유지, 없을 때만 prop 값 흡수.
        if (!cur) m.set(p.photo_id, { liked: !!p.liked_by_me, count: p.like_count ?? 0 });
      });
      return m;
    });
  }, [photos]);
  const [likeBusy, setLikeBusy] = useState(false);
  // build 219 #3: photos prop 에 like_count 가 누락된 경우 (홈 친구 스토리 등) 마운트 시 fetch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const needFetch = photos.filter(p => p.like_count == null || p.liked_by_me == null);
      if (needFetch.length === 0) return;
      try {
        const { getSupabase } = await import('@/lib/supabase');
        const supabase = getSupabase();
        const ids = needFetch.map(p => p.photo_id);
        // 누적 카운트
        const { data: counts } = await supabase
          .from('photo_likes')
          .select('photo_id')
          .in('photo_id', ids);
        const countMap = new Map<string, number>();
        (counts ?? []).forEach((r: { photo_id: string }) => {
          countMap.set(r.photo_id, (countMap.get(r.photo_id) ?? 0) + 1);
        });
        // 내가 좋아요한 것
        const likedIds = new Set<string>();
        if (user) {
          const { data: mine } = await supabase
            .from('photo_likes')
            .select('photo_id')
            .eq('user_id', user.id)
            .in('photo_id', ids);
          (mine ?? []).forEach((r: { photo_id: string }) => likedIds.add(r.photo_id));
        }
        if (cancelled) return;
        setLikeState(prev => {
          const m = new Map(prev);
          ids.forEach(id => {
            m.set(id, { liked: likedIds.has(id), count: countMap.get(id) ?? 0 });
          });
          return m;
        });
      } catch {
        // 조용히 무시
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') setIndex(i => Math.max(0, i - 1));
      else if (e.key === 'ArrowRight') setIndex(i => Math.min(photos.length - 1, i + 1));
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, photos.length]);

  const onTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    deltaX.current = 0;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (startX.current == null) return;
    deltaX.current = e.touches[0].clientX - startX.current;
  };

  const onTouchEnd = () => {
    if (Math.abs(deltaX.current) > 60) {
      if (deltaX.current > 0 && index > 0) setIndex(index - 1);
      else if (deltaX.current < 0 && index < photos.length - 1) setIndex(index + 1);
    }
    startX.current = null;
    deltaX.current = 0;
  };

  const handleLike = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (likeBusy || !user) return;
    const cur = likeState.get(current.photo_id);
    if (!cur) return;
    setLikeBusy(true);
    const nextLiked = !cur.liked;
    const nextCount = Math.max(0, cur.count + (nextLiked ? 1 : -1));
    setLikeState(prev => {
      const m = new Map(prev);
      m.set(current.photo_id, { liked: nextLiked, count: nextCount });
      return m;
    });
    try {
      await togglePhotoLike(current.photo_id, cur.liked);
      onLikeChange?.(current.photo_id, nextLiked, nextCount);
    } catch {
      // rollback
      setLikeState(prev => {
        const m = new Map(prev);
        m.set(current.photo_id, cur);
        return m;
      });
    } finally {
      setLikeBusy(false);
    }
  };

  if (photos.length === 0) return null;
  const current = photos[index];
  const curLike = likeState.get(current.photo_id) ?? { liked: false, count: 0 };
  const canActOnUser = !!user && !!current.user_id && user.id !== current.user_id;

  return (
    <div
      className="fixed inset-0 z-[95] bg-black/95 flex items-center justify-center animate-[fadeIn_0.2s_ease-out]"
      onClick={onClose}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={current.photo_url}
        alt=""
        className="max-w-full max-h-full object-contain rounded-lg select-none pointer-events-none"
      />

      {/* build 219 #1: 우상단 stack — X (닫기) + 하트 + 쪽지. 오른손 엄지 동선 최적화 */}
      <div
        className="absolute right-3 flex flex-col gap-2 z-10"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="w-12 h-12 rounded-full bg-white/20 active:bg-white/30 backdrop-blur flex items-center justify-center active:scale-95 transition"
          aria-label={tt('닫기')}
        >
          <X size={26} strokeWidth={2.5} className="text-white" />
        </button>
        <button
          onClick={handleLike}
          disabled={likeBusy || !user}
          aria-label={curLike.liked ? tt('좋아요 취소') : tt('좋아요')}
          className={`inline-flex items-center gap-1.5 px-3 h-12 rounded-full backdrop-blur active:scale-95 transition disabled:opacity-50 ${
            curLike.liked ? 'bg-rose-500/85' : 'bg-white/20 active:bg-white/30'
          }`}
        >
          <Heart size={20} fill={curLike.liked ? '#fff' : 'transparent'} strokeWidth={2.5} className="text-white" />
          {curLike.count > 0 && (
            <span className="text-xs font-extrabold text-white tabular-nums leading-none">{curLike.count}</span>
          )}
        </button>
        {canActOnUser && current.user_id && (
          <Link
            href={{ pathname: '/messages/chat/', query: { user: current.user_id } }}
            // build 220 #3: onClose() 호출 안 함 — lightbox 가 열려 있는 채로 채팅 화면으로 이동.
            // 채팅에서 뒤로가기 누르면 history 상 직전 페이지 (lightbox 가 떠 있는 홈) 로 복귀해
            // 사용자에게 일관된 흐름 제공.
            onClick={(e) => { e.stopPropagation(); }}
            aria-label={tt('쪽지 보내기')}
            className="w-12 h-12 rounded-full bg-white/20 active:bg-white/30 backdrop-blur flex items-center justify-center active:scale-95 transition"
          >
            <MessageCircle size={20} strokeWidth={2.5} className="text-white" />
          </Link>
        )}
      </div>

      {/* 좌우 — desktop / tablet */}
      {index > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); setIndex(index - 1); }}
          className="absolute left-3 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur flex items-center justify-center active:scale-95 transition z-10"
          aria-label="이전"
        >
          <ChevronLeft size={28} strokeWidth={2.5} className="text-white" />
        </button>
      )}
      {index < photos.length - 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); setIndex(index + 1); }}
          className="absolute right-3 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur flex items-center justify-center active:scale-95 transition z-10"
          aria-label="다음"
        >
          <ChevronRight size={28} strokeWidth={2.5} className="text-white" />
        </button>
      )}

      {/* 인디케이터 + 캡션 */}
      <div
        className="absolute left-4 right-4 bottom-[calc(env(safe-area-inset-bottom)+24px)] space-y-2"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 인디케이터 dots */}
        {photos.length > 1 && (
          <div className="flex items-center justify-center gap-1">
            {photos.map((_, i) => (
              <button
                key={i}
                onClick={() => setIndex(i)}
                aria-label={`사진 ${i + 1}`}
                className={`w-1.5 h-1.5 rounded-full transition ${i === index ? 'bg-white w-4' : 'bg-white/40'}`}
              />
            ))}
          </div>
        )}
        {(current.display_name || current.distance_km != null || current.caption) && (
          <div className="px-4 py-3 rounded-2xl bg-black/55 backdrop-blur-md text-white text-sm leading-relaxed">
            <div className="flex items-center gap-2">
              {current.display_name && <p className="font-extrabold flex-1 truncate">@{current.display_name}</p>}
              {current.distance_km != null && (
                <span className="text-xs font-bold text-white/85">{current.distance_km.toFixed(1)}km</span>
              )}
            </div>
            {current.caption && (
              <p className="text-xs text-white/85 mt-1 line-clamp-3 italic break-keep">{current.caption}</p>
            )}
            {showProfileLink && current.user_id && (
              // build 207 #14 fix: <a href> 는 trailingSlash + static export 환경에서 /social/user 매칭 실패.
              // Next.js Link 로 SPA 라우팅 + 명시적 trailing slash 보장.
              <Link
                href={{ pathname: '/social/user/', query: { id: current.user_id } }}
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                className="mt-2.5 block w-full text-center px-4 py-2 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-extrabold transition active:scale-95"
              >
                {tt('프로필 보기 →')}
              </Link>
            )}
          </div>
        )}
        <p className="text-[10px] text-white/60 text-center font-bold">{index + 1} / {photos.length}</p>
      </div>
    </div>
  );
}
