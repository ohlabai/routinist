'use client';

// 마일리지 — 모던 모바일 UX/UI (에메랄드 그린).

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { fetchMileageBalance, fetchMileageTransactions, txTypeLabel, classifyMileageTx } from '@/lib/mileage-data';
import { ArrowLeft, Gift, Coins, Sparkles, TrendingUp, TrendingDown, HelpCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import type { MileageTransaction } from '@/types';

type TabId = 'all' | 'running' | 'reward';
const TAB_LABELS: Record<TabId, string> = { all: '전체', running: '러닝', reward: '보상' };
const PAGE_SIZE = 50;

export default function MileagePage() {
  const router = useRouter();
  const { user } = useAuth();
  const { tt, locale } = useI18n();
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<MileageTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('all');
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    setTransactions([]);
    setHasMore(true);
    Promise.all([fetchMileageBalance(user.id), fetchMileageTransactions(user.id, PAGE_SIZE, 0)])
      .then(([b, txs]) => {
        if (cancelled) return;
        setBalance(b); setTransactions(txs); setHasMore(txs.length === PAGE_SIZE);
      })
      .catch(e => { if (!cancelled) console.warn('[mileage] fetch 실패', e); })
      .finally(() => { if (!cancelled) setLoading(false); });
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
    } finally { setLoadingMore(false); }
  }, [user, loadingMore, hasMore, transactions.length]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) loadMore();
    }, { rootMargin: '200px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore]);

  const filtered = activeTab === 'all' ? transactions : transactions.filter(tx => classifyMileageTx(tx) === activeTab);

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-extrabold tracking-tight flex-1">{tt('마일리지')}</h1>
          <Link
            href="/mileage/help"
            aria-label={tt('마일리지 가이드')}
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition text-[var(--muted)]"
          >
            <HelpCircle size={20} />
          </Link>
        </div>
      </header>

      {/* Hero — 잔액 카드 */}
      <section className="px-4 pt-4">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-teal-600 p-6 shadow-lg shadow-emerald-500/30">
          <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute -bottom-16 -left-8 w-32 h-32 rounded-full bg-emerald-300/30 blur-xl" />
          <div className="relative">
            <div className="flex items-center justify-between mb-4">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 backdrop-blur-sm">
                <Coins size={11} className="text-white" />
                <span className="text-[12px] font-extrabold text-white tracking-widest">MY MILEAGE</span>
              </div>
              <Sparkles size={20} className="text-white/80" />
            </div>
            <p className="text-5xl font-extrabold text-white tracking-tight">
              {balance.toLocaleString()}
              <span className="text-2xl ml-1">P</span>
            </p>
            <p className="text-xs text-white/80 mt-2 mb-4">{tt('1km = 1P 기본 (어제도 달리면 ×2)')}</p>
            <div className="flex flex-wrap gap-2 justify-center">
              <Link
                href="/mileage/gift"
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-white text-emerald-700 text-sm font-extrabold shadow-md active:scale-95 transition"
              >
                <Gift size={14} /> {tt('선물하기')}
              </Link>
              <Link
                href="/mileage/donate"
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-pink-500 text-white text-sm font-extrabold shadow-md active:scale-95 transition"
              >
                <Gift size={14} /> {tt('클럽 후원')}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 탭 */}
      <section className="px-4 mt-5">
        <div className="grid grid-cols-3 gap-1.5">
          {(Object.keys(TAB_LABELS) as TabId[]).map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`py-2.5 rounded-2xl text-xs font-extrabold transition active:scale-95 ${
                activeTab === t
                  ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30'
                  : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
              }`}
            >
              {tt(TAB_LABELS[t])}
            </button>
          ))}
        </div>
      </section>

      {/* 거래 내역 */}
      <section className="px-4 mt-3">
        <div className="card overflow-hidden">
          {loading ? (
            <div className="space-y-2 p-3">
              {[0,1,2,3].map(i => (
                <div key={i} className="flex items-center justify-between py-2 px-2">
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-2/3 bg-[var(--card-border)]/50 rounded animate-pulse" />
                    <div className="h-2 w-1/3 bg-[var(--card-border)]/50 rounded animate-pulse" />
                  </div>
                  <div className="h-4 w-14 bg-[var(--card-border)]/50 rounded animate-pulse" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 px-5">
              <div className="w-16 h-16 rounded-full bg-emerald-50 dark:bg-emerald-950/30 mx-auto mb-3 flex items-center justify-center">
                <Coins size={28} className="text-emerald-500" />
              </div>
              <p className="text-sm font-bold text-[var(--foreground)] mb-1">
                {activeTab === 'all'
                  ? tt('아직 거래 내역이 없어요')
                  : locale === 'en'
                  ? `No ${tt(TAB_LABELS[activeTab]).toLowerCase()} history yet`
                  : `${TAB_LABELS[activeTab]} 내역이 없어요`}
              </p>
              <p className="text-xs text-[var(--muted)]">{tt('달리기로 마일리지를 모아보세요!')}</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--card-border)]/40">
              {filtered.map(tx => {
                const isPositive = tx.amount > 0;
                return (
                  <div key={tx.id} className="flex items-center justify-between px-4 py-3.5 gap-3">
                    <div className={`w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0 ${
                      isPositive ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600' : 'bg-orange-50 dark:bg-orange-950/30 text-orange-500'
                    }`}>
                      {isPositive ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[var(--foreground)] line-clamp-1">
                        {tx.description || txTypeLabel(tx.tx_type)}
                      </p>
                      <p className="text-[13px] text-[var(--muted)] mt-0.5">
                        {new Date(tx.created_at).toLocaleString(locale === 'en' ? 'en-US' : 'ko-KR', {
                          year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <p className={`text-base font-extrabold flex-shrink-0 ${isPositive ? 'text-emerald-600' : 'text-orange-500'}`}>
                      {isPositive ? '+' : ''}{tx.amount.toLocaleString()}<span className="text-xs ml-0.5">P</span>
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {!loading && hasMore && (
            <div ref={sentinelRef} className="flex justify-center py-4">
              {loadingMore && (
                <div className="animate-spin w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full" />
              )}
            </div>
          )}
          {!loading && !hasMore && transactions.length > PAGE_SIZE && (
            <p className="text-[13px] text-[var(--muted)] text-center py-3.5 font-medium">{tt('— 끝 —')}</p>
          )}
        </div>
      </section>
    </div>
  );
}
