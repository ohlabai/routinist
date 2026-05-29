'use client';

// 루티니스트 갤러리 — 메인 하단 사진 피드.
// 유저들이 캘린더에서 사진 업로드 시 "루티니스트 갤러리에 공유" 체크한 사진만 노출.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Camera } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';

interface GalleryPhoto {
  photo_id: string;
  activity_id: string;
  user_id: string;
  photo_url: string;
  caption: string | null;
  created_at: string;
  display_name: string;
  avatar_url: string | null;
  region_gu: string | null;
  distance_km: number;
  activity_date: string;
}

export default function RoutinistGallery() {
  const { tt, locale } = useI18n();
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('public_gallery_feed')
          .select('*')
          .limit(18);
        if (error) throw error;
        setPhotos((data ?? []) as GalleryPhoto[]);
      } catch (e) {
        console.warn('[Gallery] 조회 실패', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="mt-6 px-4">
        <h3 className="text-sm font-bold text-[var(--foreground)] mb-2">{tt('루티니스트 갤러리')}</h3>
        <div className="grid grid-cols-3 gap-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-md bg-[var(--card)] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <div className="mt-6 mx-4 rounded-2xl border border-dashed border-[var(--card-border)] p-6 text-center">
        <Camera size={28} className="mx-auto text-[var(--muted)] mb-2" />
        <p className="text-sm font-medium text-[var(--foreground)]">{tt('루티니스트 갤러리')}</p>
        <p className="text-xs text-[var(--muted)] mt-1">
          {tt('러닝 사진을 공유하면 이곳에 표시돼요')}
        </p>
        <Link
          href="/calendar"
          className="inline-block mt-3 px-4 py-2 rounded-full bg-[var(--accent)] text-white text-xs font-medium"
        >
          {tt('내 기록에 사진 추가')}
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6 pb-4">
      <div className="flex items-center justify-between px-4 mb-2">
        <h3 className="text-sm font-bold text-[var(--foreground)]">{tt('루티니스트 갤러리')}</h3>
        <Link href="/gallery" className="text-xs text-[var(--accent)] font-medium">
          {locale === 'en' ? 'See all' : '더보기'}
        </Link>
      </div>
      <div className="grid grid-cols-3 gap-1 px-4">
        {photos.slice(0, 9).map((p) => (
          <Link
            key={p.photo_id}
            href={`/social/user?id=${p.user_id}`}
            className="relative aspect-square rounded-md overflow-hidden bg-[var(--card)] active:scale-[0.98] transition"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.photo_url} alt="" className="w-full h-full object-cover" loading="lazy" />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 py-1">
              <p className="text-[10px] text-white font-medium truncate">{p.display_name}</p>
              <p className="text-[9px] text-white/80">{p.distance_km.toFixed(1)}km</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
