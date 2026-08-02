'use client';

// 마일리지 카테고리 요약 모달 (build 100, Phase 4).
// 랭킹 행 클릭 → 어떻게 마일리지를 모았는지 카테고리별 합계 (개인 트랜잭션 X).
// fetch_user_mileage_summary RPC 사용 — public 프로필만 조회 가능 + 본인은 항상 가능.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X, Coins, Footprints, Gift, ShoppingCart, Calendar, Clock, ChevronRight } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { fetchMileageTransactions, txTypeLabel } from '@/lib/mileage-data';
import { useI18n, formatRank } from '@/lib/i18n';
import type { MileageTransaction } from '@/types';

interface Summary {
  display_name: string;
  avatar_url: string | null;
  region_gu: string | null;
  total_balance: number;
  running_earned: number;
  reward_earned: number;
  spent: number;
  recent_30d_earned: number;
  signup_days: number;
  total_runs: number;
  total_distance_km: number;
}

interface Props {
  userId: string;
  rank: number;
  onClose: () => void;
}

export default function MileageBreakdownModal({ userId, rank, onClose }: Props) {
  const { user } = useAuth();
  const { locale } = useI18n();
  const isMe = user?.id === userId;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // 본인 클릭 시 — 최근 트랜잭션 timeline (개인 기록이라 본인만)
  const [myTxs, setMyTxs] = useState<MileageTransaction[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        const [{ data, error: rpcError }, myTxsResult] = await Promise.all([
          supabase.rpc('fetch_user_mileage_summary', { target_user_id: userId }),
          // 본인이면 timeline 도 동시 fetch. 타인은 빈 배열 (개인 기록 노출 X)
          isMe ? fetchMileageTransactions(userId, 20).catch(() => []) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        if (rpcError) throw rpcError;
        const row = Array.isArray(data) ? data[0] : data;
        if (row) setSummary(row as Summary);
        else setError(true);
        setMyTxs(myTxsResult as MileageTransaction[]);
      } catch (e) {
        console.warn('[MileageBreakdownModal] RPC 실패', e);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, isMe]);

  useEffect(() => {
    const orig = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = orig; };
  }, []);

  const totalEarned = summary ? summary.running_earned + summary.reward_earned : 0;
  const runningPct = totalEarned > 0 && summary ? (summary.running_earned / totalEarned) * 100 : 0;
  const rewardPct = totalEarned > 0 && summary ? (summary.reward_earned / totalEarned) * 100 : 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-[var(--background)] w-full max-w-lg max-h-[85vh] rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="sticky top-0 z-10 bg-[var(--background)]/95 backdrop-blur-lg border-b border-[var(--card-border)] px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Coins size={20} className="text-emerald-500 flex-shrink-0" />
            <h2 className="text-base font-extrabold text-[var(--foreground)] truncate">마일리지 적립 내역</h2>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-[var(--card-border)]/40 flex items-center justify-center active:scale-95 transition flex-shrink-0"
            aria-label="닫기"
          >
            <X size={18} className="text-[var(--foreground)]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
            </div>
          ) : error || !summary ? (
            <div className="px-5 py-16 text-center">
              <Coins size={32} className="mx-auto text-[var(--muted)] opacity-40 mb-2" />
              <p className="text-sm font-semibold text-[var(--foreground)]">정보를 불러올 수 없어요</p>
              <p className="text-xs text-[var(--muted)] mt-1">비공개 프로필이거나 일시적인 오류일 수 있어요</p>
            </div>
          ) : (
            <>
              {/* 프로필 + 잔액 */}
              <div className="px-5 py-5 bg-gradient-to-br from-emerald-50 via-white to-emerald-50/30 dark:from-emerald-950/30 dark:via-zinc-900 dark:to-emerald-950/10 border-b border-emerald-200/40 dark:border-emerald-900/30">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden flex-shrink-0">
                    {summary.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={summary.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-base font-bold text-[var(--muted)]">
                        {summary.display_name.slice(0, 1)}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-extrabold text-[var(--foreground)] truncate">
                      {summary.display_name}{isMe && <span className="ml-1 text-emerald-600">(나)</span>}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                      <span className="font-bold text-emerald-700 dark:text-emerald-400">{formatRank(rank, locale)}</span>
                      {summary.region_gu && <><span>·</span><span>{summary.region_gu}</span></>}
                      <span>·</span>
                      <span>가입 {summary.signup_days}일</span>
                    </div>
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-[12px] font-bold text-[var(--muted)] uppercase tracking-wide mb-0.5">현재 잔액</p>
                  <p className="text-4xl font-extrabold text-emerald-600 tabular-nums">
                    {summary.total_balance.toLocaleString()}<span className="text-lg ml-1">P</span>
                  </p>
                </div>
              </div>

              {/* 카테고리별 비율 (러닝 vs 보상) */}
              <div className="px-5 py-4">
                <h3 className="text-sm font-bold text-[var(--foreground)] mb-2.5">어떻게 모았나요?</h3>
                {totalEarned === 0 ? (
                  <p className="text-xs text-[var(--muted)] text-center py-6">아직 적립 기록이 없어요</p>
                ) : (
                  <>
                    {/* 통합 진행바 — 러닝(emerald) + 보상(amber) */}
                    <div className="h-3 rounded-full bg-[var(--card-border)]/40 overflow-hidden flex mb-2">
                      <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500" style={{ width: `${runningPct}%` }} />
                      <div className="h-full bg-gradient-to-r from-amber-400 to-amber-500" style={{ width: `${rewardPct}%` }} />
                    </div>
                    <div className="flex justify-between text-[13px] mb-4">
                      <span className="text-emerald-700 dark:text-emerald-400 font-bold">
                        러닝 {runningPct.toFixed(0)}%
                      </span>
                      <span className="text-amber-700 dark:text-amber-400 font-bold">
                        보상 {rewardPct.toFixed(0)}%
                      </span>
                    </div>

                    {/* 3개 카드 */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-900/40 p-3">
                        <div className="flex items-center gap-1 mb-1">
                          <Footprints size={12} className="text-emerald-600" />
                          <span className="text-[12px] font-bold text-emerald-700 dark:text-emerald-400">러닝</span>
                        </div>
                        <p className="text-base font-extrabold text-[var(--foreground)] tabular-nums">
                          +{summary.running_earned.toLocaleString()}
                        </p>
                        <p className="text-[12px] text-[var(--muted)]">달려서 적립</p>
                      </div>
                      <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/40 p-3">
                        <div className="flex items-center gap-1 mb-1">
                          <Gift size={12} className="text-amber-600" />
                          <span className="text-[12px] font-bold text-amber-700 dark:text-amber-400">보상</span>
                        </div>
                        <p className="text-base font-extrabold text-[var(--foreground)] tabular-nums">
                          +{summary.reward_earned.toLocaleString()}
                        </p>
                        <p className="text-[12px] text-[var(--muted)]">선물·가입 등</p>
                      </div>
                      <div className="rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-900/40 p-3">
                        <div className="flex items-center gap-1 mb-1">
                          <ShoppingCart size={12} className="text-rose-600" />
                          <span className="text-[12px] font-bold text-rose-700 dark:text-rose-400">사용</span>
                        </div>
                        <p className="text-base font-extrabold text-[var(--foreground)] tabular-nums">
                          -{summary.spent.toLocaleString()}
                        </p>
                        <p className="text-[12px] text-[var(--muted)]">쇼핑·선물</p>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* 통계 — 최근 30일, 가입, 러닝 */}
              <div className="px-5 pb-4">
                <h3 className="text-sm font-bold text-[var(--foreground)] mb-2.5">활동 통계</h3>
                <div className="space-y-2">
                  <div className="card p-3 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                      <Clock size={16} className="text-emerald-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-xs text-[var(--muted)]">최근 30일 적립</p>
                      <p className="text-base font-extrabold text-[var(--foreground)] tabular-nums">
                        +{summary.recent_30d_earned.toLocaleString()} P
                      </p>
                    </div>
                  </div>
                  <div className="card p-3 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                      <Footprints size={16} className="text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-xs text-[var(--muted)]">통산 러닝</p>
                      <p className="text-base font-extrabold text-[var(--foreground)] tabular-nums">
                        {summary.total_runs.toLocaleString()}회 · {Number(summary.total_distance_km).toFixed(0)}km
                      </p>
                    </div>
                  </div>
                  <div className="card p-3 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
                      <Calendar size={16} className="text-purple-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-xs text-[var(--muted)]">가입한 지</p>
                      <p className="text-base font-extrabold text-[var(--foreground)] tabular-nums">
                        {summary.signup_days}일
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 본인이면 최근 트랜잭션 timeline + /mileage 전체 보기 CTA */}
              {isMe && (
                <div className="px-5 pb-5 space-y-3">
                  {myTxs.length > 0 && (
                    <div>
                      <h3 className="text-sm font-bold text-[var(--foreground)] mb-2">최근 적립 내역</h3>
                      <div className="card divide-y divide-[var(--card-border)] overflow-hidden">
                        {myTxs.slice(0, 8).map(tx => {
                          const isEarn = tx.amount > 0;
                          const dateStr = new Date(tx.created_at).toLocaleDateString('ko-KR', {
                            month: 'short', day: 'numeric',
                          });
                          return (
                            <div key={tx.id} className="flex items-center gap-3 px-3 py-2.5">
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                isEarn
                                  ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600'
                                  : 'bg-rose-50 dark:bg-rose-950/30 text-rose-600'
                              }`}>
                                {tx.tx_type === 'run_earn' ? <Footprints size={14} />
                                  : tx.tx_type === 'gift_receive' || tx.tx_type === 'reward' ? <Gift size={14} />
                                  : <ShoppingCart size={14} />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-[var(--foreground)] truncate">
                                  {txTypeLabel(tx.tx_type)}
                                  {tx.event_type && (
                                    <span className="ml-1 text-[12px] text-[var(--muted)] font-normal">
                                      {tx.event_type}
                                    </span>
                                  )}
                                </p>
                                <p className="text-[13px] text-[var(--muted)]">{dateStr}</p>
                              </div>
                              <span className={`text-sm font-extrabold tabular-nums whitespace-nowrap ${
                                isEarn ? 'text-emerald-600' : 'text-rose-600'
                              }`}>
                                {isEarn ? '+' : ''}{tx.amount.toLocaleString()} P
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <Link
                    href="/mileage"
                    onClick={onClose}
                    className="w-full flex items-center justify-center gap-1.5 py-3 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-bold text-sm active:scale-[0.99] transition shadow-sm"
                  >
                    <span>내 마일리지 내역 전체 보기</span>
                    <ChevronRight size={14} />
                  </Link>
                </div>
              )}

              {/* 타인 클릭 시 — 선물 보내기 진입점 (build 100) */}
              {!isMe && (
                <div className="px-5 pb-5">
                  <Link
                    href={`/mileage/gift?to=${userId}`}
                    onClick={onClose}
                    className="w-full flex items-center justify-center gap-1.5 py-3 rounded-xl bg-gradient-to-br from-pink-500 to-rose-500 text-white font-bold text-sm active:scale-[0.99] transition shadow-sm"
                  >
                    <Gift size={14} />
                    <span>마일리지 선물 보내기</span>
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
