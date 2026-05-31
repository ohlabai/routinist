// build 237: cron route 공통 인증 헬퍼.
// - timingSafeEqual 로 비교 (string === 회피)
// - Authorization header 만 허용 (query token 은 access log/referer 누출 위험)

import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export function isCronAuthenticated(req: NextRequest, ...secretEnvNames: string[]): boolean {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return false;
  const provided = auth.slice('Bearer '.length).trim();
  if (!provided) return false;
  for (const envName of secretEnvNames) {
    const expected = process.env[envName];
    if (expected && safeEqual(provided, expected)) return true;
  }
  return false;
}
