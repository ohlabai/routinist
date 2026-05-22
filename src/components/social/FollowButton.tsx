'use client';

// 친구 버튼 — 클릭 즉시 토글 (build 69 → 70).
// 사용자 결정 (build 70): "팔로우/팔로잉" 용어가 헷갈림 → "친구 추가" / "친구" 로 통일.
// 미친구: 투명 배경 + emerald 보더 + emerald 텍스트 + UserPlus 아이콘
// 친구:   emerald 채움 + 흰 텍스트 + Check 아이콘
// 누르면 optimistic 즉시 색/라벨 바뀜. 실패 시 롤백 + 토스트로 원인 노출.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, Check } from 'lucide-react';
import { followUser, unfollowUser } from '@/lib/social-data';
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

export default function FollowButton({ userId, initialFollowing, onToggle, size = 'sm' }: FollowButtonProps) {
  const [following, setFollowing] = useState(initialFollowing);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const { user, profile } = useAuth();
  const { t } = useI18n();
  const router = useRouter();

  // build 163 #1: 신규 회원이 첫 친구를 추가했을 때 onboarding toast + 홈 복귀.
  // 가입 7일 이내 + first_friend_added flag 미설정인 경우만.
  const isNewUser = (() => {
    const createdAt = (profile as { created_at?: string } | null)?.created_at;
    if (!createdAt) return false;
    const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / (24 * 60 * 60 * 1000));
    return days <= 7;
  })();

  const handleToggle = async () => {
    if (loading) return;
    const next = !following;
    setLoading(true);
    setFollowing(next); // optimistic — 즉시 색/라벨 변경
    try {
      if (next) {
        await followUser(userId);
        // 신규 회원 첫 친구 추가 → 환영 토스트 + 홈으로 이동
        const flagKey = user ? `first_friend_added:${user.id}` : null;
        const isFirst = flagKey && typeof window !== 'undefined' && !window.localStorage.getItem(flagKey);
        if (isFirst && isNewUser && flagKey) {
          window.localStorage.setItem(flagKey, String(Date.now()));
          setToast({ text: '🎉 첫 번째 친구를 추가했어요! 시작 가이드가 완성됐어요', tone: 'ok' });
          setTimeout(() => router.push('/dashboard'), 1500);
        } else {
          setToast({ text: '친구로 추가했어요', tone: 'ok' });
        }
      } else {
        await unfollowUser(userId);
        setToast({ text: '친구에서 해제했어요', tone: 'ok' });
      }
      onToggle?.(next);
    } catch (err) {
      setFollowing(!next); // 롤백
      const msg = err instanceof Error ? err.message : String(err);
      logClientWarn('FollowButton', 'toggle 실패', { userId, action: next ? 'add' : 'remove', reason: msg });
      const friendly =
        msg.includes('duplicate key') || msg.includes('unique') ? '이미 친구로 추가했어요' :
        msg.includes('foreign key') ? '존재하지 않는 사용자예요' :
        msg.includes('row-level security') || msg.includes('permission') ? '권한이 없어요. 다시 로그인해보세요' :
        msg.includes('로그인') ? msg :
        `친구 ${next ? '추가' : '해제'} 실패 — ${msg.slice(0, 80)}`;
      setToast({ text: friendly, tone: 'warn' });
    } finally {
      setLoading(false);
    }
  };

  const padding = size === 'md' ? 'px-5 py-2.5 text-sm' : 'px-3.5 py-1.5 text-xs';
  const iconSize = size === 'md' ? 16 : 14;

  return (
    <>
      <button
        onClick={handleToggle}
        disabled={loading}
        aria-label={following ? t('friend.added') : t('friend.add')}
        className={`${padding} inline-flex items-center gap-1.5 rounded-full font-bold transition-all disabled:opacity-50 active:scale-95 ${
          following
            ? 'bg-emerald-500 text-white shadow-sm hover:bg-emerald-600'
            : 'bg-white dark:bg-zinc-900 border border-emerald-500 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
        }`}
      >
        {loading ? (
          <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : following ? (
          <Check size={iconSize} strokeWidth={3} />
        ) : (
          <UserPlus size={iconSize} strokeWidth={2.5} />
        )}
        <span>{following ? t('friend.added') : t('friend.add')}</span>
      </button>
      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2000} />}
    </>
  );
}
