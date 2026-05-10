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

  const [reviews, lowStock] = await Promise.all([
    supabase.rpc('enqueue_review_reminders'),
    supabase.rpc('enqueue_low_stock_wishlist'),
  ]);

  return NextResponse.json({
    ok: true,
    review_reminders: reviews.data ?? 0,
    low_stock_pushes: lowStock.data ?? 0,
    errors: [reviews.error?.message, lowStock.error?.message].filter(Boolean),
  });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
