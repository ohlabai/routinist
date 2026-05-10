'use client';

// 메인 하단 루틴포토 가로 슬라이딩 캐러셀.
// 빈 상태에서 "사진 올리기" 누르면 파일 선택 + 등록 모달이 홈에서 바로 뜸 (캘린더 페이지 이동 X).

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Camera, Flame } from 'lucide-react';
import PhotoCard from '@/components/photos/PhotoCard';
import PhotoUploader from '@/components/photos/PhotoUploader';
import { fetchTrendingPhotos, type RoutinePhoto } from '@/lib/routine-photos';

export default function RoutinePhotoCarousel() {
  const [photos, setPhotos] = useState<RoutinePhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const list = await fetchTrendingPhotos(12);
    setPhotos(list);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load, reloadKey]);

  if (loading) {
    return (
      <div className="mt-4 mx-4">
        <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-2">
          {[0, 1, 2].map(i => (
            <div key={i} className="w-40 h-52 rounded-2xl bg-[var(--card-border)]/30 animate-pulse flex-shrink-0" />
          ))}
        </div>
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <div className="mt-4 mx-4 card p-5 bg-gradient-to-br from-emerald-50 via-white to-emerald-50/40 dark:from-emerald-950/20 dark:to-emerald-950/10 border border-emerald-200/60 dark:border-emerald-900/30">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-white dark:bg-zinc-900 shadow-sm flex items-center justify-center flex-shrink-0">
            <Camera size={24} className="text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-bold text-[var(--foreground)]">첫 번째 루틴포토가 되어보세요!</p>
            <p className="text-sm text-[var(--muted)] mt-0.5">오늘 러닝 사진을 공유하면 여기에 떠요</p>
          </div>
        </div>
        <PhotoUploader
          className="mt-3 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-500 text-white font-bold text-base shadow-sm active:scale-[0.99] transition"
          onUploaded={() => setReloadKey(k => k + 1)}
        >
          <Camera size={18} />
          <span>사진 올리기</span>
        </PhotoUploader>
      </div>
    );
  }

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between mx-4 mb-2">
        <h3 className="text-lg font-bold text-[var(--foreground)] flex items-center gap-1.5">
          <Flame size={20} className="text-emerald-600" />
          이번 주 인기 루틴포토
        </h3>
        <div className="flex items-center gap-2">
          <PhotoUploader
            className="flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300 px-2.5 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 active:scale-95 transition"
            onUploaded={() => setReloadKey(k => k + 1)}
          >
            <Camera size={13} />
            <span>올리기</span>
          </PhotoUploader>
          <Link href="/social?tab=photos" className="text-sm font-semibold text-emerald-600 flex items-center gap-0.5">
            더보기 <ChevronRight size={14} />
          </Link>
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-2 px-4" style={{ scrollSnapType: 'x mandatory' }}>
        {photos.map(p => (
          <div key={p.photo_id} style={{ scrollSnapAlign: 'start' }} className="flex-shrink-0">
            <PhotoCard photo={p} compact />
          </div>
        ))}
      </div>
    </div>
  );
}
