// 5분 간격 cron — 15분 이상 pending 인 주문을 자동 cancel.
// 재고 락이 영구 점유되는 것을 방지.
//
// 흐름: Vercel Cron → 이 endpoint → cleanup_stale_pending_orders RPC (service_role).
// 인증: PUSH_CRON_SECRET (다른 cron 과 공유) 또는 SHOP_CRON_SECRET.

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

  const { data, error } = await supabase.rpc('cleanup_stale_pending_orders');
  if (error) {
    console.error('[cleanup-stale-orders]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, cancelled: data ?? 0 });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
