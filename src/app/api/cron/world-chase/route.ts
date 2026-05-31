// build 231 (229.C): 월드런 챌린지 친구 추격 push cron.
// 매 4시간 (vercel.json crons) 실행. enqueue_world_chase_pushes RPC 가 활성 코스 내 follow
// 쌍에서 1.5km 미만 격차로 따라오는 친구를 발견하면 push_send_log 에 'world_chase' 카테고리로
// INSERT. 실제 발송은 매 분 도는 /api/push/send 가 처리.
//
// 24h throttle 은 RPC 내부. 푸시 설정 OFF 사용자도 RPC 가 skip.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function authenticated(req: NextRequest): boolean {
  const cronSecret = process.env.PUSH_CRON_SECRET;
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

  const { data, error } = await supabase.rpc('enqueue_world_chase_pushes');
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, enqueued: data ?? 0 });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
