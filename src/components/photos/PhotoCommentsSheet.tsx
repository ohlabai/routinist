'use client';

// 러닝사진 댓글 bottom-sheet (build 100 후속).
// PhotoCard 의 댓글 버튼 클릭 시 열림. 리스트 + 입력 + 본인 댓글 삭제.
// 자동 필터 (욕설/스팸) 는 DB trigger 에서 처리 — 실패 시 에러 메시지 표시.

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { X, Send, Trash2, MessageCircle, UserCircle2 } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import {
  fetchPhotoComments,
  insertPhotoComment,
  deletePhotoComment,
  type PhotoComment,
} from '@/lib/photo-comments';
import AppToast from '@/components/AppToast';
import { useI18n } from '@/lib/i18n';

interface Props {
  photoId: string;
  onClose: () => void;
  onCountChange?: (count: number) => void;
}

function relativeTime(iso: string, locale: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (locale === 'en') {
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hrEn = Math.floor(min / 60);
    if (hrEn < 24) return `${hrEn}h ago`;
    const dayEn = Math.floor(hrEn / 24);
    if (dayEn < 7) return `${dayEn}d ago`;
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

export default function PhotoCommentsSheet({ photoId, onClose, onCountChange }: Props) {
  const { user } = useAuth();
  const { tt, locale } = useI18n();
  const [comments, setComments] = useState<PhotoComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchPhotoComments(photoId, 100);
      setComments(rows);
      onCountChange?.(rows.length);
    } catch (e) {
      console.warn('[PhotoCommentsSheet] load 실패', e);
    } finally {
      setLoading(false);
    }
  }, [photoId, onCountChange]);

  useEffect(() => { load(); }, [load]);

  // body scroll lock + input 포커스
  useEffect(() => {
    const orig = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setTimeout(() => inputRef.current?.focus(), 250);
    return () => { document.body.style.overflow = orig; };
  }, []);

  const handleSubmit = async () => {
    if (submitting) return;
    const trimmed = body.trim();
    if (!trimmed) return;
    if (!user) {
      setToast({ text: tt('로그인이 필요해요'), tone: 'warn' });
      return;
    }
    setSubmitting(true);
    try {
      const newComment = await insertPhotoComment(photoId, trimmed);
      // 본인 정보 채워 옵티미스틱 표시
      const enriched: PhotoComment = {
        ...newComment,
        display_name: 'me',
        avatar_url: null,
      };
      setComments(c => [...c, enriched]);
      onCountChange?.(comments.length + 1);
      setBody('');
      // 다음 paint 후 reload 로 정확한 profile join 보강
      setTimeout(() => { void load(); }, 200);
    } catch (e) {
      // Supabase PostgrestError 는 Error instanceof false. message 필드를 직접 추출.
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e !== null && 'message' in e
            ? String((e as { message: unknown }).message)
            : tt('알 수 없는 오류');
      // DB trigger 의 한국어 '부적절' 메시지 매칭은 원문 유지 (로직 접점).
      const friendly = msg.includes('부적절') ? msg : `${tt('등록 실패')} — ${msg.slice(0, 80)}`;
      setToast({ text: friendly, tone: 'warn' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    try {
      await deletePhotoComment(commentId);
      setComments(c => c.filter(x => x.id !== commentId));
      onCountChange?.(Math.max(0, comments.length - 1));
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e !== null && 'message' in e
            ? String((e as { message: unknown }).message)
            : tt('삭제 실패');
      setToast({ text: msg, tone: 'warn' });
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm flex items-end justify-center"
      onClick={onClose}
    >
      <div
        className="bg-[var(--background)] w-full max-w-lg h-[75vh] rounded-t-3xl shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="sticky top-0 z-10 bg-[var(--background)]/95 backdrop-blur-lg border-b border-[var(--card-border)] px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageCircle size={18} className="text-emerald-500" />
            <h2 className="text-base font-extrabold text-[var(--foreground)]">
              {tt('댓글')} {comments.length > 0 && <span className="text-emerald-600">{comments.length}</span>}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-[var(--card-border)]/40 flex items-center justify-center active:scale-95 transition"
            aria-label={tt('닫기')}
          >
            <X size={18} className="text-[var(--foreground)]" />
          </button>
        </div>

        {/* 댓글 리스트 */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
            </div>
          ) : comments.length === 0 ? (
            <div className="py-12 text-center">
              <MessageCircle size={28} className="mx-auto text-[var(--muted)] opacity-40 mb-2" />
              <p className="text-sm font-semibold text-[var(--foreground)]">{tt('첫 댓글을 남겨보세요')}</p>
              <p className="text-xs text-[var(--muted)] mt-1">{tt('응원 한 마디가 큰 힘이 돼요')}</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {comments.map(c => {
                const isMine = user?.id === c.user_id;
                return (
                  <li key={c.id} className="flex items-start gap-2.5">
                    <Link
                      href={isMine ? '/profile' : `/social/user?id=${c.user_id}`}
                      className="w-8 h-8 rounded-full bg-[var(--card-border)] overflow-hidden flex-shrink-0"
                    >
                      {c.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <UserCircle2 size={32} className="text-[var(--muted)]" />
                      )}
                    </Link>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-1.5 flex-wrap">
                        <Link
                          href={isMine ? '/profile' : `/social/user?id=${c.user_id}`}
                          className={`text-xs font-bold truncate ${isMine ? 'text-emerald-700 dark:text-emerald-400' : 'text-[var(--foreground)]'}`}
                        >
                          {c.display_name ?? tt('러너')}{isMine && (locale === 'en' ? ' (me)' : ' (나)')}
                        </Link>
                        <span className="text-[12px] text-[var(--muted)]">{relativeTime(c.created_at, locale)}</span>
                      </div>
                      <p className="text-sm text-[var(--foreground)] mt-0.5 whitespace-pre-wrap break-words">
                        {c.body}
                      </p>
                    </div>
                    {isMine && (
                      <button
                        onClick={() => handleDelete(c.id)}
                        aria-label={tt('삭제')}
                        className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--muted)] hover:text-rose-500 active:scale-90 transition flex-shrink-0"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 입력 */}
        <div className="border-t border-[var(--card-border)] px-4 py-3 pb-[max(env(safe-area-inset-bottom),12px)] bg-[var(--background)]">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={body}
              onChange={e => setBody(e.target.value.slice(0, 500))}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
              placeholder={user ? tt('응원의 한 마디를 남겨보세요') : tt('로그인 후 댓글 작성')}
              disabled={!user || submitting}
              className="flex-1 px-3.5 py-2.5 rounded-full border border-[var(--card-border)] bg-[var(--card)] text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-50"
            />
            <button
              onClick={handleSubmit}
              disabled={!user || submitting || !body.trim()}
              className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white flex items-center justify-center active:scale-90 disabled:opacity-40 transition flex-shrink-0"
              aria-label={tt('등록')}
            >
              {submitting ? (
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Send size={16} />
              )}
            </button>
          </div>
          <p className="text-[12px] text-[var(--muted)] mt-1 text-right">{body.length}/500</p>
        </div>
      </div>

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2500} />}
    </div>
  );
}
