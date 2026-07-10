// FCM HTTP v1 발송 — Firebase Admin SDK 없이 google-auth 직접 구현 (의존성 최소화).
//
// 인증 흐름:
//   1. env FIREBASE_SERVICE_ACCOUNT_JSON (Firebase 콘솔 서비스 계정 키 JSON 전체 문자열)
//      에서 project_id / client_email / private_key 파싱
//   2. RS256 self-signed JWT (node 'crypto') → https://oauth2.googleapis.com/token
//      에서 OAuth2 access token 교환 (scope: firebase.messaging)
//   3. https://fcm.googleapis.com/v1/projects/{project_id}/messages:send 로 발송
//
// 토큰 캐시는 APNs JWT 와 동일하게 모듈 레벨 50분 유지.
// env 미설정 시 isFcmConfigured() === false — 발송기가 android 토큰을 skipped 처리.

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

// undefined = 아직 파싱 안 함, null = env 미설정/파싱 실패
let cachedServiceAccount: ServiceAccount | null | undefined;

function getServiceAccount(): ServiceAccount | null {
  if (cachedServiceAccount !== undefined) return cachedServiceAccount;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    cachedServiceAccount = null;
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (parsed.project_id && parsed.client_email && parsed.private_key) {
      cachedServiceAccount = {
        project_id: parsed.project_id,
        client_email: parsed.client_email,
        // Vercel env 에 붙여넣으면 개행이 \\n 리터럴로 들어오는 경우 대응 (APN_KEY_P8 과 동일 처리)
        private_key: parsed.private_key.replace(/\\n/g, '\n'),
      };
    } else {
      console.warn('[fcm] FIREBASE_SERVICE_ACCOUNT_JSON 에 project_id/client_email/private_key 누락');
      cachedServiceAccount = null;
    }
  } catch (e) {
    console.warn('[fcm] FIREBASE_SERVICE_ACCOUNT_JSON 파싱 실패', e);
    cachedServiceAccount = null;
  }
  return cachedServiceAccount;
}

export function isFcmConfigured(): boolean {
  return getServiceAccount() !== null;
}

let cachedAccessToken: { token: string; exp: number } | null = null;

async function getFcmAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  // APNs JWT 캐시와 같은 정책: 만료 10분 전까지 재사용
  if (cachedAccessToken && cachedAccessToken.exp - now > 600) return cachedAccessToken.token;

  const sa = getServiceAccount();
  if (!sa) throw new Error('FCM env missing (FIREBASE_SERVICE_ACCOUNT_JSON)');

  // node 'crypto' 로 RS256 서명 (Capacitor 정적 export 빌드 시 module-level eval 회피 — dynamic import)
  const { createSign } = await import('crypto');
  const b64url = (s: string) => Buffer.from(s).toString('base64url');
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${claims}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(sa.private_key).toString('base64url');
  const assertion = `${signingInput}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FCM oauth ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = await res.json() as { access_token: string; expires_in?: number };

  // Google 토큰 수명은 보통 1시간 — 50분으로 clamp
  const ttl = Math.min(json.expires_in ?? 3600, 3000);
  cachedAccessToken = { token: json.access_token, exp: now + ttl };
  return json.access_token;
}

// FCM data 예약 키 — 넣으면 400 INVALID_ARGUMENT
const RESERVED_DATA_KEYS = new Set(['from', 'notification', 'message_type', 'collapse_key']);

function toFcmData(payload: Record<string, unknown>): Record<string, string> {
  // FCM data 는 string 값만 허용 — 문자열화
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(payload ?? {})) {
    if (v === undefined || v === null) continue;
    if (RESERVED_DATA_KEYS.has(k) || k.startsWith('google.') || k.startsWith('gcm.')) continue;
    data[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return data;
}

/**
 * FCM v1 단건 발송. 실패 시 { ok: false, reason } — reason 에 'UNREGISTERED' / 'NOT_FOUND'
 * 가 포함되면 토큰이 영구 무효 (앱 삭제 등) 이므로 호출부에서 비활성화할 것.
 */
export async function sendFcm(
  deviceToken: string,
  payload: { title: string; body: string; data: Record<string, unknown> },
): Promise<{ ok: boolean; reason?: string }> {
  const sa = getServiceAccount();
  if (!sa) return { ok: false, reason: 'FCM 미설정' };

  const accessToken = await getFcmAccessToken();
  const message = {
    message: {
      token: deviceToken,
      notification: { title: payload.title, body: payload.body },
      data: toFcmData(payload.data),
      android: {
        priority: 'high' as const,
        notification: {
          // 클라 push-notifications.ts 가 Android 에서 생성하는 기본 채널과 짝
          channel_id: 'default',
          default_sound: true,
          default_vibrate_timings: true,
        },
      },
    },
  };

  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(message),
  });

  if (res.ok) return { ok: true };
  const text = await res.text();
  // 404 NOT_FOUND / errorCode UNREGISTERED = 무효 토큰 (APNs 의 Unregistered 대응)
  return { ok: false, reason: `${res.status}: ${text.slice(0, 300)}` };
}
