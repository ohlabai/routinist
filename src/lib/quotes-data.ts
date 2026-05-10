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

// 공유카드용 random 명언. 같은 날 같은 명언 (=daily_quote) 의 SNS 도배 회피 +
// 사용자가 🎲 굴림 버튼으로 마음에 들 때까지 새로 받음.
// `excludeId` 를 주면 직전 명언과 다른 명언이 나오도록 한 번 retry.
export async function fetchRandomQuote(
  lang: 'ko' | 'en' | 'ko_self' = 'ko',
  excludeId?: string,
): Promise<DailyQuote> {
  try {
    const supabase = getSupabase();
    const pickOne = async (): Promise<DailyQuote | null> => {
      // ORDER BY random() LIMIT 1 — 1095개 풀이라 비용 작음.
      // 클라이언트가 직접 quotes 테이블 select. RLS 정책 'quotes_read' 가 모두 read 허용.
      const { data, error } = await withTimeout(
        supabase
          .from('quotes')
          .select('id, lang, category, text, author')
          .eq('lang', lang)
          .limit(50),
        5000,
        'quotes random select',
      );
      if (error) throw error;
      const rows = (data ?? []) as Array<{ id: string; lang: 'ko' | 'en' | 'ko_self'; category: string | null; text: string; author: string | null }>;
      if (rows.length === 0) return null;
      const filtered = excludeId ? rows.filter((r) => r.id !== excludeId) : rows;
      const pool = filtered.length > 0 ? filtered : rows;
      const r = pool[Math.floor(Math.random() * pool.length)];
      return {
        id: r.id,
        lang: r.lang,
        category: r.category,
        text: r.text,
        author: r.author,
        like_count: 0,
        liked_by_me: false,
      };
    };
    const q = await pickOne();
    return q ?? staticFallback();
  } catch (err) {
    console.warn('quotes random select 실패, fallback:', err);
    return staticFallback();
  }
}
