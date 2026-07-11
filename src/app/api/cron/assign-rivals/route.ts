// build 281: 매월 1일 이달의 라이벌 자동 매칭 cron.
// build 291: 스케줄 fix — 전월 말일 15:30 UTC (= KST 1일 00:30) 발사 + KST 1일 가드.
// build 298: self-heal — 6/30~7/1 cron 사망으로 7월 매칭이 11일간 통째로 빠졌던 사고 재발 방지.
// 스케줄을 매일로 바꾸고, KST 1일이 아니어도 "이번 달 매칭 0건" 이면 즉시 매칭.
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

  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const month = `${kstNow.getUTCFullYear()}-${String(kstNow.getUTCMonth() + 1).padStart(2, '0')}`;
  let selfHeal = false;
  if (kstNow.getUTCDate() !== 1) {
    // KST 1일이 아니면: 이번 달 매칭이 하나라도 있으면 정상 → skip.
    // 0건이면 1일 발사가 죽었던 것 — 즉시 매칭 (self-heal).
    const { count, error: cntErr } = await supabase
      .from('monthly_rivals')
      .select('user_id', { count: 'exact', head: true })
      .eq('month', month);
    if (cntErr) return NextResponse.json({ error: cntErr.message }, { status: 500 });
    if ((count ?? 0) > 0) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'already assigned', month });
    }
    selfHeal = true;
  }

  const { data, error } = await supabase.rpc('assign_monthly_rivals');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, paired: data ?? 0, month, selfHeal });
}

export async function GET(req: NextRequest) { return POST(req); }
