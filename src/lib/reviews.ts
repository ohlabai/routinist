// 상품 리뷰 데이터 레이어.

import { getSupabase } from './supabase';

export interface ProductReview {
  id: string;
  product_id: string;
  user_id: string;
  order_id: string | null;
  rating: number;
  body: string | null;
  helpful_count: number;
  is_hidden: boolean;
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
  const { data, error } = await supabase
    .from('product_reviews')
    .select(`
      id, product_id, user_id, order_id, rating, body, helpful_count, is_hidden, created_at, updated_at,
      user:profiles(display_name, avatar_url)
    `)
    .eq('product_id', productId)
    .eq('is_hidden', false)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []) as unknown as ProductReview[];
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
