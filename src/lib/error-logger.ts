// 클라이언트 에러 로거 — Supabase client_error_logs 테이블에 비동기 fire-and-forget 로 기록.
// Sentry 대용. 무한 보관, 무료, SQL 로 직접 조회 가능.
//
// 사용:
//   import { logClientError, logClientWarn, logClientInfo } from '@/lib/error-logger';
//   logClientError('health-sync', 'queryWorkouts 실패', { workoutType: 'running', err: String(e) });
//
// 절대 throw 하지 않음. 로깅 자체가 실패해도 호출자 흐름 막지 않음.

import { getSupabase } from './supabase';

type LogLevel = 'error' | 'warn' | 'info';

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev';

// 같은 메시지가 짧은 시간에 폭주하면 DB 부담 → 1초당 같은 (scope+message) 1건 제한
const dedupCache = new Map<string, number>();
const DEDUP_WINDOW_MS = 1000;

function getPlatform(): string {
  if (typeof window === 'undefined') return 'server';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cap = (window as any).Capacitor;
  return cap?.getPlatform?.() ?? 'web';
}

function getUserAgent(): string {
  return typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : '';
}

async function logToServer(level: LogLevel, scope: string, message: string, details?: Record<string, unknown>): Promise<void> {
  // 클라이언트 측에서도 한 번 콘솔로
  const consoleMethod = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  consoleMethod(`[${scope}] ${message}`, details ?? '');

  // Dedup
  const key = `${scope}|${message}`;
  const now = Date.now();
  const last = dedupCache.get(key);
  if (last && now - last < DEDUP_WINDOW_MS) return;
  dedupCache.set(key, now);
  // 캐시 사이즈 제한
  if (dedupCache.size > 100) {
    const firstKey = dedupCache.keys().next().value;
    if (firstKey) dedupCache.delete(firstKey);
  }

  try {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();

    // details 안에 Error 객체 있으면 직렬화. 너무 큰 객체 truncate.
    const safeDetails = details ? sanitizeDetails(details) : null;

    await supabase.from('client_error_logs').insert({
      user_id: user?.id ?? null,
      scope,
      level,
      message: message.slice(0, 1000),
      details: safeDetails,
      platform: getPlatform(),
      app_version: APP_VERSION,
      user_agent: getUserAgent(),
    });
  } catch {
    // 로깅 자체가 실패해도 무시 (콘솔엔 이미 찍힘)
  }
}

function sanitizeDetails(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v instanceof Error) {
      out[k] = { name: v.name, message: v.message, stack: v.stack?.slice(0, 1000) };
    } else if (typeof v === 'string' && v.length > 1000) {
      out[k] = v.slice(0, 1000) + '... [truncated]';
    } else if (v === undefined || v === null) {
      out[k] = v;
    } else if (typeof v === 'object') {
      try {
        const json = JSON.stringify(v);
        out[k] = json.length > 2000 ? json.slice(0, 2000) + '... [truncated]' : v;
      } catch {
        out[k] = '[unserializable]';
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function logClientError(scope: string, message: string, details?: Record<string, unknown>): void {
  void logToServer('error', scope, message, details);
}

export function logClientWarn(scope: string, message: string, details?: Record<string, unknown>): void {
  void logToServer('warn', scope, message, details);
}

export function logClientInfo(scope: string, message: string, details?: Record<string, unknown>): void {
  void logToServer('info', scope, message, details);
}
