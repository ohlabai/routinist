'use client';

// 루틴포토 단일 카드 — 썸네일 + 좋아요 + 러닝 기록 오버레이.
// 친근·귀여운 컨셉: 둥근 카드, 더블탭 하트 애니메이션, soft shadow.

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Heart, MapPin, X, MoreVertical, Trash2, Flag, MessageCircle } from 'lucide-react';
import type { RoutinePhoto } from '@/lib/routine-photos';
import { togglePhotoLike, deleteMyPhoto, reportPhoto } from '@/lib/routine-photos';
import { fetchPhotoCommentCount } from '@/lib/photo-comments';
import { useAuth } from '@/components/AuthProvider';
import AppToast from '@/components/AppToast';
import PhotoCommentsSheet from './PhotoCommentsSheet';

interface Props {
  photo: RoutinePhoto;
  onToggle?: (photoId: string, liked: boolean) => void;
  /** 삭제 후 부모 리스트에서 즉시 제거 */
  onDeleted?: (photoId: string) => void;
  compact?: boolean;
}

// build 67 UX 분리:
// - 사진 영역 탭 → 큰 이미지 모달 (전체 화면 lightbox)
// - 하단 ID 탭 → 미니 프로필 페이지 (/social/user?id=...)
// 이전: 사진 통째로 사용자 프로필로 점프 → 사진 자체를 크게 보고 싶을 때 우회 못함.
export default function PhotoCard({ photo, onToggle, onDeleted, compact }: Props) {
  const { user } = useAuth();
  const isOwner = !!user && user.id === photo.user_id;
  const [liked, setLiked] = useState(!!photo.liked_by_me);
  const [likes, setLikes] = useState(photo.like_count);
  const [animate, setAnimate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const [removed, setRemoved] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [commentCount, setCommentCount] = useState<number>(0);

  // 댓글 카운트 lazy fetch (sheet 안 열어도 카운트 표시).
  // 갤러리 그리드에서 N개 동시 fetch — 작은 head:true count 라 부담 적음.
  useEffect(() => {
    let cancelled = false;
    fetchPhotoCommentCount(photo.photo_id)
      .then(n => { if (!cancelled) setCommentCount(n); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [photo.photo_id]);

  const handleReport = async (reason: 'inappropriate' | 'spam' | 'harassment' | 'other') => {
    if (reporting) return;
    setReporting(true);
    try {
      await reportPhoto(photo.photo_id, reason);
      setToast({ text: '신고가 접수됐어요. 24시간 안에 검토합니다', tone: 'ok' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const friendly =
        msg.includes('duplicate key') || msg.includes('unique') ? '이미 신고하신 사진이에요' :
        `신고 실패 — ${msg.slice(0, 80)}`;
      setToast({ text: friendly, tone: 'warn' });
    } finally {
      setShowReport(false);
      setShowMenu(false);
      setReporting(false);
    }
  };

  const handleDelete = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteMyPhoto(photo.photo_id, photo.photo_url);
      setToast({ text: '사진을 삭제했어요', tone: 'ok' });
      setRemoved(true);
      onDeleted?.(photo.photo_id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ text: `삭제 실패 — ${msg.slice(0, 80)}`, tone: 'warn' });
      setDeleting(false);
    } finally {
      setShowDeleteConfirm(false);
      setShowMenu(false);
    }
  };

  const handleLike = async (e?: React.MouseEvent | React.TouchEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    const next = !liked;
    setLiked(next);
    setLikes((n) => Math.max(0, n + (next ? 1 : -1)));
    setAnimate(true);
    setTimeout(() => setAnimate(false), 400);
    try {
      await togglePhotoLike(photo.photo_id, liked);
      onToggle?.(photo.photo_id, next);
    } catch {
      setLiked(!next);
      setLikes((n) => Math.max(0, n + (next ? -1 : 1)));
    } finally {
      setBusy(false);
    }
  };

  // useRef — 매 렌더 초기화 방지. 이전엔 let lastTap 가 매 렌더 0 으로 리셋돼 더블탭 인식 실패.
  const lastTapRef = useRef(0);
  const handleTap = (e: React.TouchEvent) => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      if (!liked) handleLike(e);
    }
    lastTapRef.current = now;
  };

  if (removed) return null;

  return (
    <>
      <div
        className={`relative rounded-2xl overflow-hidden bg-[var(--card)] shadow-sm group ${compact ? 'w-40' : 'w-full'}`}
        onTouchEnd={handleTap}
      >
        {/* 사진 영역 — 탭하면 lightbox */}
        <button
          type="button"
          onClick={() => setShowLightbox(true)}
          className="block w-full text-left"
          aria-label="사진 크게 보기"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo.photo_url}
            alt=""
            className={`w-full object-cover ${compact ? 'h-52' : 'aspect-square'}`}
            loading="lazy"
          />

          {/* 하단 오버레이 — 거리만 (사용자 피드백: 에세이는 사진 외부 카드 하단에 표시) */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/40 to-transparent p-3 pointer-events-none">
            <div className="flex items-center gap-2 text-[11px] text-white/90">
              <span className="font-semibold">{Number(photo.distance_km).toFixed(1)}km</span>
              {photo.region_gu && (
                <span className="flex items-center gap-0.5">
                  <MapPin size={10} />
                  {photo.region_gu}
                </span>
              )}
            </div>
          </div>
        </button>

        {/* 에세이 본문 — 카드 외부 하단 (사진 아래) 별도 영역. 사용자 피드백 #3. */}
        {photo.essay_body && (
          <div className="px-3.5 py-3 bg-[var(--card)] border-t border-[var(--card-border)]/40">
            <p className="text-[13px] italic text-[var(--foreground)] leading-relaxed line-clamp-3 break-keep">
              &ldquo;{photo.essay_body.replace(/\s+/g, ' ').trim()}&rdquo;
            </p>
            <p className="text-[10px] text-[var(--muted)] mt-1.5">— @{photo.display_name}</p>
          </div>
        )}

        {/* 사용자 ID — 별도 클릭 영역. 사진 위 left-2 bottom-2 (오버레이 위에 z-index). */}
        <Link
          href={`/social/user?id=${photo.user_id}`}
          className="absolute left-2 bottom-2 z-10 flex items-center gap-1.5 px-2 py-1 rounded-full bg-white/90 backdrop-blur text-[11px] font-bold text-gray-800 shadow-sm active:scale-95 transition"
          aria-label={`${photo.display_name} 프로필 보기`}
        >
          <span className="truncate max-w-[120px]">@{photo.display_name}</span>
        </Link>

        {/* 좋아요 하트 */}
        <button
          onClick={handleLike}
          disabled={busy}
          aria-label="좋아요"
          className={`absolute top-2 right-2 w-9 h-9 rounded-full bg-white/90 backdrop-blur shadow-md flex items-center justify-center transition-transform ${animate ? 'scale-125' : 'scale-100'}`}
        >
          <Heart
            size={18}
            fill={liked ? '#ef4444' : 'none'}
            className={liked ? 'text-red-500' : 'text-gray-600'}
            strokeWidth={2.2}
          />
        </button>

        {/* ⋯ 메뉴: 본인이면 [삭제], 타인이면 [신고] (Apple 1.2 UGC 의무). 좋아요/댓글 아래. */}
        {user && (
          <div className="absolute top-[88px] right-2 z-10">
            <button
              onClick={(e) => { e.stopPropagation(); setShowMenu(s => !s); }}
              aria-label="더보기"
              className="w-9 h-9 rounded-full bg-white/90 backdrop-blur shadow-md flex items-center justify-center"
            >
              <MoreVertical size={16} className="text-gray-700" strokeWidth={2.2} />
            </button>
            {showMenu && (
              <div
                className="absolute right-0 mt-1 w-32 bg-white dark:bg-zinc-900 rounded-xl shadow-xl border border-[var(--card-border)] overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                {isOwner ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowMenu(false); setShowDeleteConfirm(true); }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-red-500 font-semibold active:bg-red-50 dark:active:bg-red-950/30"
                  >
                    <Trash2 size={14} /> 삭제
                  </button>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowMenu(false); setShowReport(true); }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-300 font-semibold active:bg-amber-50 dark:active:bg-amber-950/30"
                  >
                    <Flag size={14} /> 신고
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* 좋아요/댓글 카운트 — 사진 좌상단 (build 100 댓글 통합) */}
        {(likes > 0 || commentCount > 0) && (
          <div className="absolute top-2 left-2 flex items-center gap-1">
            {likes > 0 && (
              <div className="px-2 py-0.5 rounded-full bg-white/90 backdrop-blur text-[11px] font-bold text-gray-800 flex items-center gap-0.5 shadow-sm">
                <Heart size={10} fill="#ef4444" className="text-red-500" strokeWidth={0} />
                {likes}
              </div>
            )}
            {commentCount > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowComments(true); }}
                className="px-2 py-0.5 rounded-full bg-white/90 backdrop-blur text-[11px] font-bold text-gray-800 flex items-center gap-0.5 shadow-sm active:scale-95 transition"
                aria-label="댓글 보기"
              >
                <MessageCircle size={10} className="text-emerald-600" strokeWidth={2.5} />
                {commentCount}
              </button>
            )}
          </div>
        )}

        {/* 댓글 버튼 — 좋아요 버튼 아래 (사진 우측). 카운트와 별개로 항상 노출 */}
        <button
          onClick={(e) => { e.stopPropagation(); setShowComments(true); }}
          aria-label="댓글 작성"
          className="absolute top-12 right-2 w-9 h-9 rounded-full bg-white/90 backdrop-blur shadow-md flex items-center justify-center active:scale-95 transition z-10"
        >
          <MessageCircle size={16} className="text-gray-700" strokeWidth={2.2} />
        </button>

        {animate && liked && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Heart size={72} fill="#ef4444" className="text-red-500 drop-shadow-lg animate-ping opacity-80" strokeWidth={0} />
          </div>
        )}
      </div>

      {/* Lightbox — 사진 원본 크게. 배경 탭 또는 X 로 닫기. ID/거리 라벨 + 프로필 이동. */}
      {showLightbox && (
        <div
          className="fixed inset-0 z-[90] bg-black/95 flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setShowLightbox(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo.photo_url}
            alt=""
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
          {/* X 닫기 버튼 — status bar / 부모 헤더와 안 겹치게 safe-area 적용 (사용자 피드백 #5). */}
          <button
            onClick={() => setShowLightbox(false)}
            className="absolute right-3 w-12 h-12 rounded-full bg-white/20 active:bg-white/30 backdrop-blur flex items-center justify-center active:scale-95 transition"
            style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
            aria-label="닫기"
          >
            <X size={26} strokeWidth={2.5} className="text-white" />
          </button>
          <div className="absolute left-4 right-4 bottom-[calc(env(safe-area-inset-bottom)+24px)] space-y-3" onClick={(e) => e.stopPropagation()}>
            {photo.essay_body && (
              <div className="px-4 py-3 rounded-2xl bg-black/55 backdrop-blur-md text-white text-sm leading-relaxed max-h-40 overflow-y-auto">
                <p className="italic whitespace-pre-wrap">&ldquo;{photo.essay_body}&rdquo;</p>
                <p className="mt-2 text-[11px] text-white/70">— @{photo.display_name}</p>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <Link
                href={`/social/user?id=${photo.user_id}`}
                onClick={() => setShowLightbox(false)}
                className="flex-1 px-4 py-3 rounded-2xl bg-white/15 backdrop-blur text-white text-sm font-semibold active:scale-95 transition"
              >
                @{photo.display_name} 프로필 보기
              </Link>
              <div className="px-4 py-3 rounded-2xl bg-white/15 backdrop-blur text-white text-sm font-semibold">
                {Number(photo.distance_km).toFixed(1)}km
                {photo.region_gu && <span className="ml-2 opacity-80">· {photo.region_gu}</span>}
              </div>
              {isOwner && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(true); }}
                  aria-label="삭제"
                  className="w-12 h-12 rounded-2xl bg-red-500/80 backdrop-blur text-white flex items-center justify-center active:scale-95 transition flex-shrink-0"
                >
                  <Trash2 size={18} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 삭제 확인 다이얼로그 — 본인 사진 삭제. 영구 삭제 경고 */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-[95] bg-black/60 flex items-center justify-center p-4 animate-fade-in"
          onClick={() => !deleting && setShowDeleteConfirm(false)}
        >
          <div
            className="w-full max-w-xs bg-white dark:bg-zinc-900 rounded-3xl p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-center gap-3 mb-4">
              <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-950/40 flex items-center justify-center">
                <Trash2 size={26} className="text-red-500" />
              </div>
              <h3 className="text-base font-bold text-[var(--foreground)] text-center">사진을 삭제할까요?</h3>
              <p className="text-sm text-[var(--muted)] text-center leading-relaxed">
                삭제하면 다른 사람들에게도 즉시 안 보이며 복구할 수 없어요.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="flex-1 py-3 rounded-xl bg-[var(--card-border)]/30 text-[var(--foreground)] font-semibold disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 py-3 rounded-xl bg-red-500 text-white font-bold disabled:opacity-50 active:scale-95 transition flex items-center justify-center gap-1.5"
              >
                {deleting ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    삭제 중
                  </>
                ) : '삭제'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 신고 사유 선택 다이얼로그 — Apple 1.2. 사유별 분류 + 24h 처리 약속 */}
      {showReport && (
        <div
          className="fixed inset-0 z-[95] bg-black/60 flex items-center justify-center p-4 animate-fade-in"
          onClick={() => !reporting && setShowReport(false)}
        >
          <div
            className="w-full max-w-xs bg-white dark:bg-zinc-900 rounded-3xl p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-center gap-2 mb-4">
              <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center">
                <Flag size={26} className="text-amber-600" />
              </div>
              <h3 className="text-base font-bold text-[var(--foreground)] text-center">사진 신고</h3>
              <p className="text-xs text-[var(--muted)] text-center leading-relaxed">
                신고 사유를 선택해주세요. 검토 후 24시간 안에 조치합니다.
              </p>
            </div>
            <div className="space-y-1.5">
              {([
                { id: 'inappropriate', label: '부적절한 콘텐츠' },
                { id: 'spam', label: '스팸/광고' },
                { id: 'harassment', label: '괴롭힘/혐오' },
                { id: 'other', label: '기타' },
              ] as const).map(opt => (
                <button
                  key={opt.id}
                  onClick={() => handleReport(opt.id)}
                  disabled={reporting}
                  className="w-full px-3 py-3 rounded-xl bg-[var(--card-border)]/30 text-[var(--foreground)] text-sm font-semibold disabled:opacity-50 active:bg-[var(--card-border)]/60 transition"
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowReport(false)}
              disabled={reporting}
              className="w-full mt-3 py-2.5 text-sm text-[var(--muted)] disabled:opacity-50"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 댓글 sheet (build 100) */}
      {showComments && (
        <PhotoCommentsSheet
          photoId={photo.photo_id}
          onClose={() => setShowComments(false)}
          onCountChange={setCommentCount}
        />
      )}

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2500} />}
    </>
  );
}
