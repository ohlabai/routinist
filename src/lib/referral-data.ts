// 친구 초대 (referral) 데이터 레이어 — build 292 성장 루프.
//
// RPC 계약 (SQL 은 별도 마이그레이션):
//   - get_my_referral_code() → text (6자 코드, 없으면 생성 후 반환)
//   - claim_referral_code(p_code text) → { ok: boolean, reason?: 'invalid_code'|'self'|'already_claimed'|'too_old' }
//
// RPC 가 아직 prod 에 없을 수 있음 — 자동 흐름(pending claim)은 조용히 실패,
// 명시적 액션(코드 입력 폼)에서만 에러를 사용자에게 노출.

import { getSupabase } from '@/lib/supabase';
import { ttl } from '@/lib/i18n';

/** /login?ref= 또는 routinist://invite?code= 로 들어온 코드를 로그인 후 claim 하기 위한 localStorage 키 */
export const PENDING_REF_KEY = 'routinist_pending_ref';

const INVITE_BASE_URL = 'https://app.routinist.kr/invite';
const CODE_CACHE_PREFIX = 'routinist_referral_code:';

export function buildInviteUrl(code: string): string {
  return `${INVITE_BASE_URL}?code=${encodeURIComponent(code)}`;
}

export type ClaimReason = 'invalid_code' | 'self' | 'already_claimed' | 'too_old';
export interface ClaimResult {
  ok: boolean;
  reason?: ClaimReason;
}

/** 내 초대 코드 — localStorage 캐시 우선, 없으면 RPC (없으면 서버가 생성). 실패 시 null (조용히). */
export async function getMyReferralCode(userId: string): Promise<string | null> {
  const key = `${CODE_CACHE_PREFIX}${userId}`;
  try {
    const cached = window.localStorage.getItem(key);
    if (cached) return cached;
  } catch { /* localStorage 불가 환경 — RPC 로 진행 */ }
  try {
    const { data, error } = await getSupabase().rpc('get_my_referral_code');
    if (error || typeof data !== 'string' || !data) return null;
    try { window.localStorage.setItem(key, data); } catch {}
    return data;
  } catch {
    return null;
  }
}

/** 초대 코드 등록. 네트워크/RPC 자체 실패는 throw — 호출부에서 노출 여부 결정. */
export async function claimReferralCode(code: string): Promise<ClaimResult> {
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) return { ok: false, reason: 'invalid_code' };
  const { data, error } = await getSupabase().rpc('claim_referral_code', { p_code: trimmed });
  if (error) throw error;
  const r = data as ClaimResult | null;
  if (!r || typeof r.ok !== 'boolean') return { ok: false, reason: 'invalid_code' };
  return r;
}

export function storePendingReferral(code: string) {
  try {
    const trimmed = code.trim().toUpperCase();
    if (trimmed) window.localStorage.setItem(PENDING_REF_KEY, trimmed);
  } catch { /* private 모드 등 — 저장 못 하면 자동 claim 도 없음 */ }
}

/**
 * pending 코드 1회 자동 claim — 결과와 무관하게 키는 즉시 삭제 (재시도 없음).
 * 성공 시 true. 실패/키 없음/RPC 미배포는 조용히 false.
 */
export async function claimPendingReferral(): Promise<boolean> {
  let code: string | null = null;
  try {
    code = window.localStorage.getItem(PENDING_REF_KEY);
    if (code) window.localStorage.removeItem(PENDING_REF_KEY);
  } catch { return false; }
  if (!code) return false;
  try {
    const r = await claimReferralCode(code);
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * 친구 초대 공유 시트 열기 (build 293) — InviteFriendCard 의 공유 로직을 재사용 가능하게 추출.
 * 코드 조회(getMyReferralCode) → Capacitor Share / navigator.share / clipboard 순 폴백.
 * 반환: 'shared' 공유 시트 완료, 'copied' 클립보드 복사 폴백, 'dismissed' 실패·시트 닫음 (조용히 처리 권장).
 */
export async function shareInvite(userId: string, locale: string): Promise<'shared' | 'copied' | 'dismissed'> {
  const code = await getMyReferralCode(userId);
  if (!code) return 'dismissed';
  const inviteUrl = buildInviteUrl(code);
  const text = locale === 'en'
    ? `Run with me on Routinist! 🏃 Sign up with my code ${code} and we both get 100P`
    : `Routinist 에서 같이 달려요! 🏃 내 코드 ${code} 로 가입하면 서로 100P 를 받아요`;
  const title = locale === 'en' ? 'Routinist invite' : 'Routinist 친구 초대';
  try {
    const { isNativeApp } = await import('@/lib/health-sync');
    if (isNativeApp()) {
      const { Share } = await import('@capacitor/share');
      await Share.share({ title, text, url: inviteUrl });
      return 'shared';
    }
    if (navigator.share) {
      await navigator.share({ title, text, url: inviteUrl });
      return 'shared';
    }
    await navigator.clipboard.writeText(`${text}\n${inviteUrl}`);
    return 'copied';
  } catch {
    // 사용자가 공유 시트를 닫음 / clipboard 권한 없음 — 조용히
    return 'dismissed';
  }
}

/** claim 실패 reason → 친근한 안내 문구 */
export function claimReasonMessage(reason?: ClaimReason): string {
  switch (reason) {
    case 'self':
      return ttl('내 코드는 입력할 수 없어요 😅');
    case 'already_claimed':
      return ttl('이미 초대 코드를 등록했어요');
    case 'too_old':
      return ttl('초대 코드는 가입 직후에만 입력할 수 있어요');
    case 'invalid_code':
    default:
      return ttl('코드를 찾지 못했어요. 다시 확인해주세요');
  }
}

/** claim 성공 공통 토스트 문구 */
export function claimSuccessMessage(): string {
  return ttl('100P 적립! 🎉 친구와 함께 달려봐요');
}
