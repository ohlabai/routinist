// 임시 디버그 — 운영 환경의 env var 가 정상 inject 됐는지 검증.
// 보안: PUSH_CRON_SECRET 으로만 접근.

import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  const cron = process.env.PUSH_CRON_SECRET;
  if (!cron || auth !== `Bearer ${cron}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const keys = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'CAFE24_CLIENT_ID',
    'CAFE24_CLIENT_SECRET',
    'CAFE24_MALL_ID',
    'APN_KEY_ID',
    'APN_TEAM_ID',
    'APN_BUNDLE_ID',
    'APN_USE_SANDBOX',
    'APN_KEY_P8',
    'PUSH_CRON_SECRET',
  ];
  const out: Record<string, { len: number; first10?: string; last10?: string; firstChar?: string; defined: boolean }> = {};
  for (const k of keys) {
    const v = process.env[k];
    if (!v) { out[k] = { len: 0, defined: false }; continue; }
    out[k] = {
      defined: true,
      len: v.length,
      first10: v.slice(0, 10),
      last10: v.slice(-10),
      firstChar: v.charCodeAt(0).toString(16),
    };
  }
  return NextResponse.json(out);
}
