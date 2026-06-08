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

// build 272: Vercel Cron 의 자동 발사 header (Bearer ${CRON_SECRET}) 도 fallback 인식.
// Vercel Cron 은 매 호출마다 `Authorization: Bearer ${env.CRON_SECRET}` 자동 첨부.
// 호출 코드의 명시적 secret env (예: PUSH_CRON_SECRET) 가 비어있거나 mismatch 면
// CRON_SECRET 으로도 통과 → cron 무력화 (401) 회로 차단.
//
// hans 2026-06-09 진단: PUSH_CRON_SECRET 가 빈 문자열로 설정돼 14일간 push 발사 0건.
export function isCronAuthenticated(req: NextRequest, ...secretEnvNames: string[]): boolean {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return false;
  const provided = auth.slice('Bearer '.length).trim();
  if (!provided) return false;
  // 명시적 secret + Vercel default CRON_SECRET 둘 다 체크
  const candidates = [...secretEnvNames, 'CRON_SECRET'];
  for (const envName of candidates) {
    const expected = process.env[envName];
    if (expected && expected.length > 0 && safeEqual(provided, expected)) return true;
  }
  return false;
}
