// 스트릭 보호권 (습관 형성 — Duolingo Streak Freeze 계열).
// RPC 계약:
//  - get_my_streak_freezes() → { count, uses: ['YYYY-MM-DD', ...] } (uses = 최근 60일 보호권 사용일.
//    이 호출이 lazy 충전도 겸함 — 홈 진입 시 1회 호출로 충분)
//  - use_streak_freeze(p_date) → { ok, remaining?, reason? }
// SQL 미배포 시 조용히 실패해야 함 — 실패는 항상 "보호권 없음/빈 사용일" fallback 으로 수렴,
// 호출부는 기존 스트릭 동작 그대로 유지된다.

import { getSupabase } from './supabase';

export interface StreakFreezeState {
  count: number;
  /** 최근 60일 보호권 사용일 ('YYYY-MM-DD'). getStreak/getMaxStreak 에 그대로 전달. */
  uses: Set<string>;
}

const EMPTY: StreakFreezeState = { count: 0, uses: new Set() };

export async function fetchStreakFreezes(): Promise<StreakFreezeState> {
  try {
    // build 56 룰: supabase call 은 timeout 안전망 — hang 시 빈 값 fallback (스트릭은 기존대로 계산됨)
    const rpc = getSupabase().rpc('get_my_streak_freezes');
    const res = await Promise.race([
      rpc,
      new Promise<{ data: null; error: { message: string } }>((resolve) =>
        setTimeout(() => resolve({ data: null, error: { message: 'streak freeze fetch 4s timeout' } }), 4000)
      ),
    ]);
    if (res.error || !res.data) return EMPTY;
    const d = res.data as { count?: number; uses?: string[] };
    return {
      count: Number(d.count ?? 0),
      uses: new Set(Array.isArray(d.uses) ? d.uses : []),
    };
  } catch {
    return EMPTY; // RPC 미배포/네트워크 — 조용히 기존 동작
  }
}

export interface UseFreezeResult {
  ok: boolean;
  remaining?: number;
  reason?: 'already_covered' | 'no_freezes' | 'invalid_date' | 'rpc_failed';
}

// 이름이 use* 면 react-hooks/rules-of-hooks 가 훅으로 오인 — spend* 로 명명 (RPC 는 use_streak_freeze)
export async function spendStreakFreeze(date: string): Promise<UseFreezeResult> {
  try {
    const { data, error } = await getSupabase().rpc('use_streak_freeze', { p_date: date });
    if (error || !data) return { ok: false, reason: 'rpc_failed' };
    // build 299 C2: RPC 는 실패 사유를 `error` 키로 반환 — `reason` 으로 매핑해야
    // StreakWarningCard 의 already_covered/no_freezes 분기가 실제로 동작함.
    const d = data as { ok: boolean; remaining?: number; error?: string };
    return { ok: d.ok, remaining: d.remaining, reason: d.error as UseFreezeResult['reason'] };
  } catch {
    return { ok: false, reason: 'rpc_failed' };
  }
}

// build 299: 보호권 추가 구매 (100P). 월 1개 무료 충전은 그대로, 보유 상한 2개.
export interface BuyFreezeResult {
  ok: boolean;
  count?: number;
  balance?: number;
  error?: 'max_held' | 'insufficient_balance' | 'not_authenticated' | 'profile_not_found' | 'rpc_failed';
}

export async function buyStreakFreeze(): Promise<BuyFreezeResult> {
  try {
    const { data, error } = await getSupabase().rpc('buy_streak_freeze');
    if (error || !data) return { ok: false, error: 'rpc_failed' };
    return data as BuyFreezeResult;
  } catch {
    return { ok: false, error: 'rpc_failed' };
  }
}
