// 제안/버그 게시판 (Feedback Posts) — RPC + view wrapper.

import { getSupabase } from './supabase';

export type FeedbackCategory = 'bug' | 'feature' | 'ui' | 'other';
export type FeedbackStatus = 'open' | 'reviewing' | 'done' | 'wont_fix';

export interface FeedbackPost {
  id: string;
  category: FeedbackCategory;
  title: string;
  body: string;
  image_url: string | null;
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
  imageUrl: string | null = null,
): Promise<string> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('create_feedback', {
    p_category: category,
    p_title: title,
    p_body: body,
    p_is_public: isPublic,
    p_image_url: imageUrl,
  });
  if (error) throw error;
  return data as string;
}

// build 172.1 #5C: 게시글 첨부 이미지 업로드. activity-photos bucket 의 feedback/ 폴더.
//   - 클라이언트에서 1024px 로 리사이즈하여 업로드 용량 절감
//   - 경로 최상단은 auth.uid() (RLS 정책 충족)
export async function uploadFeedbackImage(userId: string, file: File): Promise<string> {
  const supabase = getSupabase();
  // 클라이언트 리사이즈 — canvas 로 longest edge 1024px 로 축소 (90% jpeg).
  const blob = await resizeImage(file, 1024, 0.9);
  const ext = 'jpg';
  const path = `${userId}/feedback/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('activity-photos').upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from('activity-photos').getPublicUrl(path);
  return data.publicUrl;
}

async function resizeImage(file: File, maxEdge: number, quality: number): Promise<Blob> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('FileReader 실패'));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('이미지 로드 실패'));
    i.src = dataUrl;
  });
  const ratio = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const w = Math.round(img.width * ratio);
  const h = Math.round(img.height * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 컨텍스트 실패');
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob 실패')), 'image/jpeg', quality);
  });
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

// Apple 1.2 UGC — 부적절 게시글 신고. 같은 사용자 24h 내 중복 신고는 RPC 가 차단.
export type FeedbackReportReason = 'inappropriate' | 'spam' | 'harassment' | 'other';
export async function reportFeedback(feedbackId: string, reason: FeedbackReportReason, detail?: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('report_feedback', {
    p_feedback_id: feedbackId,
    p_reason: reason,
    p_detail: detail ?? null,
  });
  if (error) throw error;
}
