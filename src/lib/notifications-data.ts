// build 261: 통합 알림 인박스 클라이언트.
// fetch_unread_notification_summary RPC → 탭바·앱 아이콘 배지.
// mark_notifications_read RPC → 해당 탭 진입 시 읽음 처리.

import { getSupabase } from './supabase';
import { logClientWarn } from './error-logger';

export interface UnreadSummary {
  total: number;
  cheer: number;
  comment: number;  // photo_comment + activity_comment 합산
  follow: number;
}

const EMPTY: UnreadSummary = { total: 0, cheer: 0, comment: 0, follow: 0 };

export async function fetchUnreadNotificationSummary(): Promise<UnreadSummary> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('fetch_unread_notification_summary').single();
    if (error || !data) return EMPTY;
    const d = data as { total_unread: number; cheer_unread: number; comment_unread: number; follow_unread: number };
    return {
      total: d.total_unread ?? 0,
      cheer: d.cheer_unread ?? 0,
      comment: d.comment_unread ?? 0,
      follow: d.follow_unread ?? 0,
    };
  } catch (e) {
    void logClientWarn('notifications', 'fetch unread fail', {
      message: e instanceof Error ? e.message : String(e),
    });
    return EMPTY;
  }
}

/**
 * 특정 종류의 알림을 모두 읽음 처리. kinds=null 이면 전체.
 * 소셜 탭 진입 시 ['cheer', 'photo_comment', 'activity_comment', 'follow'] 호출 권장.
 */
export async function markNotificationsRead(kinds: string[] | null = null): Promise<number> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('mark_notifications_read', { p_kinds: kinds });
    if (error) {
      void logClientWarn('notifications', 'mark read fail', { message: error.message });
      return 0;
    }
    return Number(data) || 0;
  } catch (e) {
    void logClientWarn('notifications', 'mark read fail', {
      message: e instanceof Error ? e.message : String(e),
    });
    return 0;
  }
}

/**
 * build 298: 개별 알림 읽음 처리 — 알림 항목을 탭(확인)했을 때 그 건만.
 * 진입-시-전체-읽음은 사용자가 내용을 보기 전에 배지를 지워버려서 폐기됨.
 */
export async function markNotificationReadById(id: string): Promise<boolean> {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.rpc('mark_notification_read_by_id', { p_id: id });
    if (error) {
      void logClientWarn('notifications', 'mark read by id fail', { message: error.message });
      return false;
    }
    return true;
  } catch (e) {
    void logClientWarn('notifications', 'mark read by id fail', {
      message: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

// 알림 읽음 상태가 바뀐 걸 layout 배지에 즉시 알리는 앱 내부 이벤트.
// (layout 의 refreshBadges 는 focus/visibility/5분 주기라 SPA 내 이동은 못 잡음)
export const BADGE_REFRESH_EVENT = 'routinist:badge-refresh';
export function requestBadgeRefresh() {
  try { window.dispatchEvent(new Event(BADGE_REFRESH_EVENT)); } catch { /* SSR */ }
}

// 소셜 탭이 다루는 알림 종류 — 응원 + 댓글 + 팔로우 + 친구 신청·수락.
// 쪽지는 messages 시스템 (build 258) 으로 별도 추적.
// build 264: friend_request, friend_accepted 추가.
export const SOCIAL_KINDS = ['cheer', 'photo_comment', 'activity_comment', 'follow', 'friend_request', 'friend_accepted', 'referral_joined'];

export type NotificationKind = 'cheer' | 'photo_comment' | 'activity_comment' | 'follow' | 'friend_request' | 'friend_accepted' | 'referral_joined';

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  source_id: string | null;
  actor_id: string | null;
  actor_display_name: string | null;
  actor_avatar_url: string | null;
  preview: string | null;
  created_at: string;
  read_at: string | null;
}

export async function fetchNotificationsList(limit = 100, offset = 0): Promise<NotificationItem[]> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('fetch_notifications_list', {
      p_limit: limit, p_offset: offset,
    });
    if (error) {
      void logClientWarn('notifications', 'list fetch fail', { message: error.message });
      return [];
    }
    return (data ?? []) as NotificationItem[];
  } catch (e) {
    void logClientWarn('notifications', 'list fetch fail', {
      message: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}
