'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { fetchMileageBalance, fetchMileageTransactions, txTypeLabel, txTypeColor } from '@/lib/mileage-data';
import { ArrowLeft, Gift, Coins } from 'lucide-react';
import Link from 'next/link';
import type { MileageTransaction } from '@/types';

export default function MileagePage() {
  const { user } = useAuth();
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<MileageTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const timer = setTimeout(() => { if (!cancelled) setLoading(false); }, 8000);
    Promise.all([
      fetchMileageBalance(user.id),
      fetchMileageTransactions(user.id),
    ]).then(([b, txs]) => {
      if (cancelled) return;
      setBalance(b);
      setTransactions(txs);
    }).catch(e => {
      if (!cancelled) console.warn('[mileage] fetch 실패', e);
    }).finally(() => {
      clearTimeout(timer);
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; clearTimeout(timer); };
  }, [user]);

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
        <p className="text-xs text-[var(--muted)] mt-2">1km = 10P 적립</p>
        <Link
          href="/mileage/gift"
          className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--accent)] text-white font-semibold text-sm"
        >
          <Gift size={16} /> 선물하기
        </Link>
      </div>

      {/* 거래 내역 */}
      <div className="card">
        <h3 className="text-sm font-semibold text-[var(--foreground)] px-5 pt-4 pb-2">거래 내역</h3>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
          </div>
        ) : transactions.length === 0 ? (
          <p className="text-xs text-[var(--muted)] text-center py-8 px-5">아직 거래 내역이 없습니다</p>
        ) : (
          <div className="divide-y divide-[var(--card-border)]">
            {transactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium text-[var(--foreground)]">{txTypeLabel(tx.tx_type)}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {tx.description || new Date(tx.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <p className={`text-base font-bold ${txTypeColor(tx.tx_type)}`}>
                  {tx.amount > 0 ? '+' : ''}{tx.amount.toLocaleString()}P
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
