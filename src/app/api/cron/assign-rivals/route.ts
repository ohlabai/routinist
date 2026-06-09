// build 281: 매월 1일 이달의 라이벌 자동 매칭 cron.
// vercel.json 의 crons 에서 매월 1일 00:30 KST = 15:30 UTC 호출.
// 이미 매칭된 사용자는 ON CONFLICT 로 skip. 신규 사용자만 매칭 추가.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isCronAuthenticated } from '@/lib/cron-auth';

export async function POST(req: NextRequest) {
  if (!isCronAuthenticated(req, 'RIVAL_CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'backend misconfigured' }, { status: 500 });

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc('assign_monthly_rivals');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, paired: data ?? 0 });
}

export async function GET(req: NextRequest) { return POST(req); }
