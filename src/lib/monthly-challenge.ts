// 월드런 기본 챌린지 (매달 42.195km / 100P) — RPC wrapper.
// 월드투어(world-data.ts)와 분리된 독립 서브시스템. 매월 KST 달력월 기준 리셋.

import { getSupabase } from './supabase';

export interface MonthlyChallenge {
  period_ym: string;          // 'YYYY-MM' (KST)
  joined: boolean;
  entry_fee: number;          // 참가비 (P)
  target_km: number;          // 42.195
  progress_km: number;        // 이번 달 러닝 누적
  completed_at: string | null;
  days_left: number;          // 이번 달 남은 일수
}

export async function fetchMonthlyChallenge(): Promise<MonthlyChallenge | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('fetch_monthly_challenge');
  if (error) {
    console.warn('[monthly-challenge] fetch fail', error);
    return null;
  }
  if (!data) return null;
  const d = data as Record<string, unknown>;
  const result = {
    period_ym: String(d.period_ym ?? ''),
    joined: Boolean(d.joined),
    entry_fee: Number(d.entry_fee ?? 100),
    target_km: Number(d.target_km ?? 42.195),
    progress_km: Number(d.progress_km ?? 0),
    completed_at: (d.completed_at as string) ?? null,
    days_left: Number(d.days_left ?? 0),
  };
  // watch v9: 워치 시작 화면의 이달 챌린지 칩 데이터 (fire-and-forget)
  void import('./watch-bridge').then(m =>
    m.setWatchContext({ challengeProgressKm: result.progress_km, challengeTargetKm: result.target_km })
  ).catch(() => {});
  return result;
}

export interface JoinMonthlyResult {
  already_joined: boolean;
  fee_charged: number;
  balance: number;
}

export async function joinMonthlyChallenge(): Promise<JoinMonthlyResult> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('join_monthly_challenge');
  if (error) throw error;
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    already_joined: Boolean(d.already_joined),
    fee_charged: Number(d.fee_charged ?? 0),
    balance: Number(d.balance ?? 0),
  };
}
