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

// 소셜 탭이 다루는 알림 종류 — 응원 + 댓글 + 팔로우.
// 쪽지는 messages 시스템 (build 258) 으로 별도 추적.
export const SOCIAL_KINDS = ['cheer', 'photo_comment', 'activity_comment', 'follow'];
