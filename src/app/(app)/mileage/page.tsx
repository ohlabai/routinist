'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { fetchMileageBalance, fetchMileageTransactions, txTypeLabel, txTypeColor, classifyMileageTx } from '@/lib/mileage-data';
import { ArrowLeft, Gift, Coins } from 'lucide-react';
import Link from 'next/link';
import type { MileageTransaction } from '@/types';

type TabId = 'all' | 'running' | 'reward';

const TAB_LABELS: Record<TabId, string> = {
  all: '전체',
  running: '러닝',
  reward: '보상',
};

const PAGE_SIZE = 50;

export default function MileagePage() {
  const { user } = useAuth();
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<MileageTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('all');
  const sentinelRef = useRef<HTMLDivElement>(null);

  // 첫 페이지 + 잔액
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    setTransactions([]);
    setHasMore(true);
    Promise.all([
      fetchMileageBalance(user.id),
      fetchMileageTransactions(user.id, PAGE_SIZE, 0),
    ]).then(([b, txs]) => {
      if (cancelled) return;
      setBalance(b);
      setTransactions(txs);
      setHasMore(txs.length === PAGE_SIZE);
    }).catch(e => {
      if (!cancelled) console.warn('[mileage] fetch 실패', e);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [user]);

  const loadMore = useCallback(async () => {
    if (!user || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchMileageTransactions(user.id, PAGE_SIZE, transactions.length);
      setTransactions(prev => [...prev, ...next]);
      if (next.length < PAGE_SIZE) setHasMore(false);
    } catch (e) {
      console.warn('[mileage] loadMore 실패', e);
    } finally {
      setLoadingMore(false);
    }
  }, [user, loadingMore, hasMore, transactions.length]);

  // 무한 스크롤 — 센티넬이 viewport 진입하면 다음 페이지.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMore();
    }, { rootMargin: '200px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore]);

  // 탭 필터
  const filtered = activeTab === 'all'
    ? transactions
    : transactions.filter(tx => classifyMileageTx(tx) === activeTab);

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/profile" className="text-[var(--muted)]"><ArrowLeft size={24} /></Link>
        <h1 className="text-2xl font-bold text-[var(--foreground)]">마일리지</h1>
      </div>

      {/* 잔액 카드 */}
      <div className="card p-6 text-center mb-4 bg-gradient-to-br from-[var(--accent)]/5 to-[var(--accent)]/10">
        <Coins size={32} className="mx-auto mb-2 text-[var(--accent)]" />
        <p className="text-xs text-[var(--muted)] mb-1">보유 마일리지</p>
        <p className="text-4xl font-extrabold text-[var(--foreground)]">
          {balance.toLocaleString()} <span className="text-lg font-semibold text-[var(--accent)]">P</span>
        </p>
        <p className="text-xs text-[var(--muted)] mt-2">1km = 1P 기본 (어제도 달리면 ×2)</p>
        <Link
          href="/mileage/gift"
          className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--accent)] text-white font-semibold text-sm"
        >
          <Gift size={16} /> 선물하기
        </Link>
      </div>

      {/* 탭 */}
      <div className="flex gap-2 mb-3">
        {(Object.keys(TAB_LABELS) as TabId[]).map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold transition active:scale-95 ${
              activeTab === t
                ? 'bg-[var(--accent)] text-white shadow-sm'
                : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* 거래 내역 */}
      <div className="card">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-[var(--muted)] text-center py-8 px-5">
            {activeTab === 'all' ? '아직 거래 내역이 없어요' : `${TAB_LABELS[activeTab]} 내역이 없어요`}
          </p>
        ) : (
          <div className="divide-y divide-[var(--card-border)]">
            {filtered.map((tx) => (
              <div key={tx.id} className="flex items-start justify-between px-5 py-3 gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--foreground)] truncate">
                    {tx.description || txTypeLabel(tx.tx_type)}
                  </p>
                  <p className="text-xs text-[var(--muted)] mt-0.5">
                    {new Date(tx.created_at).toLocaleString('ko-KR', {
                      year: 'numeric', month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </p>
                </div>
                <p className={`text-base font-bold flex-shrink-0 ${txTypeColor(tx.tx_type)}`}>
                  {tx.amount > 0 ? '+' : ''}{tx.amount.toLocaleString()}P
                </p>
              </div>
            ))}
          </div>
        )}

        {/* 무한 스크롤 센티넬 */}
        {!loading && hasMore && (
          <div ref={sentinelRef} className="flex justify-center py-4">
            {loadingMore && (
              <div className="animate-spin w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
            )}
          </div>
        )}
        {!loading && !hasMore && transactions.length > PAGE_SIZE && (
          <p className="text-xs text-[var(--muted)] text-center py-3">— 끝 —</p>
        )}
      </div>
    </div>
  );
}
