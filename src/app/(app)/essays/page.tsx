'use client';

// 러너의 에세이 — 사진+에세이 피드 (긴 글 전용).
// 사용자 피드백 #10: 컨텐츠 생산 + 체류시간 증가.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, PenLine, Sparkles, MapPin, Heart } from 'lucide-react';
import { fetchEssayFeed, applyLikedFlags, togglePhotoLike, type RoutinePhoto } from '@/lib/routine-photos';
import { useAuth } from '@/components/AuthProvider';
import AppToast from '@/components/AppToast';

export default function EssaysPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [photos, setPhotos] = useState<RoutinePhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [likeBusy, setLikeBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchEssayFeed({ limit: 30 })
      .then(async list => {
        const withFlags = await applyLikedFlags(list);
        if (!cancelled) setPhotos(withFlags);
      })
      .catch(e => { if (!cancelled) console.warn('[essays] fail', e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleLike = async (p: RoutinePhoto) => {
    if (!user) { router.push('/login'); return; }
    if (likeBusy === p.photo_id) return;
    setLikeBusy(p.photo_id);
    const wasLiked = !!p.liked_by_me;
    setPhotos(prev => prev.map(x => x.photo_id === p.photo_id ? {
      ...x, liked_by_me: !wasLiked, like_count: x.like_count + (wasLiked ? -1 : 1),
    } : x));
    try {
      await togglePhotoLike(p.photo_id, wasLiked);
    } catch {
      setPhotos(prev => prev.map(x => x.photo_id === p.photo_id ? {
        ...x, liked_by_me: wasLiked, like_count: x.like_count + (wasLiked ? 1 : -1),
      } : x));
      setToast('잠시 후 다시 시도해주세요');
      setTimeout(() => setToast(null), 2000);
    } finally {
      setLikeBusy(null);
    }
  };

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-extrabold tracking-tight">러너의 에세이</h1>
        </div>
      </header>

      <section className="px-4 pt-4">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-teal-600 p-5 shadow-lg shadow-emerald-500/30">
          <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-white/10 blur-2xl" />
          <div className="relative">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 backdrop-blur-sm mb-2">
              <PenLine size={11} className="text-white" />
              <span className="text-[10px] font-extrabold text-white tracking-widest">RUNNER ESSAYS</span>
            </div>
            <h2 className="text-xl font-extrabold text-white mb-1">달리며 쓰는 한 페이지</h2>
            <p className="text-xs text-white/90 leading-relaxed">
              사진과 함께 남긴 러너들의 생각·기록. 매일 새로운 에세이가 올라와요.
            </p>
          </div>
        </div>
      </section>

      <section className="px-4 mt-4 space-y-3">
        {loading ? (
          [0,1,2].map(i => (
            <div key={i} className="card overflow-hidden animate-pulse">
              <div className="aspect-[4/3] bg-[var(--card-border)]/40" />
              <div className="p-4 space-y-2">
                <div className="h-3 w-2/3 bg-[var(--card-border)]/50 rounded" />
                <div className="h-3 w-full bg-[var(--card-border)]/50 rounded" />
                <div className="h-3 w-1/2 bg-[var(--card-border)]/50 rounded" />
              </div>
            </div>
          ))
        ) : photos.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 rounded-full bg-emerald-50 dark:bg-emerald-950/30 mx-auto mb-3 flex items-center justify-center">
              <Sparkles size={32} className="text-emerald-500" />
            </div>
            <p className="text-base font-extrabold mb-1">아직 에세이가 없어요</p>
            <p className="text-sm text-[var(--muted)]">첫 번째 러너가 되어보세요</p>
          </div>
        ) : (
          photos.map(p => (
            <Link
              key={p.photo_id}
              href={`/essays/view?id=${p.photo_id}`}
              className="card overflow-hidden block active:scale-[0.99] transition group"
            >
              <div className="aspect-[4/3] bg-[var(--card-border)]/30 relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.photo_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3">
                  <div className="flex items-center gap-2 text-[11px] text-white/90">
                    <span className="font-bold">@{p.display_name}</span>
                    <span>·</span>
                    <span>{Number(p.distance_km).toFixed(1)}km</span>
                    {p.region_gu && (
                      <>
                        <span>·</span>
                        <span className="inline-flex items-center gap-0.5"><MapPin size={10} /> {p.region_gu}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="p-4">
                <p className="text-sm leading-relaxed text-[var(--foreground)] line-clamp-4 italic break-keep">
                  &ldquo;{p.essay_body}&rdquo;
                </p>
                <div className="flex items-center justify-between mt-3">
                  <button
                    onClick={(e) => { e.preventDefault(); handleLike(p); }}
                    disabled={likeBusy === p.photo_id}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--card-border)]/30 text-xs disabled:opacity-50 active:scale-95"
                  >
                    <Heart
                      size={12}
                      className={p.liked_by_me ? 'text-red-500' : 'text-[var(--muted)]'}
                      fill={p.liked_by_me ? '#ef4444' : 'transparent'}
                    />
                    <span className={p.liked_by_me ? 'text-red-500 font-bold' : 'text-[var(--muted)]'}>
                      {p.like_count}
                    </span>
                  </button>
                  <span className="text-[10px] text-emerald-600 font-bold">전체 읽기 →</span>
                </div>
              </div>
            </Link>
          ))
        )}
      </section>

      {toast && <AppToast text={toast} tone="warn" onClose={() => setToast(null)} durationMs={2000} />}
    </div>
  );
}
