// 푸시 발송 — push_send_log 의 pending 항목을 플랫폼별로 발송.
// ios → APN HTTPS API, android → FCM HTTP v1 (src/lib/fcm-send.ts).
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
//
// 환경변수 선택 (Android FCM — 미설정 시 android 토큰은 'FCM 미설정' 으로 skipped, 무해):
// - FIREBASE_SERVICE_ACCOUNT_JSON  Firebase 콘솔 서비스 계정 키 JSON 전체 문자열

import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isCronAuthenticated } from '@/lib/cron-auth';
import { sendFcm, isFcmConfigured } from '@/lib/fcm-send';

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
  attempts: number;
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

// APNs JWT 재사용 창 — Apple 은 키당 20분 1회 초과 갱신 시 429 TooManyProviderTokenUpdates.
// JWT 자체는 iat 후 60분 유효하므로 40분 재사용 + 잔여 20분 여유.
const APNS_JWT_REUSE_MS = 40 * 60 * 1000;

async function signApnsJwt(iat: number): Promise<string> {
  const keyPem = process.env.APN_KEY_P8;
  const keyId = process.env.APN_KEY_ID;
  const teamId = process.env.APN_TEAM_ID;
  if (!keyPem || !keyId || !teamId) {
    throw new Error('APN env missing');
  }
  const { SignJWT, importPKCS8 } = await import('jose');
  const privateKey = await importPKCS8(keyPem.replace(/\\n/g, '\n'), 'ES256');
  return new SignJWT({ iss: teamId, iat })
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .sign(privateKey);
}

// 2026-07 리뷰 Critical fix: cachedJwt 가 모듈 스코프뿐이라 Vercel 인스턴스 교체/cold start
// 마다 새 JWT 서명 → Apple 429 (최근 7일 푸시 68% 유실). push_runtime_config (단일행) 에
// JWT 를 공유해 서명 빈도를 키당 40분 1회로 제한. 경합 시 조건부 UPDATE 로 한 인스턴스만 승리.
async function getApnsToken(supabase: SupabaseClient): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  // 모듈 캐시: iat+50분 - 10분 여유 = iat 후 40분까지 재사용
  if (cachedJwt && cachedJwt.exp - now > 600) return cachedJwt.token;

  // 1) DB 공유 캐시 — 다른 인스턴스가 서명한 JWT 재사용
  const { data: cfg } = await supabase
    .from('push_runtime_config')
    .select('apns_jwt, apns_jwt_iat')
    .eq('id', 1)
    .maybeSingle();
  const iatMs = cfg?.apns_jwt_iat ? new Date(cfg.apns_jwt_iat as string).getTime() : 0;
  if (cfg?.apns_jwt && iatMs > 0 && Date.now() - iatMs < APNS_JWT_REUSE_MS) {
    cachedJwt = { token: cfg.apns_jwt as string, exp: Math.floor(iatMs / 1000) + 3000 };
    return cachedJwt.token;
  }

  // 2) 새로 서명 + 조건부 UPDATE — 40분 지난 경우에만 갱신. 경합에서 진 쪽은 DB 값 재조회.
  const jwt = await signApnsJwt(now);
  const cutoffIso = new Date(Date.now() - APNS_JWT_REUSE_MS).toISOString();
  const { data: won } = await supabase
    .from('push_runtime_config')
    .update({ apns_jwt: jwt, apns_jwt_iat: new Date().toISOString() })
    .eq('id', 1)
    .or(`apns_jwt_iat.is.null,apns_jwt_iat.lt.${cutoffIso}`)
    .select('id');
  if (won && won.length > 0) {
    cachedJwt = { token: jwt, exp: now + 3000 };
    return jwt;
  }

  // 경합 패배 — 다른 인스턴스가 방금 갱신한 JWT 사용
  const { data: cfg2 } = await supabase
    .from('push_runtime_config')
    .select('apns_jwt, apns_jwt_iat')
    .eq('id', 1)
    .maybeSingle();
  if (cfg2?.apns_jwt) {
    const iat2 = cfg2.apns_jwt_iat ? Math.floor(new Date(cfg2.apns_jwt_iat as string).getTime() / 1000) : now;
    cachedJwt = { token: cfg2.apns_jwt as string, exp: iat2 + 3000 };
    return cachedJwt.token;
  }

  // 시드 행 부재 등 예외 — 로컬 서명분으로 degrade (기존 동작)
  cachedJwt = { token: jwt, exp: now + 3000 };
  return jwt;
}

