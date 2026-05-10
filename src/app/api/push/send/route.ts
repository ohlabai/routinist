// 푸시 발송 — push_send_log 의 pending 항목을 APN HTTPS API 로 발송.
//
// 호출 방법:
// - Vercel Cron 1분 간격 (vercel.json 의 crons 설정 — 별도 추가 필요)
// - 어드민 수동 트리거 (관리자 페이지의 "발송" 버튼)
// - 트리거가 직접 ping 하면 즉시 발송 (선택)
//
// 보안: PUSH_CRON_SECRET 환경변수 검증 (Vercel Cron 의 Authorization 헤더 또는 query)
//
// 환경변수 필수:
// - APN_KEY_P8        Apple Developer Console 에서 발급 .p8 파일 내용 (BEGIN PRIVATE KEY...)
// - APN_KEY_ID        해당 키의 Key ID (10자)
// - APN_TEAM_ID       Apple Developer Team ID (10자)
// - APN_BUNDLE_ID     com.routinist.app
// - APN_USE_SANDBOX   'true' 면 development server 사용 (TestFlight 외 Xcode debug 빌드)
// - SUPABASE_SERVICE_ROLE_KEY
// - PUSH_CRON_SECRET  cron/manual 호출 인증 시크릿

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// jose 는 dynamic import — Capacitor 정적 export 빌드 시 module-level eval 회피

interface PushLogRow {
  id: string;
  user_id: string;
  device_token_id: string | null;
  category: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  status: string;
}

interface DeviceTokenRow {
  id: string;
  user_id: string;
  platform: 'ios' | 'android' | 'web';
  token: string;
  enabled: boolean;
}

const APN_HOST_PROD = 'api.push.apple.com';
const APN_HOST_DEV = 'api.sandbox.push.apple.com';

let cachedJwt: { token: string; exp: number } | null = null;

async function getApnsToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  // 50분 이하 유지 (Apple 권고: 1시간 이내, 초과 시 reject)
  if (cachedJwt && cachedJwt.exp - now > 600) return cachedJwt.token;

  const keyPem = process.env.APN_KEY_P8;
  const keyId = process.env.APN_KEY_ID;
  const teamId = process.env.APN_TEAM_ID;
  if (!keyPem || !keyId || !teamId) {
    throw new Error('APN env missing');
  }
  const { SignJWT, importPKCS8 } = await import('jose');
  const privateKey = await importPKCS8(keyPem.replace(/\\n/g, '\n'), 'ES256');

  const exp = now + 3000;  // 50분
  const jwt = await new SignJWT({ iss: teamId, iat: now })
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .sign(privateKey);

  cachedJwt = { token: jwt, exp };
  return jwt;
}

async function sendApn(deviceToken: string, payload: { title: string; body: string; data: Record<string, unknown> }): Promise<{ ok: boolean; reason?: string }> {
  const bundleId = process.env.APN_BUNDLE_ID || 'com.routinist.app';
  const useSandbox = process.env.APN_USE_SANDBOX === 'true';
  const host = useSandbox ? APN_HOST_DEV : APN_HOST_PROD;

  const jwt = await getApnsToken();
  const apnsPayload = {
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: 'default',
      badge: 1,
      'mutable-content': 1,
    },
    // 커스텀 — deep_link 등
    ...payload.data,
  };

  const r = await fetch(`https://${host}/3/device/${deviceToken}`, {
    method: 'POST',
    headers: {
      'authorization': `bearer ${jwt}`,
      'apns-topic': bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    },
    body: JSON.stringify(apnsPayload),
  });

  if (r.status === 200) return { ok: true };
  const text = await r.text();
  return { ok: false, reason: `${r.status}: ${text.slice(0, 300)}` };
}

export async function POST(req: NextRequest) {
  // 인증 — Vercel Cron 은 Authorization: Bearer <CRON_SECRET> 헤더 사용
  const auth = req.headers.get('authorization') ?? '';
  const cronSecret = process.env.PUSH_CRON_SECRET;
  const queryToken = req.nextUrl.searchParams.get('token');
  const ok = (cronSecret && auth === `Bearer ${cronSecret}`) ||
             (cronSecret && queryToken === cronSecret);
  if (!ok) {
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

  // pending log 100건 가져옴
  const { data: logs, error: logErr } = await supabase
    .from('push_send_log')
    .select('id, user_id, device_token_id, category, title, body, payload, status')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(100);
  if (logErr) {
    return NextResponse.json({ error: logErr.message }, { status: 500 });
  }
  if (!logs || logs.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0, failed: 0 });
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const log of logs as PushLogRow[]) {
    // 사용자의 활성 iOS 토큰 모두 가져옴
    const { data: tokens } = await supabase
      .from('push_device_tokens')
      .select('id, user_id, platform, token, enabled')
      .eq('user_id', log.user_id)
      .eq('enabled', true)
      .eq('platform', 'ios');

    const list = (tokens ?? []) as DeviceTokenRow[];
    if (list.length === 0) {
      await supabase.from('push_send_log').update({
        status: 'skipped', failure_reason: '활성 토큰 없음',
      }).eq('id', log.id);
      skipped++;
      continue;
    }

    let anyOk = false;
    let lastReason = '';
    for (const t of list) {
      try {
        const res = await sendApn(t.token, { title: log.title, body: log.body, data: log.payload });
        if (res.ok) {
          anyOk = true;
        } else {
          lastReason = res.reason ?? 'unknown';
          // BadDeviceToken / Unregistered → 토큰 비활성화
          if (lastReason.includes('BadDeviceToken') || lastReason.includes('Unregistered')) {
            await supabase.from('push_device_tokens').update({ enabled: false }).eq('id', t.id);
          }
        }
      } catch (e) {
        lastReason = e instanceof Error ? e.message : String(e);
      }
    }

    if (anyOk) {
      await supabase.from('push_send_log').update({
        status: 'sent', sent_at: new Date().toISOString(),
      }).eq('id', log.id);
      sent++;
    } else {
      await supabase.from('push_send_log').update({
        status: 'failed', failure_reason: lastReason,
      }).eq('id', log.id);
      failed++;
    }
  }

  return NextResponse.json({ ok: true, sent, skipped, failed, total: logs.length });
}

// GET — 헬스체크 + 운영자 수동 트리거 (?token=xxx)
export async function GET(req: NextRequest) {
  return POST(req);
}
