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
import { isCronAuthenticated } from '@/lib/cron-auth';

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

async function sendApn(deviceToken: string, payload: { title: string; body: string; data: Record<string, unknown>; badge: number }): Promise<{ ok: boolean; reason?: string }> {
  const bundleId = process.env.APN_BUNDLE_ID || 'com.routinist.app';
  const useSandbox = process.env.APN_USE_SANDBOX === 'true';
  const host = useSandbox ? APN_HOST_DEV : APN_HOST_PROD;

  const jwt = await getApnsToken();
  const apnsPayload = {
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: 'default',
      badge: payload.badge,
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
  // build 237: timing-safe Bearer 비교 + query token fallback 제거 (access log/referer 누출 위험).
  if (!isCronAuthenticated(req, 'PUSH_CRON_SECRET')) {
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

  // 사용자별 토큰을 한 번에 조회 (N+1 → 1)
  const userIds = Array.from(new Set((logs as PushLogRow[]).map(l => l.user_id)));
  const { data: allTokens } = await supabase
    .from('push_device_tokens')
    .select('id, user_id, platform, token, enabled')
    .in('user_id', userIds)
    .eq('enabled', true)
    .eq('platform', 'ios');
  const tokensByUser = new Map<string, DeviceTokenRow[]>();
  for (const t of (allTokens ?? []) as DeviceTokenRow[]) {
    if (!tokensByUser.has(t.user_id)) tokensByUser.set(t.user_id, []);
    tokensByUser.get(t.user_id)!.push(t);
  }

  // build 224: 동적 뱃지 카운트 — 사용자별 이 배치에 들어온 push 개수를 badge 로.
  // 모든 push 가 같은 badge 값을 받아도 iOS 는 가장 최근 도착한 값을 표시하므로 (count_in_batch)
  // 가 사용자의 unread 수와 거의 같음. 앱 포어그라운드 진입 시 clearAppBadge 가 0 으로 리셋.
  const pushCountByUser = new Map<string, number>();
  for (const l of logs as PushLogRow[]) {
    pushCountByUser.set(l.user_id, (pushCountByUser.get(l.user_id) ?? 0) + 1);
  }

  // 토큰별 연속 실패 카운터 (3회 이상 시 비활성화) — 메모리 캐시는 의미 없음 (cron 사이 휘발).
  // 대신 BadDeviceToken / Unregistered (영구 invalid) 만 즉시 비활성화. 일시 fail 은 그대로.
  // 영구 invalid 외 3회 누적 fail 은 push_device_tokens.metadata 에 카운터 (별도 컬럼 없으면 enabled 그대로).
  const sendOne = async (log: PushLogRow): Promise<'sent' | 'skipped' | 'failed'> => {
    const list = tokensByUser.get(log.user_id) ?? [];
    if (list.length === 0) {
      await supabase.from('push_send_log').update({
        status: 'skipped', failure_reason: '활성 토큰 없음',
      }).eq('id', log.id);
      return 'skipped';
    }

    let anyOk = false;
    let lastReason = '';
    const badge = Math.max(1, pushCountByUser.get(log.user_id) ?? 1);
    const apnResults = await Promise.allSettled(
      list.map(t => sendApn(t.token, { title: log.title, body: log.body, data: log.payload, badge })
        .then(res => ({ tokenId: t.id, ...res }))
        .catch(e => ({ tokenId: t.id, ok: false as const, reason: e instanceof Error ? e.message : String(e) }))),
    );
    for (const res of apnResults) {
      if (res.status !== 'fulfilled') continue;
      const v = res.value;
      if (v.ok) { anyOk = true; continue; }
      lastReason = v.reason ?? 'unknown';
      if (lastReason.includes('BadDeviceToken') || lastReason.includes('Unregistered')) {
        await supabase.from('push_device_tokens').update({ enabled: false }).eq('id', v.tokenId);
      }
    }

    if (anyOk) {
      await supabase.from('push_send_log').update({
        status: 'sent', sent_at: new Date().toISOString(),
      }).eq('id', log.id);
      return 'sent';
    } else {
      await supabase.from('push_send_log').update({
        status: 'failed', failure_reason: lastReason,
      }).eq('id', log.id);
      return 'failed';
    }
  };

  // 동시 8개 로그 처리 (직렬 보다 8x 빠름, APN connection limit 고려)
  let sent = 0, skipped = 0, failed = 0;
  const CONCURRENCY = 8;
  const queue = (logs as PushLogRow[]).slice();
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (true) {
      const next = queue.shift();
      if (!next) break;
      const r = await sendOne(next);
      if (r === 'sent') sent++;
      else if (r === 'skipped') skipped++;
      else failed++;
    }
  });
  await Promise.all(workers);

  return NextResponse.json({ ok: true, sent, skipped, failed, total: logs.length });
}

// GET — 헬스체크 + 운영자 수동 트리거 (?token=xxx)
export async function GET(req: NextRequest) {
  return POST(req);
}
