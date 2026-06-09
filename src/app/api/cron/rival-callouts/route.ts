// build 281: 매일 라이벌 콜아웃 push 큐잉.
// - D-3 ~ D-1 사이 라이벌 격차가 5km 이내면 "한 번만 뛰면 역전!" push
// - 월초~중반엔 colossal 격차여도 시간 충분해서 push 안 보냄 (noisy 방지)
// vercel.json crons 에서 매일 18:00 KST = 09:00 UTC 호출.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isCronAuthenticated } from '@/lib/cron-auth';

interface RivalRow {
  user_id: string;
  opponent_id: string;
  month: string;
}

export async function POST(req: NextRequest) {
  if (!isCronAuthenticated(req, 'RIVAL_CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'backend misconfigured' }, { status: 500 });

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // 오늘 KST
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const month = `${yyyy}-${mm}`;
  const monthStart = `${month}-01`;
  const lastDay = new Date(Date.UTC(yyyy, kst.getUTCMonth() + 1, 0)).getUTCDate();
  const today = kst.getUTCDate();
  const daysLeft = lastDay - today;

  // D-3 ~ D-1 만 발사. D-0 (말일) 은 결과 알림으로 별도 (phase 3).
  if (daysLeft > 3 || daysLeft < 1) {
    return NextResponse.json({ ok: true, skipped: true, days_left: daysLeft });
  }

  // 이번 달 매칭 전체 (rival A→B row 만 — opponent 정보)
  const { data: rivals } = await supabase
    .from('monthly_rivals')
    .select('user_id, opponent_id, month')
    .eq('month', month);
  if (!rivals || rivals.length === 0) {
    return NextResponse.json({ ok: true, queued: 0 });
  }

  // 이달 km 사용자별 합계
  const userIds = Array.from(new Set(rivals.flatMap((r: RivalRow) => [r.user_id, r.opponent_id])));
  const { data: acts } = await supabase
    .from('activities')
    .select('user_id, distance_km')
    .in('user_id', userIds)
    .gte('activity_date', monthStart)
    .eq('visibility', 'public');
  const kmMap = new Map<string, number>();
  for (const a of (acts ?? []) as { user_id: string; distance_km: number | string }[]) {
    kmMap.set(a.user_id, (kmMap.get(a.user_id) ?? 0) + Number(a.distance_km));
  }

  let queued = 0;
  for (const r of rivals as RivalRow[]) {
    const myKm = kmMap.get(r.user_id) ?? 0;
    const rivalKm = kmMap.get(r.opponent_id) ?? 0;
    const diff = rivalKm - myKm;  // 양수 = 라이벌이 앞섬

    // D-3 ~ D-1 + 격차 0.1km ~ 5km 안 → 콜아웃
    if (diff < 0.1 || diff > 5) continue;

    // should_send_push 카테고리 'social_rival' 체크
    const { data: shouldSend } = await supabase.rpc('should_send_push', {
      p_user_id: r.user_id, p_category: 'social_rival',
    });
    if (shouldSend === false) continue;

    const title = '⚔️ 라이벌 따라잡기';
    const body = daysLeft === 1
      ? `오늘이 마지막! 라이벌이 ${diff.toFixed(1)}km 앞서고 있어요`
      : `D-${daysLeft} · 라이벌이 ${diff.toFixed(1)}km 앞서고 있어요. 한 번 뛰면 역전!`;

    const { error } = await supabase.from('push_send_log').insert({
      user_id: r.user_id,
      category: 'social_rival',
      title, body,
      payload: { kind: 'rival_callout', rival_id: r.opponent_id, days_left: daysLeft, diff_km: diff },
      status: 'pending',
    });
    if (!error) queued++;
  }

  return NextResponse.json({ ok: true, queued, days_left: daysLeft, month });
}

export async function GET(req: NextRequest) { return POST(req); }
