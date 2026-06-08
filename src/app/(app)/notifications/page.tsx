'use client';

// build 263: 알림 리스트 페이지. user_notifications 의 응원·댓글·팔로우 누적.
// 진입: /social 헤더 우측 종 아이콘 → /notifications
// markRead: mount 시 자동으로 SOCIAL_KINDS 전체 read 처리.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Heart, MessageSquare, UserPlus, Bell } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import {
  fetchNotificationsList,
  markNotificationsRead,
  SOCIAL_KINDS,
  type NotificationItem,
  type NotificationKind,
} from '@/lib/notifications-data';

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
};

const KIND_COLORS: Record<NotificationKind, string> = {
  cheer: 'bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400',
  photo_comment: 'bg-sky-100 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400',
  activity_comment: 'bg-sky-100 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400',
  follow: 'bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400',
};

// 알림 클릭 시 라우팅. 각 kind 가 가리키는 컨텐츠로 이동.
// source_id 가 NULL 이거나 컨텐츠 페이지가 없으면 fallback.
function getHref(item: NotificationItem): string {
  switch (item.kind) {
    case 'cheer':
      // 응원받은 곳 — 정확한 위치는 모르지만 본인 프로필 또는 소셜 탭으로
      return '/profile';
    case 'photo_comment':
      return item.source_id ? `/photos/${item.source_id}` : '/social?tab=photos';
    case 'activity_comment':
      return item.source_id ? `/activity?id=${item.source_id}` : '/dashboard';
    case 'follow':
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
    }
  }
  switch (kind) {
    case 'cheer': return `${actorName}님이 응원을 보냈어요`;
    case 'photo_comment': return `${actorName}님이 사진에 댓글을 남겼어요`;
    case 'activity_comment': return `${actorName}님이 활동에 댓글을 남겼어요`;
    case 'follow': return `${actorName}님이 친구로 추가했어요`;
  }
}

export default function NotificationsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { tt, locale } = useI18n();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    let mounted = true;
    (async () => {
      setLoading(true);
      const list = await fetchNotificationsList(100);
      if (!mounted) return;
      setItems(list);
      setLoading(false);
      // mount 시 자동으로 모두 read 처리. optimistic 으로 화면은 read=now 표시 X (그대로 보임).
      void markNotificationsRead(SOCIAL_KINDS);
    })();
    return () => { mounted = false; };
  }, [user, authLoading, router]);

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
              return (
                <Link
                  key={item.id}
                  href={getHref(item)}
                  className={`card flex items-start gap-3 p-4 transition active:scale-[0.98] ${isUnread ? 'bg-emerald-50/40 dark:bg-emerald-950/15 border-emerald-200/40 dark:border-emerald-800/30' : ''}`}
                >
                  {/* actor avatar 또는 kind icon */}
                  {item.actor_avatar_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={item.actor_avatar_url}
                      alt=""
                      className="w-10 h-10 rounded-full object-cover shrink-0"
                    />
                  ) : (
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${iconColor}`}>
                      <Icon size={18} strokeWidth={2} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[var(--foreground)] break-keep">
                      <span className="font-extrabold">{actorName}</span>
                      <span className="font-medium">
                        {describeKind(item.kind, '', locale).replace(actorName, '').replace(/^(님이?|sent|commented|started)/, ' $1')}
                      </span>
                    </p>
                    {item.preview && (item.kind === 'photo_comment' || item.kind === 'activity_comment') && (
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
                  </div>
                  {isUnread && (
                    <span className="shrink-0 w-2 h-2 rounded-full bg-emerald-500 mt-2" />
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
