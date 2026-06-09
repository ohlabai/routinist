'use client';

// build 263: 알림 리스트 페이지. user_notifications 의 응원·댓글·팔로우 누적.
// 진입: /social 헤더 우측 종 아이콘 → /notifications
// markRead: mount 시 자동으로 SOCIAL_KINDS 전체 read 처리.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Heart, MessageSquare, UserPlus, Bell, Check, X } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import {
  fetchNotificationsList,
  markNotificationsRead,
  SOCIAL_KINDS,
  type NotificationItem,
  type NotificationKind,
} from '@/lib/notifications-data';
import { respondFriendRequest } from '@/lib/friend-requests-data';
import CheerButton from '@/components/social/CheerButton';

function timeAgo(iso: string, locale: 'ko' | 'en' = 'ko'): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (locale === 'en') {
    if (ms < 60_000) return 'now';
    if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m`;
    if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h`;
    if (ms < 30 * 86400_000) return `${Math.floor(ms / 86400_000)}d`;
    return `${Math.floor(ms / (30 * 86400_000))}mo`;
  }
  if (ms < 60_000) return '방금';
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}분 전`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}시간 전`;
  if (ms < 30 * 86400_000) return `${Math.floor(ms / 86400_000)}일 전`;
  return `${Math.floor(ms / (30 * 86400_000))}달 전`;
}

const KIND_ICONS: Record<NotificationKind, typeof Heart> = {
  cheer: Heart,
  photo_comment: MessageSquare,
  activity_comment: MessageSquare,
  follow: UserPlus,
  friend_request: UserPlus,
  friend_accepted: Check,
};

const KIND_COLORS: Record<NotificationKind, string> = {
  cheer: 'bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400',
  photo_comment: 'bg-sky-100 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400',
  activity_comment: 'bg-sky-100 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400',
  follow: 'bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400',
  friend_request: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400',
  friend_accepted: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400',
};

// 알림 클릭 시 라우팅. 각 kind 가 가리키는 컨텐츠로 이동.
// source_id 가 NULL 이거나 컨텐츠 페이지가 없으면 fallback.
function getHref(item: NotificationItem): string {
  switch (item.kind) {
    case 'cheer':
      // build 271: 응원 클릭 → 응원 보낸 사람 (actor) 프로필. 답례 응원 가능.
      // 이전엔 본인 프로필 (/profile) 으로 갔는데 사용자 신고: "알림 내용이 안 나오고 내 프로필만 나옴"
      return item.actor_id ? `/social/user?id=${item.actor_id}` : '/social?tab=friends';
    case 'photo_comment':
      return item.source_id ? `/photos/${item.source_id}` : '/social?tab=photos';
    case 'activity_comment':
      return item.source_id ? `/activity?id=${item.source_id}` : '/dashboard';
    case 'follow':
    case 'friend_request':
    case 'friend_accepted':
      return item.actor_id ? `/social/user?id=${item.actor_id}` : '/social?tab=friends';
  }
}

function describeKind(kind: NotificationKind, actorName: string, locale: 'ko' | 'en'): string {
  if (locale === 'en') {
    switch (kind) {
      case 'cheer': return `${actorName} sent a cheer`;
      case 'photo_comment': return `${actorName} commented on your photo`;
      case 'activity_comment': return `${actorName} commented on your activity`;
      case 'follow': return `${actorName} started following you`;
      case 'friend_request': return `${actorName} sent you a friend request`;
      case 'friend_accepted': return `${actorName} accepted your friend request`;
    }
  }
  switch (kind) {
    case 'cheer': return `${actorName}님이 응원을 보냈어요`;
    case 'photo_comment': return `${actorName}님이 사진에 댓글을 남겼어요`;
    case 'activity_comment': return `${actorName}님이 활동에 댓글을 남겼어요`;
    case 'follow': return `${actorName}님이 친구로 추가했어요`;
    case 'friend_request': return `${actorName}님이 친구 신청을 보냈어요`;
    case 'friend_accepted': return `${actorName}님이 친구 신청을 수락했어요`;
  }
}

const PAGE_SIZE = 50;

