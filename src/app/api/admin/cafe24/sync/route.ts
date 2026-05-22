// 어드민이 클릭으로 Cafe24 상품 동기화 트리거 — admin 인증 후 server-side 에서 cron secret 으로 import API 호출.
// 클라이언트에 cron secret 노출 안 함.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// 어드민 이메일 단일 진실 — admin-emails.ts 와 동기화.
const ADMIN_EMAILS = new Set([
  'hans@openhan.kr',
  'claire@openhan.kr',
  'dylan@openhan.kr',
  'jane@openhan.kr',
]);

export async function POST(req: NextRequest) {
  // 1. 사용자 토큰 검증 → admin 이메일 확인
  const authHeader = req.headers.get('authorization') ?? '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!accessToken) {
    return NextResponse.json({ error: '인증 토큰 필요' }, { status: 401 });
  }
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supaUrl || !anonKey) {
    return NextResponse.json({ error: 'Supabase 환경변수 미설정' }, { status: 500 });
  }
  const userClient = createClient(supaUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user?.email) {
    return NextResponse.json({ error: '유효하지 않은 토큰' }, { status: 401 });
  }
  if (!ADMIN_EMAILS.has(user.email.toLowerCase())) {
    return NextResponse.json({ error: '어드민 권한 없음' }, { status: 403 });
  }

  // 2. cron secret 으로 import API 호출 (server-server, secret 외부 노출 안 됨)
  const cronSecret = process.env.PUSH_CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET 미설정' }, { status: 500 });
  }

  const origin = req.nextUrl.origin;
  try {
    const r = await fetch(`${origin}/api/cafe24/import?token=${encodeURIComponent(cronSecret)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const body = await r.text();
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { parsed = { raw: body }; }
    if (!r.ok) {
      return NextResponse.json({ ok: false, status: r.status, result: parsed }, { status: 502 });
    }
    return NextResponse.json({ ok: true, result: parsed });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
