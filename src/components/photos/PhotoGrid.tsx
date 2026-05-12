'use client';

// 인스타그램 스타일 1컬럼 루틴포토 피드 (build 100 — 사용자 피드백 #1).
// 이전: Pinterest 2컬럼 그리드 → 1열 세로 스크롤 + 큰 사진 + 글 있으면 사진 아래 노출.
// 글 없으면 사진+메타만 (사용자 선택 B).

import PhotoCard from './PhotoCard';
import type { RoutinePhoto } from '@/lib/routine-photos';

interface Props {
  photos: RoutinePhoto[];
  loading?: boolean;
  emptyText?: string;
}

export default function PhotoGrid({ photos, loading, emptyText }: Props) {
  if (loading) {
    return (
      <div className="space-y-4">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="aspect-square w-full rounded-2xl bg-[var(--card-border)]/30 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <div className="card p-6 text-center">
        <p className="text-base font-semibold text-[var(--foreground)] leading-relaxed">
          {emptyText ?? '아직 사진이 없어요'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {photos.map(p => (
        <PhotoCard key={p.photo_id} photo={p} />
      ))}
    </div>
  );
}