export default function NotificationsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { tt, locale } = useI18n();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  // build 279: 더 보기 페이지네이션. 50건씩 추가 fetch.
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    let mounted = true;
    (async () => {
      setLoading(true);
      const list = await fetchNotificationsList(PAGE_SIZE, 0);
      if (!mounted) return;
      setItems(list);
      setHasMore(list.length >= PAGE_SIZE);
      setLoading(false);
      // mount 시 자동으로 모두 read 처리. optimistic 으로 화면은 read=now 표시 X (그대로 보임).
      void markNotificationsRead(SOCIAL_KINDS);
    })();
    return () => { mounted = false; };
  }, [user, authLoading, router]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchNotificationsList(PAGE_SIZE, items.length);
      setItems(prev => [...prev, ...next]);
      setHasMore(next.length >= PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  };

  // build 264: friend_request 카드 inline accept/reject. source_id 가 friend_requests.id.
  const handleRespond = async (item: NotificationItem, accept: boolean) => {
    if (!item.source_id || respondingId) return;
    setRespondingId(item.id);
    try {
      await respondFriendRequest(item.source_id, accept);
      // 응답 끝나면 화면에서 그 알림은 dim 처리 + kind 변경
      setItems(prev => prev.map(p => p.id === item.id ? { ...p, kind: accept ? 'friend_accepted' : p.kind, read_at: new Date().toISOString() } : p));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      window.alert(msg);
    } finally {
      setRespondingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--background)] flex flex-col">
      {/* sticky 헤더 */}
      <header className="sticky top-0 z-30 bg-[var(--header-bg)]/90 backdrop-blur-xl border-b border-[var(--card-border)]/40 pt-[max(env(safe-area-inset-top),12px)]">
        <div className="flex items-center gap-2 px-3 py-3">
          <button onClick={() => router.back()}
            aria-label={tt('뒤로')}
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-base font-extrabold tracking-tight">{tt('알림')}</h1>
        </div>
      </header>

      <main className="flex-1 px-4 py-3">
        {loading ? (
          <div className="space-y-2 mt-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="card p-4 animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[var(--card-border)]/40" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 bg-[var(--card-border)]/40 rounded w-3/4" />
                    <div className="h-3 bg-[var(--card-border)]/30 rounded w-1/4" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center mb-3">
              <Bell size={28} className="text-emerald-500" strokeWidth={1.8} />
            </div>
            <p className="text-base font-bold text-[var(--foreground)] mb-1">{tt('아직 알림이 없어요')}</p>
            <p className="text-sm text-[var(--muted)] max-w-xs break-keep">
              {tt('응원·댓글·친구 추가가 오면 여기서 확인할 수 있어요')}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => {
              const Icon = KIND_ICONS[item.kind];
              const iconColor = KIND_COLORS[item.kind];
              const actorName = item.actor_display_name || tt('알 수 없음');
              const isUnread = !item.read_at;
              const isFriendRequest = item.kind === 'friend_request';
              // build 275: cheer 알림에 inline 답례 응원 버튼. actor 가 있어야 발사 가능.
              const isCheerWithActor = item.kind === 'cheer' && !!item.actor_id;

              const inner = (
                <>
                  {item.actor_avatar_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={item.actor_avatar_url} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${iconColor}`}>
                      <Icon size={18} strokeWidth={2} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[var(--foreground)] break-keep">
                      <span className="font-extrabold">{actorName}</span>
                      <span className="font-medium">
                        {describeKind(item.kind, '', locale).replace(actorName, '').replace(/^(님이?|sent|commented|started|accepted)/, ' $1')}
                      </span>
                    </p>
                    {item.preview && (item.kind === 'photo_comment' || item.kind === 'activity_comment' || item.kind === 'friend_request') && (
                      <p className="text-[13px] text-[var(--muted)] mt-0.5 break-keep line-clamp-2">
                        &ldquo;{item.preview}&rdquo;
                      </p>
                    )}
                    {item.kind === 'cheer' && item.preview && (
                      <p className="text-base mt-0.5">{item.preview}</p>
                    )}
                    <p className="text-[11px] text-[var(--muted)] mt-1">
                      {timeAgo(item.created_at, locale)}
                    </p>
                    {/* build 275: cheer 알림 → 답례 응원 버튼 inline. CheerButton 의 emoji picker.
                        Link 가 actor 프로필로 가니까 이 버튼은 propagation 막아서 응원만 보내고 그대로. */}
                    {isCheerWithActor && item.actor_id && (
                      <div className="mt-2.5 flex items-center gap-2" onClick={(e) => e.preventDefault()}>
                        <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">답례 응원</span>
                        <CheerButton toUserId={item.actor_id} context="profile" size="sm" />
                      </div>
                    )}
                    {/* build 264: friend_request 카드 inline accept/reject */}
                    {isFriendRequest && (
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={(e) => { e.preventDefault(); void handleRespond(item, true); }}
                          disabled={respondingId === item.id}
                          className="px-4 py-1.5 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-xs font-extrabold active:scale-95 shadow-md shadow-emerald-500/20 disabled:opacity-50"
                        >
                          <Check size={13} className="inline mr-1" strokeWidth={2.5} />
                          {tt('수락')}
                        </button>
                        <button
                          onClick={(e) => { e.preventDefault(); void handleRespond(item, false); }}
                          disabled={respondingId === item.id}
                          className="px-4 py-1.5 rounded-full bg-[var(--card-border)]/50 text-[var(--muted)] text-xs font-extrabold active:scale-95 disabled:opacity-50"
                        >
                          <X size={13} className="inline mr-1" strokeWidth={2.5} />
                          {tt('거절')}
                        </button>
                      </div>
                    )}
                  </div>
                  {isUnread && !isFriendRequest && (
                    <span className="shrink-0 w-2 h-2 rounded-full bg-emerald-500 mt-2" />
                  )}
                </>
              );

              // friend_request 는 inline 버튼이라 카드 전체 Link 안 함. actor 영역만 별도 Link 가능하지만 단순화.
              if (isFriendRequest) {
                return (
                  <div key={item.id} className={`card flex items-start gap-3 p-4 ${isUnread ? 'bg-emerald-50/40 dark:bg-emerald-950/15 border-emerald-200/40 dark:border-emerald-800/30' : ''}`}>
                    {inner}
                  </div>
                );
              }
              return (
                <Link
                  key={item.id}
                  href={getHref(item)}
                  className={`card flex items-start gap-3 p-4 transition active:scale-[0.98] ${isUnread ? 'bg-emerald-50/40 dark:bg-emerald-950/15 border-emerald-200/40 dark:border-emerald-800/30' : ''}`}
                >
                  {inner}
                </Link>
              );
            })}
            {/* build 279: 더 보기 버튼 — 50건씩 추가 fetch. 100건 limit 회피. */}
            {hasMore && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full py-3.5 rounded-2xl bg-[var(--card)] border border-[var(--card-border)] text-sm font-extrabold text-[var(--muted)] active:scale-[0.99] disabled:opacity-50"
              >
                {loadingMore ? tt('불러오는 중...') : tt('더 보기')}
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
