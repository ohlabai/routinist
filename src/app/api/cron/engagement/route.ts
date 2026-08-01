// 인게이지먼트 cron — 일일 1회.
// 1. 리뷰 작성 reminder (delivered 24~72h + 미작성)
// 2. 위시리스트 재고 임박 (stock ≤ 5, 7일 1회)

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isCronAuthenticated } from '@/lib/cron-auth';

export async function POST(req: NextRequest) {
  if (!isCronAuthenticated(req, 'SHOP_CRON_SECRET', 'PUSH_CRON_SECRET')) {
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

  // build 167 (v1.1) — 인게이지먼트 3종 추가.
  // 매월 마지막 날 KST 에 월말 정산 카드 push.
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const tomorrowKst = new Date(nowKst);
  tomorrowKst.setUTCDate(nowKst.getUTCDate() + 1);
  const isLastDayOfMonth = nowKst.getUTCMonth() !== tomorrowKst.getUTCMonth();

  type RpcResult = { data: unknown; error: { message?: string } | null };
  const wrap = (q: PromiseLike<RpcResult>): Promise<RpcResult> => Promise.resolve(q);

  const tasks: Promise<RpcResult>[] = [
    wrap(supabase.rpc('enqueue_review_reminders') as unknown as PromiseLike<RpcResult>),
    wrap(supabase.rpc('enqueue_low_stock_wishlist') as unknown as PromiseLike<RpcResult>),
    // build 167 #9 → build 293: 3단계 win-back (3d/7d/30d, payload.stage dedup) 로 재작성됨
    wrap(supabase.rpc('enqueue_idle_reminders') as unknown as PromiseLike<RpcResult>),
    // build 167 #11: Run of the Day 매일 1회 자동 선정 (어제 활동 기준)
    wrap(supabase.rpc('pick_run_of_the_day') as unknown as PromiseLike<RpcResult>),
    // build 293 리텐션 래더 — 전부 매일 호출 (함수 내부가 유저별 로컬 날짜/dedup 판정).
    // weekly_recap (주간 리포트) 은 2026-08-01 hans 지시로 폐기 — DB 함수도 DROP 됨.
    wrap(supabase.rpc('enqueue_welcome_pushes') as unknown as PromiseLike<RpcResult>),
    wrap(supabase.rpc('enqueue_streak_risk_pushes') as unknown as PromiseLike<RpcResult>),
  ];
  if (isSunday) {
    tasks.push(wrap(supabase.rpc('enqueue_weekly_best_quote') as unknown as PromiseLike<RpcResult>));
  }
  if (isLastDayOfMonth) {
    // build 167 #10: 월말 정산 카드 push (매월 마지막날 1회)
    tasks.push(wrap(supabase.rpc('enqueue_month_end_recaps') as unknown as PromiseLike<RpcResult>));
  }

  const results = await Promise.all(tasks);

  return NextResponse.json({
    ok: true,
    review_reminders: results[0].data ?? 0,
    low_stock_pushes: results[1].data ?? 0,
    idle_reminders: results[2].data ?? 0,
    run_of_the_day: results[3].data ?? 0,
    welcome_d1: results[4].data ?? 0,
    streak_risk: results[5].data ?? 0,
    weekly_recaps: results[6].data ?? 0,
    weekly_best_quotes: isSunday ? (results[7]?.data ?? 0) : null,
    month_end_recaps: isLastDayOfMonth ? (results[isSunday ? 8 : 7]?.data ?? 0) : null,
    errors: results.map(r => r.error?.message).filter(Boolean),
  });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
