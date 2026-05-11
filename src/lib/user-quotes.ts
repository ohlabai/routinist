// 사용자 작성 명언 (8번 기능).
// quotes 테이블에 user_id + status 컬럼 추가 후 통합 관리.
// - create_user_quote / delete_my_quote / top_quotes_ranking / my_quotes RPC

import { getSupabase } from './supabase';

export interface MyQuote {
  id: string;
  text: string;
  author: string;
  like_count: number;
  status: 'approved' | 'pending' | 'hidden';
  created_at: string;
}

export interface RankedQuote {
  id: string;
  text: string;
  author: string | null;
  lang: string;
  category: string | null;
  like_count: number;
  liked_by_me: boolean;
  is_user_quote: boolean;
  created_at: string;
}

export async function createUserQuote(text: string): Promise<string> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('create_user_quote', { p_text: text });
  if (error) throw error;
  return data as string;
}

export async function deleteMyQuote(quoteId: string): Promise<boolean> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('delete_my_quote', { p_quote_id: quoteId });
  if (error) throw error;
  return !!data;
}

export async function fetchMyQuotes(): Promise<MyQuote[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('my_quotes');
  if (error) throw error;
  return (data ?? []) as MyQuote[];
}

export async function fetchTopQuotes(limit: number = 30, offset: number = 0): Promise<RankedQuote[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('top_quotes_ranking', {
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return (data ?? []) as RankedQuote[];
}

// 명언 신고 — content_reports 통합
export type QuoteReportReason = 'inappropriate' | 'spam' | 'harassment' | 'copyright' | 'other';
export async function reportQuote(quoteId: string, reason: QuoteReportReason, detail?: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('report_quote', {
    p_quote_id: quoteId,
    p_reason: reason,
    p_detail: detail ?? null,
  });
  if (error) throw error;
}

// 어드민 — 미해결 명언 신고 목록
export interface PendingQuoteReport {
  quote_id: string;
  quote_text: string;
  quote_author: string | null;
  quote_status: 'approved' | 'pending' | 'hidden';
  report_count: number;
  reasons: string[];
  last_reported_at: string;
}
export async function fetchPendingQuoteReports(limit: number = 50): Promise<PendingQuoteReport[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('admin_pending_quote_reports', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as PendingQuoteReport[];
}

export async function resolveQuoteReport(quoteId: string, action: 'hide' | 'dismiss' | 'restore'): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('admin_resolve_quote_report', {
    p_quote_id: quoteId,
    p_action: action,
  });
  if (error) throw error;
}
