// build 281: 매월 1일 이달의 라이벌 자동 매칭 cron.
// build 291: 스케줄 fix — 이전 "30 15 1 * *" 은 UTC 1일 15:30 = KST 2일 00:30 이라 매칭이
// 하루 늦었음 (1일엔 페이스메이커 없는 화면). 전월 말일 15:30 UTC (= KST 1일 00:30) 로 변경.
// cron 은 "말일"을 표현 못 해 28~31일 매일 후보 발사 + 아래 가드가 KST 1일에만 통과.
// 이미 매칭된 사용자는 ON CONFLICT 로 skip. 신규 사용자만 매칭 추가.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isCronAuthenticated } from '@/lib/cron-auth';

export async function POST(req: NextRequest) {
  if (!isCronAuthenticated(req, 'RIVAL_CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // KST 1일에만 실행 (28~31일 발사분 중 말일 것만 통과)
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  if (kstNow.getUTCDate() !== 1) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'not KST 1st', kst_date: kstNow.getUTCDate() });
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
