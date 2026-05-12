// 루틴포토 댓글 (build 100 후속).
// photo_comments 테이블: RLS SELECT public, INSERT own, DELETE own+admin.
// 자동 필터 (is_clean_text trigger) — 욕설/스팸 reject.

import { getSupabase } from './supabase';

export interface PhotoComment {
  id: string;
  photo_id: string;
  user_id: string;
  body: string;
  created_at: string;
  // join 으로 채움
  display_name?: string;
  avatar_url?: string | null;
}

interface ProfileSlim {
  display_name?: string;
  avatar_url?: string | null;
}

export async function fetchPhotoComments(photoId: string, limit = 50): Promise<PhotoComment[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('photo_comments')
    .select('id, photo_id, user_id, body, created_at, profiles!photo_comments_user_id_fkey(display_name, avatar_url)')
    .eq('photo_id', photoId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r: {
    id: string; photo_id: string; user_id: string; body: string; created_at: string;
    profiles?: ProfileSlim | ProfileSlim[];
  }) => {
    const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
    return {
      id: r.id,
      photo_id: r.photo_id,
      user_id: r.user_id,
      body: r.body,
      created_at: r.created_at,
      display_name: p?.display_name,
      avatar_url: p?.avatar_url ?? null,
    };
  });
}

export async function fetchPhotoCommentCount(photoId: string): Promise<number> {
  const supabase = getSupabase();
  const { count, error } = await supabase
    .from('photo_comments')
    .select('id', { count: 'exact', head: true })
    .eq('photo_id', photoId);
  if (error) throw error;
  return count ?? 0;
}

export async function insertPhotoComment(photoId: string, body: string): Promise<PhotoComment> {
  const supabase = getSupabase();
  const trimmed = body.trim();
  if (trimmed.length < 1 || trimmed.length > 500) {
    throw new Error('댓글은 1~500자');
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요해요');
  const { data, error } = await supabase
    .from('photo_comments')
    .insert({ photo_id: photoId, user_id: user.id, body: trimmed })
    .select('id, photo_id, user_id, body, created_at')
    .single();
  if (error) throw error;
  return data as PhotoComment;
}

export async function deletePhotoComment(commentId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('photo_comments')
    .delete()
    .eq('id', commentId);
  if (error) throw error;
}
