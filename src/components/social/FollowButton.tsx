'use client';

// 친구 버튼 — build 317 (2026-07-26 hans): "친구는 신청+수락 화면으로".
// 기존 (build 69~70): 클릭 즉시 follows 토글 (즉시 친구, 승낙 없음) — 미니프로필의
// 신청→수락 모델과 화면마다 달라 혼란. 이제 전 화면 신청 모델로 통일.
//
// 3-state: none (친구 추가) → request_sent (신청 보냄 · 재탭 = 취소) → friend (친구 · 재탭 = 해제)
// - 초기 friend 여부는 부모의 initialFollowing (기존 계약 유지)
// - 초기 request_sent 는 getMySentPendingMap() 모듈 캐시 (리스트 N+1 회피)
// - 수락은 상대의 알림함에서 — 수락 시 트리거가 follows 양방향 insert.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, Check, Clock } from 'lucide-react';
import { unfollowUser } from '@/lib/social-data';
import {
  sendFriendRequest, cancelFriendRequest,
  getMySentPendingMap, touchSentPendingCache,
} from '@/lib/friend-requests-data';
import { logClientWarn } from '@/lib/error-logger';
import AppToast from '@/components/AppToast';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';

interface FollowButtonProps {
  userId: string;
  initialFollowing: boolean;
  onToggle?: (following: boolean) => void;
  /** 'sm' (검색·리스트), 'md' (미니프로필) */
  size?: 'sm' | 'md';
}

type BtnState = 'none' | 'request_sent' | 'friend';

export default function FollowButton({ userId, initialFollowing, onToggle, size = 'sm' }: FollowButtonProps) {
  const [state, setState] = useState<BtnState>(initialFollowing ? 'friend' : 'none');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const { user, profile } = useAuth();
  const { t, tt, locale } = useI18n();
  const router = useRouter();

  // 이미 보낸 pending 신청이면 request_sent 로 복원 (캐시라 리스트에서도 저렴)
  useEffect(() => {
    if (!user || initialFollowing) return;
    let cancelled = false;
    getMySentPendingMap().then(map => {
      if (cancelled) return;
      const rid = map.get(userId);
      if (rid) { setState('request_sent'); setRequestId(rid); }
    });
    return () => { cancelled = true; };
  }, [user, userId, initialFollowing]);

  // build 163 #1: 신규 회원 첫 친구 신청 onboarding toast + 홈 복귀 (가입 7일 이내 1회).
  const isNewUser = (() => {
    const createdAt = (profile as { created_at?: string } | null)?.created_at;
    if (!createdAt) return false;
    const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / (24 * 60 * 60 * 1000));
    return days <= 7;
  })();

  const handleClick = async () => {
    if (loading) return;
    setLoading(true);
    try {
      if (state === 'none') {
        const rid = await sendFriendRequest(userId);
        setState('request_sent');
        setRequestId(rid);
        touchSentPendingCache(userId, rid);
        const flagKey = user ? `first_friend_added:${user.id}` : null;
        const isFirst = flagKey && typeof window !== 'undefined' && !window.localStorage.getItem(flagKey);
        if (isFirst && isNewUser && flagKey) {
          window.localStorage.setItem(flagKey, String(Date.now()));
          setToast({ text: tt('🎉 첫 친구 신청을 보냈어요! 수락하면 친구가 돼요'), tone: 'ok' });
          setTimeout(() => router.push('/dashboard'), 1500);
        } else {
          setToast({ text: tt('친구 신청을 보냈어요 💌'), tone: 'ok' });
        }
        onToggle?.(true);
      } else if (state === 'request_sent') {
        const msg = locale === 'en' ? 'Cancel this friend request?' : '보낸 친구 신청을 취소할까요?';
        if (!window.confirm(msg)) return;
        if (requestId) await cancelFriendRequest(requestId);
        setState('none');
        setRequestId(null);
        touchSentPendingCache(userId, null);
        setToast({ text: tt('신청을 취소했어요'), tone: 'ok' });
        onToggle?.(false);
      } else {
        const msg = locale === 'en' ? 'Remove this friend?' : '친구에서 해제할까요?';
        if (!window.confirm(msg)) return;
        await unfollowUser(userId);
        setState('none');
        setToast({ text: tt('친구에서 해제했어요'), tone: 'ok' });
        onToggle?.(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logClientWarn('FollowButton', 'action 실패', { userId, state, reason: msg });
      // 서버의 친근 안내는 그대로 노출 ("상대가 이미 친구 신청을 보냈어요!" / "이미 친구예요")
      if (msg.includes('이미 친구')) {
        setState('friend');
        setToast({ text: tt('이미 친구예요'), tone: 'ok' });
      } else if (msg.includes('이미') || msg.includes('상대가')) {
        setToast({ text: msg, tone: 'ok' });
      } else {
        const friendly =
          msg.includes('row-level security') || msg.includes('permission') ? tt('권한이 없어요. 다시 로그인해보세요') :
          msg.includes('로그인') ? msg :
          `${tt('실패')} — ${msg.slice(0, 80)}`;
        setToast({ text: friendly, tone: 'warn' });
      }
    } finally {
      setLoading(false);
    }
  };

  const padding = size === 'md' ? 'px-5 py-2.5 text-sm' : 'px-3.5 py-1.5 text-xs';
  const iconSize = size === 'md' ? 16 : 14;

  const label = state === 'friend' ? t('friend.added')
    : state === 'request_sent' ? (locale === 'en' ? 'Requested' : '신청 보냄')
    : t('friend.add');

  return (
    <>
      <button
        onClick={handleClick}
        disabled={loading}
        aria-label={label}
        className={`${padding} inline-flex items-center gap-1.5 rounded-full font-bold transition-all disabled:opacity-50 active:scale-95 ${
          state === 'friend'
            ? 'bg-emerald-500 text-white shadow-sm hover:bg-emerald-600'
            : state === 'request_sent'
              ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'
              : 'bg-white dark:bg-zinc-900 border border-emerald-500 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
        }`}
      >
        {loading ? (
          <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : state === 'friend' ? (
          <Check size={iconSize} strokeWidth={3} />
        ) : state === 'request_sent' ? (
          <Clock size={iconSize} strokeWidth={2.5} />
        ) : (
          <UserPlus size={iconSize} strokeWidth={2.5} />
        )}
        <span>{label}</span>
      </button>
      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2000} />}
    </>
  );
}
