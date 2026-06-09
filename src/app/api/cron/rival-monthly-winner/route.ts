// build 282: 월말 라이벌 승자 결정 + 마일리지 +500P + 알림 push.
// vercel.json crons 에서 매일 14:55 UTC (23:55 KST) 호출.
// 매월 마지막 날만 동작 (오늘 +1일 의 month 가 다르면 = 말일).
// 동률 (0.5km 미만 차이) 은 양쪽 모두 안 줌.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isCronAuthenticated } from '@/lib/cron-auth';

export async function POST(req: NextRequest) {
  if (!isCronAuthenticated(req, 'RIVAL_CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 오늘 KST 가 말일인지 — 내일 KST 의 month 가 다르면 today=말일
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const tomorrow = new Date(kst.getTime() + 24 * 60 * 60 * 1000);
  const todayMonth = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`;
  const tomorrowMonth = `${tomorrow.getUTCFullYear()}-${String(tomorrow.getUTCMonth() + 1).padStart(2, '0')}`;
  if (todayMonth === tomorrowMonth) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'not_month_end', month: todayMonth });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'backend misconfigured' }, { status: 500 });
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data, error } = await supabase.rpc('finalize_monthly_rival_winner', { p_month: todayMonth });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, awarded: data ?? 0, month: todayMonth });
}

export async function GET(req: NextRequest) { return POST(req); }
