'use client';

// 상품 상세 페이지의 리뷰 섹션 — 별점 분포 + 리뷰 목록 + 본인 리뷰 작성/수정.

import { useEffect, useState } from 'react';
import { Star, Edit2 } from 'lucide-react';
import { fetchReviews, fetchMyReview, upsertReview, deleteReview, type ProductReview } from '@/lib/reviews';
import { useAuth } from '@/components/AuthProvider';
import AppToast from '@/components/AppToast';

interface Props {
  productId: string;
  /** 상품의 cached rating (없으면 0) */
  ratingAvg?: number;
  ratingCount?: number;
  onUpdated?: () => void;
}

export default function ProductReviews({ productId, ratingAvg = 0, ratingCount = 0, onUpdated }: Props) {
  const { user } = useAuth();
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [myReview, setMyReview] = useState<ProductReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2500);
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchReviews(productId, 20, 0),
      user ? fetchMyReview(productId) : Promise.resolve(null),
    ]).then(([list, mine]) => {
      if (cancelled) return;
      setReviews(list);
      setMyReview(mine);
      if (mine) {
        setRating(mine.rating);
        setBody(mine.body ?? '');
      }
    }).catch(e => console.warn('[reviews] load fail', e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [productId, user]);

  const handleSubmit = async () => {
    if (!user) return;
    if (rating < 1 || rating > 5) return;
    setSubmitting(true);
    try {
      await upsertReview(productId, rating, body);
      showToast('리뷰가 등록됐어요 ✨');
      setEditing(false);
      const [list, mine] = await Promise.all([fetchReviews(productId), fetchMyReview(productId)]);
      setReviews(list);
      setMyReview(mine);
      onUpdated?.();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '등록 실패', 'warn');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!myReview || !confirm('리뷰를 삭제하시겠어요?')) return;
    try {
      await deleteReview(myReview.id);
      setMyReview(null);
      setReviews(prev => prev.filter(r => r.id !== myReview.id));
      onUpdated?.();
      showToast('삭제 완료');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '실패', 'warn');
    }
  };

  return (
    <div className="border-t border-[var(--card-border)] mt-6 pt-6">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-base font-bold text-[var(--foreground)]">리뷰</h2>
        {ratingCount > 0 && (
          <div className="text-xs text-[var(--muted)]">
            <Star size={12} className="inline text-amber-400 fill-amber-400 -mt-0.5" /> {' '}
            <span className="font-bold text-amber-600">{ratingAvg.toFixed(1)}</span>
            <span className="text-[var(--muted)]"> · {ratingCount}개</span>
          </div>
        )}
      </div>

      {/* 본인 리뷰 작성/편집 */}
      {user && (
        <div className="card p-4 mb-4">
          {!editing && myReview ? (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-bold">내 리뷰</p>
                <div className="flex gap-2">
                  <button onClick={() => setEditing(true)} className="text-xs text-[var(--accent)] inline-flex items-center gap-0.5">
                    <Edit2 size={12} /> 수정
                  </button>
                  <button onClick={handleDelete} className="text-xs text-red-500">삭제</button>
                </div>
              </div>
              <StarsDisplay value={myReview.rating} />
              {myReview.body && <p className="text-sm mt-2 whitespace-pre-wrap text-[var(--foreground)]">{myReview.body}</p>}
            </div>
          ) : (
            <div>
              <p className="text-sm font-bold mb-2">{myReview ? '리뷰 수정' : '리뷰 작성'}</p>
              <StarsInput value={rating} onChange={setRating} />
              <textarea
                rows={3}
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="구매한 상품에 대한 솔직한 리뷰를 남겨주세요"
                className="w-full mt-3 px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm resize-none"
                maxLength={500}
              />
              <div className="flex gap-2 mt-2">
                {editing && (
                  <button
                    onClick={() => {
                      setEditing(false);
                      if (myReview) { setRating(myReview.rating); setBody(myReview.body ?? ''); }
                    }}
                    className="flex-1 py-2 rounded-lg border border-[var(--card-border)] text-sm text-[var(--muted)]"
                  >
                    취소
                  </button>
                )}
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="flex-1 py-2 rounded-lg bg-emerald-500 text-white text-sm font-bold disabled:opacity-50"
                >
                  {submitting ? '저장 중…' : myReview ? '수정 완료' : '리뷰 작성'}
                </button>
              </div>
              <p className="text-[10px] text-[var(--muted)] mt-2">* 구매 인증된 사용자만 리뷰를 작성할 수 있습니다.</p>
            </div>
          )}
        </div>
      )}

      {/* 다른 사용자 리뷰 목록 */}
      {loading ? (
        <div className="flex justify-center py-6">
          <div className="animate-spin w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
        </div>
      ) : reviews.filter(r => !myReview || r.id !== myReview.id).length === 0 ? (
        <p className="text-xs text-[var(--muted)] text-center py-6">
          {myReview ? '아직 다른 분의 리뷰가 없어요' : '첫 리뷰를 남겨보세요'}
        </p>
      ) : (
        <div className="space-y-3">
          {reviews.filter(r => !myReview || r.id !== myReview.id).map(r => (
            <div key={r.id} className="card p-3">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-[var(--card-border)] overflow-hidden flex-shrink-0">
                    {r.user?.avatar_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.user.avatar_url} alt="" className="w-full h-full object-cover" />
                    )}
                  </div>
                  <span className="text-xs font-semibold">{r.user?.display_name ?? '러너'}</span>
                </div>
                <span className="text-[10px] text-[var(--muted)]">
                  {new Date(r.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                </span>
              </div>
              <StarsDisplay value={r.rating} small />
              {r.body && <p className="text-sm mt-1.5 whitespace-pre-wrap text-[var(--foreground)]">{r.body}</p>}
            </div>
          ))}
        </div>
      )}

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2500} />}
    </div>
  );
}

function StarsDisplay({ value, small }: { value: number; small?: boolean }) {
  const size = small ? 12 : 16;
  return (
    <div className="flex">
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i} size={size}
          className={i <= value ? 'text-amber-400 fill-amber-400' : 'text-zinc-300 dark:text-zinc-600'}
        />
      ))}
    </div>
  );
}

function StarsInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(i => (
        <button
          key={i} type="button"
          onClick={() => onChange(i)}
          className="active:scale-90"
          aria-label={`${i}점`}
        >
          <Star
            size={28}
            className={i <= value ? 'text-amber-400 fill-amber-400' : 'text-zinc-300 dark:text-zinc-600'}
          />
        </button>
      ))}
    </div>
  );
}
