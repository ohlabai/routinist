// 범용 콘텐츠 신고 (Apple 1.2 UGC 의무) — content_reports 직접 insert.
// reportPhoto (routine-photos.ts) 와 동일 계약을 모든 target_type 으로 일반화.
// 신고가 insert 되면 DB 트리거 (content_reports_notify) 가 관리자 4명에게 푸시를 쏜다.

import { getSupabase } from './supabase';

export type ReportTargetType =
  | 'photo' | 'user' | 'message' | 'quote' | 'feedback'
  | 'photo_comment' | 'activity_comment' | 'club';

export type ReportReason = 'inappropriate' | 'spam' | 'harassment' | 'copyright' | 'other';

export async function reportContent(
  targetType: ReportTargetType,
  targetId: string,
  reason: ReportReason,
  detail?: string,
): Promise<void> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다');
  const { error } = await supabase.from('content_reports').insert({
    reporter_id: user.id,
    target_type: targetType,
    target_id: targetId,
    reason,
    detail: detail ?? null,
  });
  if (error) throw error;
}
