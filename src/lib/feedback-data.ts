// 제안/버그 게시판 (Feedback Posts) — RPC + view wrapper.

import { getSupabase } from './supabase';

export type FeedbackCategory = 'bug' | 'feature' | 'ui' | 'other';
export type FeedbackStatus = 'open' | 'reviewing' | 'done' | 'wont_fix';

export interface FeedbackPost {
  id: string;
  category: FeedbackCategory;
  title: string;
  body: string;
  is_public: boolean;
  status: FeedbackStatus;
  admin_reply: string | null;
  admin_replied_at: string | null;
  upvote_count: number;
  created_at: string;
  user_id: string;
  author_name: string;
  author_avatar: string | null;
  liked_by_me?: boolean;
}

export const CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  bug: '버그',
  feature: '기능 요청',
  ui: 'UI/UX',
  other: '기타',
};

export const STATUS_LABEL: Record<FeedbackStatus, string> = {
  open: '접수됨',
  reviewing: '검토 중',
  done: '완료',
  wont_fix: '보류',
};

export const STATUS_COLOR: Record<FeedbackStatus, string> = {
  open: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  reviewing: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  done: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  wont_fix: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300',
};

export async function createFeedback(
  category: FeedbackCategory,
  title: string,
  body: string,
  isPublic: boolean = true,
): Promise<string> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('create_feedback', {
    p_category: category,
    p_title: title,
    p_body: body,
    p_is_public: isPublic,
  });
  if (error) throw error;
  return data as string;
}

export async function toggleFeedbackUpvote(feedbackId: string): Promise<boolean> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('toggle_feedback_upvote', { p_feedback_id: feedbackId });
  if (error) throw error;
  return !!data;
}

export async function adminUpdateFeedback(
  feedbackId: string,
  status: FeedbackStatus,
  adminReply: string | null,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('admin_update_feedback', {
    p_feedback_id: feedbackId,
    p_status: status,
    p_admin_reply: adminReply,
  });
  if (error) throw error;
}

interface PageOptions {
  limit?: number;
  offset?: number;
  status?: FeedbackStatus | 'all';
  category?: FeedbackCategory | 'all';
  sort?: 'latest' | 'top';
}

// 공개 + 본인 글 모두 노출 (RLS 가 알아서 처리)
export async function fetchFeedback(opts: PageOptions = {}): Promise<FeedbackPost[]> {
  const supabase = getSupabase();
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  let q = supabase.from('feedback_feed').select('*');
  if (opts.status && opts.status !== 'all') q = q.eq('status', opts.status);
  if (opts.category && opts.category !== 'all') q = q.eq('category', opts.category);
  if (opts.sort === 'top') {
    q = q.order('upvote_count', { ascending: false }).order('created_at', { ascending: false });
  } else {
    q = q.order('created_at', { ascending: false });
  }
  const { data, error } = await q.range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []) as FeedbackPost[];
}

// 내가 upvote 한 글 ID — UI 상태 표시용
export async function fetchMyFeedbackUpvotes(): Promise<Set<string>> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Set();
  const { data } = await supabase
    .from('feedback_upvotes')
    .select('feedback_id')
    .eq('user_id', user.id);
  return new Set((data ?? []).map((r: { feedback_id: string }) => r.feedback_id));
}

export async function deleteMyFeedback(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from('feedback_posts').delete().eq('id', id);
  if (error) throw error;
}
