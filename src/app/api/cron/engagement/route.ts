// 인게이지먼트 cron — 일일 1회.
// 1. 리뷰 작성 reminder (delivered 24~72h + 미작성)
// 2. 위시리스트 재고 임박 (stock ≤ 5, 7일 1회)

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function authenticated(req: NextRequest): boolean {
  const cronSecret = process.env.SHOP_CRON_SECRET || process.env.PUSH_CRON_SECRET;
  if (!cronSecret) return false;
  const auth = req.headers.get('authorization') ?? '';
  const queryToken = req.nextUrl.searchParams.get('token');
  return auth === `Bearer ${cronSecret}` || queryToken === cronSecret;
}

export async function POST(req: NextRequest) {
  if (!authenticated(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceKey || !supabaseUrl) {
    return NextResponse.json({ error: 'Backend misconfigured' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 일요일 KST 에만 weekly_best_quote 발송 (주 1회)
  const isSunday = new Date().getUTCDay() === 0;

  type RpcResult = { data: unknown; error: { message?: string } | null };
  const wrap = (q: PromiseLike<RpcResult>): Promise<RpcResult> => Promise.resolve(q);

  const tasks: Promise<RpcResult>[] = [
    wrap(supabase.rpc('enqueue_review_reminders') as unknown as PromiseLike<RpcResult>),
    wrap(supabase.rpc('enqueue_low_stock_wishlist') as unknown as PromiseLike<RpcResult>),
  ];
  if (isSunday) {
    tasks.push(wrap(supabase.rpc('enqueue_weekly_best_quote') as unknown as PromiseLike<RpcResult>));
  }

  const results = await Promise.all(tasks);

  return NextResponse.json({
    ok: true,
    review_reminders: results[0].data ?? 0,
    low_stock_pushes: results[1].data ?? 0,
    weekly_best_quotes: isSunday ? (results[2]?.data ?? 0) : null,
    errors: results.map(r => r.error?.message).filter(Boolean),
  });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