// build 273: APN HTTPS API 는 HTTP/2 강제. Vercel Node runtime 의 native fetch (undici 내장)
// 는 default 에서 HTTP/1.1 + ALPN h2 negotiation 안 함 → "fetch failed".
// undici Client 를 allowH2:true 로 명시 생성. 14일간 push 발사 0건 의 진짜 원인이었음.
let undiciClientProd: import('undici').Client | null = null;
let undiciClientDev: import('undici').Client | null = null;
async function getH2Client(host: string): Promise<import('undici').Client> {
  const { Client } = await import('undici');
  if (host === APN_HOST_PROD) {
    if (!undiciClientProd) undiciClientProd = new Client(`https://${host}`, { allowH2: true });
    return undiciClientProd;
  }
  if (!undiciClientDev) undiciClientDev = new Client(`https://${host}`, { allowH2: true });
  return undiciClientDev;
}

async function sendApn(supabase: SupabaseClient, deviceToken: string, payload: { title: string; body: string; data: Record<string, unknown>; badge: number }): Promise<{ ok: boolean; reason?: string }> {
  const bundleId = process.env.APN_BUNDLE_ID || 'com.routinist.app';
  const useSandbox = process.env.APN_USE_SANDBOX === 'true';
  const host = useSandbox ? APN_HOST_DEV : APN_HOST_PROD;

  const jwt = await getApnsToken(supabase);
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

  const client = await getH2Client(host);
  const { statusCode, body } = await client.request({
    path: `/3/device/${deviceToken}`,
    method: 'POST',
    headers: {
      authorization: `bearer ${jwt}`,
      'apns-topic': bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    },
    body: JSON.stringify(apnsPayload),
  });

  if (statusCode === 200) {
    // body 소비 (connection 재활용)
    await body.text();
    return { ok: true };
  }
  const text = await body.text();
  return { ok: false, reason: `${statusCode}: ${text.slice(0, 300)}` };
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

  // build 291: claim 방식으로 전환 — 이전엔 pending 을 SELECT 만 하고 발송해서,
  // APNs 지연으로 배치가 다음 cron (1분) 을 넘기거나 수동 GET 과 겹치면 같은 100건이
  // 두 invocation 에서 중복 발송됐다. UPDATE ... RETURNING 원자 선점으로 차단.
  // send_after (build 291, 사용자 로컬 저녁 창) 가 미래인 행은 아직 안 집는다.
  const nowIso = new Date().toISOString();

  // 죽은 배치 회수 — 이전 invocation 이 claim 후 크래시하면 'sending' 에 갇힘.
  // 정상 배치는 60초 내 끝나므로 10분 초과분만 pending 으로 복귀.
  const staleIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await supabase
    .from('push_send_log')
    .update({ status: 'pending', claimed_at: null })
    .eq('status', 'sending')
    .lt('claimed_at', staleIso);

  const { data: claimable, error: claimSelErr } = await supabase
    .from('push_send_log')
    .select('id')
    .eq('status', 'pending')
    .or(`send_after.is.null,send_after.lte.${nowIso}`)
    .order('created_at', { ascending: true })
    .limit(100);
  if (claimSelErr) {
    return NextResponse.json({ error: claimSelErr.message }, { status: 500 });
  }
  if (!claimable || claimable.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0, failed: 0 });
  }
  const { data: logs, error: logErr } = await supabase
    .from('push_send_log')
    .update({ status: 'sending', claimed_at: nowIso })
    .in('id', claimable.map(c => c.id))
    .eq('status', 'pending') // 동시 invocation 이 먼저 집어간 행은 제외 (원자성)
    .select('id, user_id, device_token_id, category, title, body, payload, status, attempts');
  if (logErr) {
    return NextResponse.json({ error: logErr.message }, { status: 500 });
  }
  if (!logs || logs.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0, failed: 0 });
  }

  // 사용자별 토큰을 한 번에 조회 (N+1 → 1)
  // Android Phase A②: ios 전용 필터 제거 — ios(APNs) + android(FCM) 라우팅. web 은 발송 경로 없음.
  const userIds = Array.from(new Set((logs as PushLogRow[]).map(l => l.user_id)));
  const { data: allTokens } = await supabase
    .from('push_device_tokens')
    .select('id, user_id, platform, token, enabled')
    .in('user_id', userIds)
    .eq('enabled', true)
    .in('platform', ['ios', 'android']);
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
  const fcmReady = isFcmConfigured();

  // 2026-07 리뷰 Critical fix: 429/5xx 는 일시 오류 — failed 확정 대신 +5분 재큐.
  // attempts 3 초과면 failed 확정 (무한 재큐 방어).
  const MAX_ATTEMPTS = 3;
  const RETRY_DELAY_MS = 5 * 60 * 1000;
  // APNs 429 TooManyProviderTokenUpdates 발생 시 true — 같은 JWT 로 계속 쏴봐야 전멸이므로
  // 배치를 중단하고 잔여분 전부 pending 복귀.
  let apnsExhausted = false;

  // reason 형식은 양쪽 다 `${status}: ${body}` — "FCM oauth 429: ..." 같은 prefix 도 매칭
  const isTransientReason = (r: string) =>
    /(^|\s)(429|5\d\d):/.test(r) || r.includes('TooManyProviderTokenUpdates');

  const requeueLog = async (log: PushLogRow, reason: string): Promise<'requeued' | 'failed'> => {
    if (log.attempts >= MAX_ATTEMPTS) {
      await supabase.from('push_send_log').update({
        status: 'failed', failure_reason: `재시도 ${MAX_ATTEMPTS}회 초과: ${reason}`.slice(0, 300),
      }).eq('id', log.id);
      return 'failed';
    }
    await supabase.from('push_send_log').update({
      status: 'pending',
      claimed_at: null,
      send_after: new Date(Date.now() + RETRY_DELAY_MS).toISOString(),
      attempts: log.attempts + 1,
    }).eq('id', log.id);
    return 'requeued';
  };

  const sendOne = async (log: PushLogRow): Promise<'sent' | 'skipped' | 'failed' | 'requeued'> => {
    const list = tokensByUser.get(log.user_id) ?? [];
    // FCM env 미설정이면 android 토큰은 발송 불가 — 기존처럼 skipped (안전 무해)
    const deliverable = fcmReady ? list : list.filter(t => t.platform === 'ios');
    if (deliverable.length === 0) {
      const reason = list.length > 0 ? 'FCM 미설정' : '활성 토큰 없음';
      await supabase.from('push_send_log').update({
        status: 'skipped', failure_reason: reason,
      }).eq('id', log.id);
      return 'skipped';
    }

    let anyOk = false;
    let lastReason = '';
    let anyTransient = false;
    const badge = Math.max(1, pushCountByUser.get(log.user_id) ?? 1);
    const sendResults = await Promise.allSettled(
      deliverable.map(t => {
        const send = t.platform === 'android'
          ? sendFcm(t.token, { title: log.title, body: log.body, data: log.payload })
          : sendApn(supabase, t.token, { title: log.title, body: log.body, data: log.payload, badge });
        return send
          .then(res => ({ tokenId: t.id, platform: t.platform, ...res }))
          .catch(e => ({ tokenId: t.id, platform: t.platform, ok: false as const, reason: e instanceof Error ? e.message : String(e) }));
      }),
    );
    for (const res of sendResults) {
      if (res.status !== 'fulfilled') continue;
      const v = res.value;
      if (v.ok) { anyOk = true; continue; }
      lastReason = v.reason ?? 'unknown';
      if (isTransientReason(lastReason)) {
        anyTransient = true;
        if (v.platform === 'ios' && (lastReason.includes('TooManyProviderTokenUpdates') || /^429:/.test(lastReason))) {
          apnsExhausted = true;
        }
        continue; // 일시 오류 — 토큰 비활성화 대상 아님
      }
      // 영구 무효 토큰 즉시 비활성화 — APNs: BadDeviceToken/Unregistered, FCM: 404 UNREGISTERED/NOT_FOUND
      if (
        lastReason.includes('BadDeviceToken') || lastReason.includes('Unregistered') ||
        lastReason.includes('UNREGISTERED') || lastReason.includes('NOT_FOUND')
      ) {
        await supabase.from('push_device_tokens').update({ enabled: false }).eq('id', v.tokenId);
      }
    }

    if (anyOk) {
      await supabase.from('push_send_log').update({
        status: 'sent', sent_at: new Date().toISOString(),
      }).eq('id', log.id);
      return 'sent';
    }
    if (anyTransient) {
      return requeueLog(log, lastReason);
    }
    await supabase.from('push_send_log').update({
      status: 'failed', failure_reason: lastReason,
    }).eq('id', log.id);
    return 'failed';
  };

  // 동시 8개 로그 처리 (직렬 보다 8x 빠름, APN connection limit 고려)
  let sent = 0, skipped = 0, failed = 0, requeued = 0;
  const CONCURRENCY = 8;
  const queue = (logs as PushLogRow[]).slice();
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (true) {
      if (apnsExhausted) break; // JWT 갱신 제한 — 배치 중단, 잔여분은 아래서 일괄 재큐
      const next = queue.shift();
      if (!next) break;
      const r = await sendOne(next);
      if (r === 'sent') sent++;
      else if (r === 'skipped') skipped++;
      else if (r === 'requeued') requeued++;
      else failed++;
    }
  });
  await Promise.all(workers);

  // APNs 429 로 중단된 경우 — 미처리 잔여분 (status='sending' 갇힘) 전부 pending 복귀.
  // attempts 그룹별 일괄 UPDATE (보통 전원 0 → 1 쿼리). 3 초과분은 failed 확정.
  if (apnsExhausted && queue.length > 0) {
    const remaining = queue.splice(0);
    const retryAfterIso = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
    const byAttempts = new Map<number, string[]>();
    const exceededIds: string[] = [];
    for (const l of remaining) {
      if (l.attempts >= MAX_ATTEMPTS) { exceededIds.push(l.id); continue; }
      if (!byAttempts.has(l.attempts)) byAttempts.set(l.attempts, []);
      byAttempts.get(l.attempts)!.push(l.id);
    }
    for (const [att, ids] of byAttempts) {
      await supabase.from('push_send_log').update({
        status: 'pending', claimed_at: null, send_after: retryAfterIso, attempts: att + 1,
      }).in('id', ids);
      requeued += ids.length;
    }
    if (exceededIds.length > 0) {
      await supabase.from('push_send_log').update({
        status: 'failed', failure_reason: `재시도 ${MAX_ATTEMPTS}회 초과: APNs 429 배치 중단`,
      }).in('id', exceededIds);
      failed += exceededIds.length;
    }
  }

  return NextResponse.json({ ok: true, sent, skipped, failed, requeued, apnsExhausted, total: logs.length });
}

// GET — 헬스체크 + 운영자 수동 트리거 (?token=xxx)
export async function GET(req: NextRequest) {
  return POST(req);
}
