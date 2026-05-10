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

  // Dedup — 같은 key 가 들어오면 timestamp 만 갱신하면 FIFO 가 hot-key 를 못 쫓아내는 버그
  // 해결: delete 후 set 으로 insertion order 재정렬.
  const key = `${scope}|${message}`;
  const now = Date.now();
  const last = dedupCache.get(key);
  if (last && now - last < DEDUP_WINDOW_MS) return;
  dedupCache.delete(key);
  dedupCache.set(key, now);
  if (dedupCache.size > 100) {
    const firstKey = dedupCache.keys().next().value;
    if (firstKey) dedupCache.delete(firstKey);
  }

  try {
    const supabase = getSupabase();
    // getUser() 는 토큰 만료 시 /user 네트워크 호출 + 내부 refresh 시도 → hang 위험.
    // getSession() 은 캐시된 세션만 반환 (네트워크 X). user 가 null 이어도 익명 로그로 남음.
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id ?? null;

    // details 안에 Error 객체 있으면 직렬화. 너무 큰 객체 truncate.
    const safeDetails = details ? sanitizeDetails(details) : null;

    // insert 자체에 5초 timeout — 네트워크 끊긴 상태에서 promise 누적 방지.
    await Promise.race([
      supabase.from('client_error_logs').insert({
        user_id: userId,
        scope,
        level,
        message: message.slice(0, 1000),
        details: safeDetails,
        platform: getPlatform(),
        app_version: APP_VERSION,
        user_agent: getUserAgent(),
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('log timeout')), 5000)),
    ]);
  } catch {
    // 로깅 자체가 실패해도 무시 (콘솔엔 이미 찍힘). 재귀 호출 절대 금지.
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
