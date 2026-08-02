'use client';

// 러닝사진 단일 카드 — 썸네일 + 좋아요 + 러닝 기록 오버레이.
// 친근·귀여운 컨셉: 둥근 카드, 더블탭 하트 애니메이션, soft shadow.

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Heart, MapPin, X, Trash2, Flag, MessageCircle } from 'lucide-react';
import type { RoutinePhoto } from '@/lib/routine-photos';
import { togglePhotoLike, deleteMyPhoto, reportPhoto } from '@/lib/routine-photos';
import { getSupabase } from '@/lib/supabase';
import { blockUser } from '@/lib/message-data';
import { fetchPhotoCommentCount } from '@/lib/photo-comments';
import { useAuth } from '@/components/AuthProvider';
import AppToast from '@/components/AppToast';
import PhotoCommentsSheet from './PhotoCommentsSheet';
import GenderBadge from '@/components/profile/GenderBadge';
import { useI18n } from '@/lib/i18n';

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
  const { tt, locale } = useI18n();
  const isOwner = !!user && user.id === photo.user_id;
  const [liked, setLiked] = useState(!!photo.liked_by_me);
  const [likes, setLikes] = useState(photo.like_count);
  const [animate, setAnimate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // build 317 (2026-07-26 hans): 라이트박스에서 사진 탭 = 깨끗한 원본 ↔ 기록 카드 토글.
  // original_url 은 라이트박스 첫 오픈 시 lazy fetch (undefined = 미조회, null = 원본 없음).
  const [originalUrl, setOriginalUrl] = useState<string | null | undefined>(undefined);
  const [showOriginal, setShowOriginal] = useState(false);
  // build 317 후속: 꾹 누르면 (400ms) 원본 잠깐 보기 — 떼면 기록 카드로 복귀 (Instagram peek 감성)
  const peekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peekingRef = useRef(false);
  const [savingOriginal, setSavingOriginal] = useState(false);

  useEffect(() => {
    if (!showLightbox) { setShowOriginal(false); return; }
    if (originalUrl !== undefined) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase.rpc('get_photo_original', { p_photo_id: photo.photo_id });
        if (!cancelled) setOriginalUrl(error ? null : ((data as string | null) ?? null));
      } catch {
        if (!cancelled) setOriginalUrl(null);
      }
    })();
    return () => { cancelled = true; };
  }, [showLightbox, originalUrl, photo.photo_id]);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const [removed, setRemoved] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [commentCount, setCommentCount] = useState<number>(photo.comment_count ?? 0);

  // 댓글 카운트 — build 290: 갤러리 view 가 comment_count 를 내려주면 그대로 사용 (카드당
  // count 쿼리 N+1 제거). 트렌딩 RPC 등 comment_count 없는 경로만 기존 lazy fetch 폴백.
  useEffect(() => {
    if (photo.comment_count !== undefined) return;
    let cancelled = false;
    fetchPhotoCommentCount(photo.photo_id)
      .then(n => { if (!cancelled) setCommentCount(n); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [photo.photo_id, photo.comment_count]);

  // build 290: 차단 진입점 (Apple 1.2) — 차단 즉시 이 카드도 화면에서 제거.
  const handleBlockUser = async () => {
    if (reporting) return;
    setReporting(true);
    try {
      await blockUser(photo.user_id);
      setToast({
        text: locale === 'en'
          ? `Blocked @${photo.display_name}. Their content is now hidden`
          : `${photo.display_name}님을 차단했어요. 콘텐츠가 더 이상 보이지 않아요`,
        tone: 'ok',
      });
      setTimeout(() => {
        setRemoved(true);
        onDeleted?.(photo.photo_id);
      }, 900);
    } catch (err) {
      setToast({ text: `${tt('차단 실패')} — ${err instanceof Error ? err.message.slice(0, 60) : tt('다시 시도해주세요')}`, tone: 'warn' });
    } finally {
      setShowReport(false);
      setReporting(false);
    }
  };

  const handleReport = async (reason: 'inappropriate' | 'spam' | 'harassment' | 'other') => {
    if (reporting) return;
    setReporting(true);
    try {
      await reportPhoto(photo.photo_id, reason);
      setToast({ text: tt('신고가 접수됐어요. 24시간 안에 검토합니다'), tone: 'ok' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const friendly =
        msg.includes('duplicate key') || msg.includes('unique') ? tt('이미 신고하신 사진이에요') :
        `${tt('신고 실패')} — ${msg.slice(0, 80)}`;
      setToast({ text: friendly, tone: 'warn' });
    } finally {
      setShowReport(false);
      setReporting(false);
    }
  };

  const handleDelete = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteMyPhoto(photo.photo_id, photo.photo_url);
      setToast({ text: tt('사진을 삭제했어요'), tone: 'ok' });
      setRemoved(true);
      onDeleted?.(photo.photo_id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ text: `${tt('삭제 실패')} — ${msg.slice(0, 80)}`, tone: 'warn' });
      setDeleting(false);
    } finally {
      setShowDeleteConfirm(false);
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
          aria-label={tt('사진 크게 보기')}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo.photo_url}
            alt=""
            className={`w-full object-cover ${compact ? 'h-52' : 'aspect-square'}`}
            loading="lazy"
          />

          {/* build 156: 사진 위 어두운 그라데이션 + ID/거리 오버레이 제거.
              인스타 스타일 — 사진 깨끗 / 정보는 사진 외부 footer 에 정렬. */}
        </button>

        {/* 인스타식 footer — 사용자 ID + 거리 + 캡션 (사진 외부 흰 배경, 가독성 ↑) */}
        <div className="px-3.5 py-3 bg-[var(--card)] border-t border-[var(--card-border)]/40 space-y-1.5">
          {/* row 1: @username + 거리/지역 */}
          <div className="flex items-center justify-between gap-2">
            <Link
              href={`/social/user?id=${photo.user_id}`}
              className="inline-flex items-center gap-1 text-[13px] font-extrabold text-[var(--foreground)] active:scale-95"
              aria-label={locale === 'en' ? `View ${photo.display_name}'s profile` : `${photo.display_name} 프로필 보기`}
            >
              <span className="truncate max-w-[160px]">@{photo.display_name}</span>
              <GenderBadge gender={photo.gender} show={photo.show_gender} size={11} />
            </Link>
            <div className="flex items-center gap-1.5 text-[13px] text-[var(--muted)] font-semibold flex-shrink-0">
              <span>{Number(photo.distance_km).toFixed(1)}km</span>
              {photo.region_gu && (
                <span className="inline-flex items-center gap-0.5">
                  <MapPin size={10} />
                  {photo.region_gu}
                </span>
              )}
            </div>
          </div>
          {/* row 2: 한 줄 일기 (있을 때만) — build 137: quote_text → caption → essay_body */}
          {(photo.quote_text || photo.caption || photo.essay_body) && (
            <p className="text-[14px] italic text-[var(--foreground)] leading-relaxed line-clamp-5 break-keep">
              &ldquo;{(photo.quote_text ?? photo.caption ?? photo.essay_body ?? '').replace(/\s+/g, ' ').trim()}&rdquo;
              {photo.quote_author && photo.quote_author !== photo.display_name && (
                <span className="text-[13px] text-[var(--muted)] ml-1.5 font-semibold">— {photo.quote_author}</span>
              )}
            </p>
          )}
        </div>

        {/* 좋아요 하트 */}
        <button
          onClick={handleLike}
          disabled={busy}
          aria-label={tt('좋아요')}
          className={`absolute top-2 right-2 w-9 h-9 rounded-full bg-white/90 backdrop-blur shadow-md flex items-center justify-center transition-transform ${animate ? 'scale-125' : 'scale-100'}`}
        >
          <Heart
            size={18}
            fill={liked ? '#ef4444' : 'none'}
            className={liked ? 'text-red-500' : 'text-gray-600'}
            strokeWidth={2.2}
          />
        </button>

        {/* ⋯ 더보기 메뉴 제거 (build 122) — 삭제/신고는 Lightbox 안에서 처리 */}

        {/* 좋아요/댓글 카운트 — 사진 좌상단 (build 100 댓글 통합) */}
        {(likes > 0 || commentCount > 0) && (
          <div className="absolute top-2 left-2 flex items-center gap-1">
            {likes > 0 && (
              <div className="px-2 py-0.5 rounded-full bg-white/90 backdrop-blur text-[13px] font-bold text-gray-800 flex items-center gap-0.5 shadow-sm">
                <Heart size={10} fill="#ef4444" className="text-red-500" strokeWidth={0} />
                {likes}
              </div>
            )}
            {commentCount > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowComments(true); }}
                className="px-2 py-0.5 rounded-full bg-white/90 backdrop-blur text-[13px] font-bold text-gray-800 flex items-center gap-0.5 shadow-sm active:scale-95 transition"
                aria-label={tt('댓글 보기')}
              >
                <MessageCircle size={10} className="text-emerald-600" strokeWidth={2.5} />
                {commentCount}
              </button>
            )}
          </div>
        )}

        {/* 댓글 버튼 + 더보기 — 우측에 묶음 */}
        <button
          onClick={(e) => { e.stopPropagation(); setShowComments(true); }}
          aria-label={tt('댓글 작성')}
          className="absolute top-12 right-2 w-9 h-9 rounded-full bg-white/90 backdrop-blur shadow-md flex items-center justify-center active:scale-95 transition z-10"
        >
          <MessageCircle size={16} className="text-gray-700" strokeWidth={2.2} />
        </button>

        {/* 본인 = 삭제 / 타인 = 신고. lightbox 안 + 카드 외부 footer 두 곳에서 처리 (사용자 피드백: 우측 ⋯ 메뉴 중복) */}
        {user && (
          <button
            onClick={(e) => { e.stopPropagation(); if (isOwner) setShowDeleteConfirm(true); else setShowReport(true); }}
            aria-label={isOwner ? tt('삭제') : tt('신고')}
            className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-white/85 backdrop-blur shadow flex items-center justify-center active:scale-95 z-10"
          >
            {isOwner ? <Trash2 size={13} className="text-rose-500" /> : <Flag size={13} className="text-amber-600" />}
          </button>
        )}

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
            src={showOriginal && originalUrl ? originalUrl : photo.photo_url}
            alt=""
            className="max-w-full max-h-full object-contain rounded-lg transition-opacity duration-200 select-none"
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
            // build 317: 원본이 있으면 탭 = 토글, 꾹 (400ms) = 누르는 동안만 원본 (떼면 복귀)
            onPointerDown={(e) => {
              e.stopPropagation();
              if (!originalUrl) return;
              peekingRef.current = false;
              peekTimerRef.current = setTimeout(() => {
                peekingRef.current = true;
                setShowOriginal(true);
              }, 400);
            }}
            onPointerUp={(e) => {
              e.stopPropagation();
              if (peekTimerRef.current) { clearTimeout(peekTimerRef.current); peekTimerRef.current = null; }
              if (!originalUrl) return;
              if (peekingRef.current) { peekingRef.current = false; setShowOriginal(false); return; }
              setShowOriginal(s => !s);
            }}
            onPointerLeave={() => {
              if (peekTimerRef.current) { clearTimeout(peekTimerRef.current); peekTimerRef.current = null; }
              if (peekingRef.current) { peekingRef.current = false; setShowOriginal(false); }
            }}
            onPointerCancel={() => {
              if (peekTimerRef.current) { clearTimeout(peekTimerRef.current); peekTimerRef.current = null; }
              if (peekingRef.current) { peekingRef.current = false; setShowOriginal(false); }
            }}
          />
          {/* build 317: 원본 보기 중 — 내 사진이면 원본 저장 (공유 시트) */}
          {showOriginal && originalUrl && isOwner && (
            <button
              onClick={async (e) => {
                e.stopPropagation();
                if (savingOriginal) return;
                setSavingOriginal(true);
                try {
                  const { shareImageUrl } = await import('@/lib/share-image');
                  await shareImageUrl(originalUrl, `routinist-original-${photo.photo_id.slice(0, 8)}.jpg`);
                } catch { /* 사용자 취소 포함 — 조용히 */ }
                finally { setSavingOriginal(false); }
              }}
              className="absolute right-4 bottom-[calc(env(safe-area-inset-bottom)+24px)] px-4 py-3 rounded-2xl bg-white/15 backdrop-blur text-white text-sm font-semibold active:scale-95 transition disabled:opacity-50"
              disabled={savingOriginal}
            >
              {savingOriginal ? '…' : (locale === 'en' ? 'Save photo' : '원본 저장')}
            </button>
          )}
          {/* 원본 토글 힌트 — 원본이 있을 때만 */}
          {originalUrl && (
            <div
              className="absolute left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-white/15 backdrop-blur text-white/90 text-[13px] font-bold pointer-events-none"
              style={{ top: 'calc(env(safe-area-inset-top, 0px) + 20px)' }}
            >
              {showOriginal
                ? (locale === 'en' ? 'Tap to show the record' : '탭하면 기록이 다시 보여요')
                : (locale === 'en' ? 'Tap to see the clean photo' : '탭하면 사진만 깨끗하게 보여요')}
            </div>
          )}
          {/* X 닫기 버튼 — status bar / 부모 헤더와 안 겹치게 safe-area 적용 (사용자 피드백 #5). */}
          <button
            onClick={() => setShowLightbox(false)}
            className="absolute right-3 w-12 h-12 rounded-full bg-white/20 active:bg-white/30 backdrop-blur flex items-center justify-center active:scale-95 transition"
            style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
            aria-label={tt('닫기')}
          >
            <X size={26} strokeWidth={2.5} className="text-white" />
          </button>
          {/* build 317: 원본 보기 중엔 하단 패널도 숨김 — 사진만 깨끗하게 */}
          {!showOriginal && (
          <div className="absolute left-4 right-4 bottom-[calc(env(safe-area-inset-bottom)+24px)] space-y-3" onClick={(e) => e.stopPropagation()}>
            {(photo.quote_text || photo.caption || photo.essay_body) && (
              <div className="px-4 py-3 rounded-2xl bg-black/55 backdrop-blur-md text-white text-sm leading-relaxed max-h-40 overflow-y-auto">
                <p className="italic whitespace-pre-wrap">&ldquo;{photo.quote_text ?? photo.caption ?? photo.essay_body}&rdquo;</p>
                <p className="mt-2 text-[13px] text-white/70">— {photo.quote_author ?? `@${photo.display_name}`}</p>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <Link
                href={`/social/user?id=${photo.user_id}`}
                onClick={() => setShowLightbox(false)}
                className="flex-1 px-4 py-3 rounded-2xl bg-white/15 backdrop-blur text-white text-sm font-semibold active:scale-95 transition"
              >
                {locale === 'en' ? `View @${photo.display_name}'s profile` : `@${photo.display_name} 프로필 보기`}
              </Link>
              <div className="px-4 py-3 rounded-2xl bg-white/15 backdrop-blur text-white text-sm font-semibold">
                {Number(photo.distance_km).toFixed(1)}km
                {photo.region_gu && <span className="ml-2 opacity-80">· {photo.region_gu}</span>}
              </div>
              {isOwner && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(true); }}
                  aria-label={tt('삭제')}
                  className="w-12 h-12 rounded-2xl bg-red-500/80 backdrop-blur text-white flex items-center justify-center active:scale-95 transition flex-shrink-0"
                >
                  <Trash2 size={18} />
                </button>
              )}
            </div>
          </div>
          )}
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
              <h3 className="text-base font-bold text-[var(--foreground)] text-center">{tt('사진을 삭제할까요?')}</h3>
              <p className="text-sm text-[var(--muted)] text-center leading-relaxed">
                {tt('삭제하면 다른 사람들에게도 즉시 안 보이며 복구할 수 없어요.')}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="flex-1 py-3 rounded-xl bg-[var(--card-border)]/30 text-[var(--foreground)] font-semibold disabled:opacity-50"
              >
                {tt('취소')}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 py-3 rounded-xl bg-red-500 text-white font-bold disabled:opacity-50 active:scale-95 transition flex items-center justify-center gap-1.5"
              >
                {deleting ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    {tt('삭제 중')}
                  </>
                ) : tt('삭제')}
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
              <h3 className="text-base font-bold text-[var(--foreground)] text-center">{tt('사진 신고')}</h3>
              <p className="text-xs text-[var(--muted)] text-center leading-relaxed">
                {tt('신고 사유를 선택해주세요. 검토 후 24시간 안에 조치합니다.')}
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
                  {tt(opt.label)}
                </button>
              ))}
            </div>
            {!isOwner && (
              <button
                onClick={handleBlockUser}
                disabled={reporting}
                className="w-full mt-1.5 px-3 py-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 text-sm font-semibold disabled:opacity-50 active:bg-rose-100 transition"
              >
                {locale === 'en' ? `Block @${photo.display_name}` : `${photo.display_name}님 차단하기`}
              </button>
            )}
            <button
              onClick={() => setShowReport(false)}
              disabled={reporting}
              className="w-full mt-3 py-2.5 text-sm text-[var(--muted)] disabled:opacity-50"
            >
              {tt('취소')}
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
