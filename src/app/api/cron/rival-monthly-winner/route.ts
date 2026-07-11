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

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'backend misconfigured' }, { status: 500 });
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  if (todayMonth === tomorrowMonth) {
    // build 298 self-heal: 말일 발사가 죽으면 정산이 영구 누락됐음 (6월 500P 미지급 사고).
    // 말일이 아니어도 "지난달 매칭은 있는데 승자 지급 이력이 0건" 이면 지난달 정산을 소급 실행.
    // 전원 동률인 달은 매일 0건 재시도가 돌지만 무해 (동률은 지급 skip).
    const prev = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - 1, 1));
    const prevMonth = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
    const { count: pairCount } = await supabase
      .from('monthly_rivals')
      .select('user_id', { count: 'exact', head: true })
      .eq('month', prevMonth);
    if ((pairCount ?? 0) > 0) {
      const { count: paidCount } = await supabase
        .from('mileage_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'monthly_rival_win')
        .eq('metadata->>month', prevMonth);
      if ((paidCount ?? 0) === 0) {
        const { data, error } = await supabase.rpc('finalize_monthly_rival_winner', { p_month: prevMonth });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true, awarded: data ?? 0, month: prevMonth, selfHeal: true });
      }
    }
    return NextResponse.json({ ok: true, skipped: true, reason: 'not_month_end', month: todayMonth });
  }

  const { data, error } = await supabase.rpc('finalize_monthly_rival_winner', { p_month: todayMonth });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, awarded: data ?? 0, month: todayMonth });
}

export async function GET(req: NextRequest) { return POST(req); }
