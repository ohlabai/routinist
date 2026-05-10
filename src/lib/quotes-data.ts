import { getSupabase } from '@/lib/supabase';
import { getDailyQuote as getStaticQuote } from '@/lib/running-quotes';

export interface DailyQuote {
  id: string;
  lang: 'ko' | 'en' | 'ko_self';
  category: string | null;
  text: string;
  author: string | null;
  like_count: number;
  liked_by_me: boolean;
}

// 'YYYY-MM-DD' (KST 기준) 또는 Date 를 'YYYY-MM-DD' 로. activity_date 는 KST 'YYYY-MM-DD'
// 문자열로 들어오므로 그대로 통과시켜 UTC 파싱으로 인한 날짜 밀림 방지.
function toLocalDateStr(date: Date | string | undefined): string {
  if (typeof date === 'string') {
    const ymd = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
    date = new Date(date);
  }
  const d = date ?? new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// build 56 패턴: 모든 supabase 호출에 timeout. SDK lock 시 fallback 으로 떨어지게.
function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    Promise.resolve(p),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} ${ms / 1000}s timeout`)), ms),
    ),
  ]);
}

const FALLBACK_ID = '00000000-0000-0000-0000-000000000000';

export function staticFallback(date?: Date | string): DailyQuote {
  return {
    id: FALLBACK_ID,
    lang: 'ko',
    category: 'fallback',
    text: getStaticQuote(date),
    author: null,
    like_count: 0,
    liked_by_me: false,
  };
}

export async function fetchDailyQuote(date?: Date | string): Promise<DailyQuote> {
  try {
    const supabase = getSupabase();
    const { data, error } = await withTimeout(
      supabase.rpc('daily_quote', { p_date: toLocalDateStr(date) }),
      5000,
      'daily_quote rpc',
    );
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return staticFallback(date);
    return {
      id: row.id,
      lang: row.lang,
      category: row.category,
      text: row.text,
      author: row.author,
      like_count: Number(row.like_count ?? 0),
      liked_by_me: !!row.liked_by_me,
    };
  } catch (err) {
    console.warn('daily_quote RPC 실패, fallback:', err);
    return staticFallback(date);
  }
}

export async function toggleQuoteLike(
  quoteId: string,
): Promise<{ liked: boolean; like_count: number }> {
  if (quoteId === FALLBACK_ID) {
    throw new Error('fallback quote 는 좋아요 불가');
  }
  const supabase = getSupabase();
  const { data, error } = await withTimeout(
    supabase.rpc('toggle_quote_like', { p_quote_id: quoteId }),
    5000,
    'toggle_quote_like rpc',
  );
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { liked: !!row?.liked, like_count: Number(row?.like_count ?? 0) };
}

export function isFallbackQuote(q: DailyQuote): boolean {
  return q.id === FALLBACK_ID;
}
