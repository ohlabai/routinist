'use client';

// 단일 에세이 전체 보기 — 사진 + 본문 + 좋아요.

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Heart, MapPin, Share2, Package } from 'lucide-react';
import { fetchPhotoById, togglePhotoLike, applyLikedFlags, type RoutinePhoto } from '@/lib/routine-photos';
import { useAuth } from '@/components/AuthProvider';
import AppToast from '@/components/AppToast';

function EssayViewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const id = searchParams.get('id') ?? '';
  const [photo, setPhoto] = useState<RoutinePhoto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!id) { setLoading(false); return; }
    fetchPhotoById(id)
      .then(async p => {
        if (!p) { setPhoto(null); return; }
        const [withFlags] = await applyLikedFlags([p]);
        setPhoto(withFlags);
      })
      .catch(e => console.warn('[essay view] fail', e))
      .finally(() => setLoading(false));
  }, [id]);

  const handleLike = async () => {
    if (!photo || busy) return;
    if (!user) { router.push('/login'); return; }
    setBusy(true);
    const wasLiked = !!photo.liked_by_me;
    setPhoto({ ...photo, liked_by_me: !wasLiked, like_count: photo.like_count + (wasLiked ? -1 : 1) });
    try {
      await togglePhotoLike(photo.photo_id, wasLiked);
    } catch {
      setPhoto({ ...photo, liked_by_me: wasLiked, like_count: photo.like_count + (wasLiked ? 1 : -1) });
      setToast('잠시 후 다시 시도해주세요');
      setTimeout(() => setToast(null), 2000);
    } finally { setBusy(false); }
  };

  const handleShare = async () => {
    if (!photo) return;
    const url = `https://routinist.kr/essays/view?id=${photo.photo_id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `@${photo.display_name} 의 러닝 에세이`, text: photo.essay_body?.slice(0, 120) ?? '', url });
      } else {
        await navigator.clipboard.writeText(url);
        setToast('링크를 복사했어요');
        setTimeout(() => setToast(null), 2000);
      }
    } catch {}
  };

  if (loading) {
    return (
      <div className="max-w-lg mx-auto pb-12">
        <div className="aspect-square bg-[var(--card)] animate-pulse" />
        <div className="px-4 py-5 space-y-3">
          <div className="h-3 w-1/3 bg-[var(--card)] rounded animate-pulse" />
          <div className="h-3 w-full bg-[var(--card)] rounded animate-pulse" />
          <div className="h-3 w-5/6 bg-[var(--card)] rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (!photo) {
    return (
      <div className="max-w-lg mx-auto px-6 py-20 text-center">
        <div className="w-20 h-20 rounded-full bg-emerald-50 dark:bg-emerald-950/30 mx-auto mb-4 flex items-center justify-center">
          <Package size={36} className="text-emerald-500" />
        </div>
        <p className="text-base font-extrabold mb-1">에세이를 찾을 수 없어요</p>
        <Link href="/essays" className="inline-flex mt-5 px-5 py-2.5 rounded-full bg-emerald-500 text-white text-sm font-bold active:scale-95">
          에세이 둘러보기
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto pb-32 bg-[var(--background)] min-h-screen">
      <header className="fixed top-0 left-1/2 -translate-x-1/2 max-w-lg w-full z-30" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="flex items-center justify-between px-3 py-3">
          <button
            onClick={() => router.back()}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md shadow-sm active:scale-90"
            aria-label="뒤로"
          >
            <ArrowLeft size={20} />
          </button>
          <button
            onClick={handleShare}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md shadow-sm active:scale-90"
            aria-label="공유"
          >
            <Share2 size={18} />
          </button>
        </div>
      </header>

      <div className="aspect-square bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950 relative overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.photo_url} alt="" className="w-full h-full object-cover" />
      </div>

      <div className="px-5 pt-5">
        <Link href={`/social/user?id=${photo.user_id}`} className="inline-flex items-center gap-2 active:scale-95">
          <div className="w-10 h-10 rounded-full bg-[var(--card-border)] overflow-hidden">
            {photo.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo.avatar_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[var(--muted)] text-xs">@</div>
            )}
          </div>
          <div>
            <p className="text-sm font-extrabold">@{photo.display_name}</p>
            <p className="text-[11px] text-[var(--muted)] inline-flex items-center gap-1">
              {Number(photo.distance_km).toFixed(1)}km
              {photo.region_gu && (<><span>·</span><MapPin size={10} /> {photo.region_gu}</>)}
            </p>
          </div>
        </Link>

        <article className="mt-5">
          <p className="text-base leading-loose italic whitespace-pre-wrap text-[var(--foreground)] break-keep">
            &ldquo;{photo.essay_body}&rdquo;
          </p>
          <p className="mt-4 text-[11px] text-[var(--muted)]">
            {new Date(photo.created_at).toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
        </article>
      </div>

      {/* Sticky 좋아요 + 공유 액션 */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 max-w-lg w-full bg-[var(--background)]/95 backdrop-blur-lg border-t border-[var(--card-border)]/30 safe-area-bottom z-20">
        <div className="flex items-center gap-2 px-3 py-3">
          <button
            onClick={handleLike}
            disabled={busy}
            className={`flex-1 py-3.5 rounded-2xl border-2 inline-flex items-center justify-center gap-1.5 font-extrabold transition active:scale-[0.98] disabled:opacity-50 ${
              photo.liked_by_me
                ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/40 text-red-500'
                : 'bg-[var(--card)] border-[var(--card-border)] text-[var(--muted)]'
            }`}
          >
            <Heart size={18} className={photo.liked_by_me ? 'fill-red-500' : ''} />
            <span className="text-sm">{photo.like_count}</span>
          </button>
          <button
            onClick={handleShare}
            className="flex-1 py-3.5 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-sm inline-flex items-center justify-center gap-1.5 active:scale-[0.98] shadow-md shadow-emerald-500/30"
          >
            <Share2 size={16} /> 공유
          </button>
        </div>
      </div>

      {toast && <AppToast text={toast} tone="warn" onClose={() => setToast(null)} durationMs={2000} />}
    </div>
  );
}

export default function EssayViewPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    }>
      <EssayViewContent />
    </Suspense>
  );
}
