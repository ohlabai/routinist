// build 291: push 파이프라인 데드맨 알람.
// 배경: push 발송이 14일간 0건이던 사고 (build 270) + 이탈 리마인더가 미존재 테이블 참조로
// 출시 후 0건이던 잠복 (build 290) — 둘 다 "아무도 안 보는 에러" 때문에 몇 주를 버텼다.
// 매일 push_pipeline_health() 집계를 보고, 이상 신호면 관리자에게 push 를 직접 큐잉한다.
// (관리자 push 조차 파이프라인이 죽으면 못 가므로, 결과는 항상 client_error_logs 에도 남긴다)
// vercel.json: 매일 22:00 UTC = 07:00 KST.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isCronAuthenticated } from '@/lib/cron-auth';

// profiles 에 email 컬럼이 없어 (auth.users 는 REST 로 못 읽음) 관리자 uid 상수 사용.
// hans@openhan.kr — auth.users 에서 확인한 고정 uuid (2026-07-07).
const ADMIN_USER_ID = '74008f9a-226b-4390-bb88-463cb278a88e';

export async function POST(req: NextRequest) {
  if (!isCronAuthenticated(req, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'backend misconfigured' }, { status: 500 });

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: health, error } = await supabase.rpc('push_pipeline_health');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const h = health as {
    alarm: boolean;
    sent_24h: number;
    failed_24h: number;
    created_24h: number;
    pending_backlog: number;
    oldest_pending_minutes: number | null;
  };

  // 진단 로그는 항상 남김 — 사후 조사용 (push 자체가 죽어도 이 기록은 남는다)
  await supabase.from('client_error_logs').insert({
    scope: 'cron/push-health',
    level: h.alarm ? 'error' : 'info',
    message: h.alarm ? 'PUSH PIPELINE ALARM' : 'push pipeline ok',
    details: h,
    platform: 'server',
  });

  if (h.alarm) {
    // 관리자 push 큐잉 (파이프라인이 부분 생존이면 도달)
    await supabase.from('push_send_log').insert({
      user_id: ADMIN_USER_ID,
      category: 'admin_alert',
      title: '🚨 push 파이프라인 이상',
      body: `24h sent=${h.sent_24h} failed=${h.failed_24h} 잔량=${h.pending_backlog} (생성 ${h.created_24h}건)`,
      payload: { kind: 'push_health_alarm', ...h },
      status: 'pending',
    });
  }

  return NextResponse.json({ ok: true, ...h });
}

export async function GET(req: NextRequest) { return POST(req); }
