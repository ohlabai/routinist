// 상품 리뷰 데이터 레이어.

import { getSupabase } from './supabase';

export interface ProductReview {
  id: string;
  product_id: string;
  user_id: string | null;        // cafe24 외부 리뷰는 NULL
  order_id: string | null;
  rating: number;
  body: string | null;
  helpful_count: number;
  is_hidden: boolean;
  source?: 'manual' | 'cafe24';
  external_author?: string | null;
  external_id?: string | null;
  created_at: string;
  updated_at: string;
  user?: {
    display_name?: string | null;
    avatar_url?: string | null;
  };
}

export async function fetchReviews(
  productId: string,
  limit: number = 20,
  offset: number = 0,
): Promise<ProductReview[]> {
  const supabase = getSupabase();
  // product_reviews.user_id 는 auth.users(id) FK — profiles 와 직접 FK 가 없어
  // embed `user:profiles(...)` 가 PostgREST 에서 실패 (cafe24 import 시 user_id NULL 다수).
  // → reviews 본체와 profiles 를 분리 fetch 후 client-side merge.
  const { data, error } = await supabase
    .from('product_reviews')
    .select('id, product_id, user_id, order_id, rating, body, helpful_count, is_hidden, source, external_author, external_id, created_at, updated_at')
    .eq('product_id', productId)
    .eq('is_hidden', false)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  const rows = (data ?? []) as ProductReview[];

  const userIds = Array.from(new Set(rows.map(r => r.user_id).filter((id): id is string => !!id)));
  if (userIds.length === 0) return rows;

  const { data: profs } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url')
    .in('id', userIds);
  const profMap = new Map<string, { display_name?: string | null; avatar_url?: string | null }>();
  (profs ?? []).forEach((p: { id: string; display_name?: string | null; avatar_url?: string | null }) => {
    profMap.set(p.id, { display_name: p.display_name, avatar_url: p.avatar_url });
  });
  return rows.map(r => ({ ...r, user: r.user_id ? profMap.get(r.user_id) : undefined }));
}

export async function fetchMyReview(productId: string): Promise<ProductReview | null> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('product_reviews')
    .select('*')
    .eq('product_id', productId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  return (data as ProductReview | null) ?? null;
}

export async function upsertReview(productId: string, rating: number, body: string): Promise<string> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('upsert_product_review', {
    p_product_id: productId,
    p_rating: rating,
    p_body: body,
  });
  if (error) throw error;
  return data as string;
}

export async function deleteReview(reviewId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('delete_product_review', { p_review_id: reviewId });
  if (error) throw error;
}
