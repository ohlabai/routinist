'use client';

// 주문 내역 — 모던 모바일 UX/UI (에메랄드 그린).

import { useEffect, useState, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ChevronRight, Sparkles, Receipt, Star } from 'lucide-react';
import { Suspense } from 'react';
import { fetchMyOrders, orderStatusLabel, orderStatusColor } from '@/lib/shop-data';
import { useAuth } from '@/components/AuthProvider';
import { useI18n, formatKrw } from '@/lib/i18n';
import type { Order } from '@/types';

type Filter = 'all' | 'pending' | 'paid' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
const FILTER_LABELS_KO: Record<Filter, string> = {
  all: '전체', pending: '결제대기', paid: '결제완료',
  shipped: '배송중', delivered: '배송완료', cancelled: '취소', refunded: '환불',
};
const FILTER_LABELS_EN: Record<Filter, string> = {
  all: 'All', pending: 'Pending', paid: 'Paid',
  shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled', refunded: 'Refunded',
};
const FILTER_ORDER: Filter[] = ['all', 'pending', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded'];

function MyOrdersContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialFilter = (searchParams.get('status') as Filter) ?? 'all';
  const { user, loading: authLoading } = useAuth();
  const { tt, locale } = useI18n();
  const FILTER_LABELS = locale === 'en' ? FILTER_LABELS_EN : FILTER_LABELS_KO;
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [filter, setFilter] = useState<Filter>(FILTER_ORDER.includes(initialFilter) ? initialFilter : 'all');
  const PAGE_SIZE = 20;

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    setLoading(true);
    setOrders([]);
    fetchMyOrders(PAGE_SIZE, 0, filter === 'all' ? undefined : filter)
      .then(list => { setOrders(list); setHasMore(list.length === PAGE_SIZE); })
      .catch(e => console.warn('[orders] load fail', e))
      .finally(() => setLoading(false));
  }, [authLoading, user, router, filter]);

  const loadMore = async () => {
    if (!hasMore) return;
    const next = await fetchMyOrders(PAGE_SIZE, orders.length, filter === 'all' ? undefined : filter);
    setOrders(prev => [...prev, ...next]);
    if (next.length < PAGE_SIZE) setHasMore(false);
  };

  const counts = useMemo(() => orders.length, [orders]);

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-extrabold tracking-tight">{tt('주문 내역')}</h1>
        </div>
        {/* 상태 필터 */}
        <div className="flex gap-1.5 px-3 pb-2.5 overflow-x-auto scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
          {FILTER_ORDER.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-extrabold whitespace-nowrap active:scale-95 transition ${
                filter === f
                  ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30'
                  : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
              }`}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>
      </header>

      {loading || authLoading ? (
        <div className="px-4 pt-4 space-y-3">
          {[0,1,2].map(i => (
            <div key={i} className="card p-4 space-y-2">
              <div className="h-3 w-1/2 bg-[var(--card-border)]/50 rounded animate-pulse" />
              <div className="h-3 w-1/3 bg-[var(--card-border)]/50 rounded animate-pulse" />
              <div className="h-5 w-2/5 bg-[var(--card-border)]/50 rounded animate-pulse" />
            </div>
          ))}
        </div>
      ) : counts === 0 ? (
        <div className="text-center py-24 px-6">
          <div className="w-24 h-24 rounded-full bg-emerald-50 dark:bg-emerald-950/30 mx-auto mb-5 flex items-center justify-center">
            <Receipt size={42} className="text-emerald-500" />
          </div>
          <p className="text-lg font-extrabold mb-1.5">
            {filter === 'all'
              ? tt('아직 주문 내역이 없어요')
              : (locale === 'en' ? `No ${FILTER_LABELS[filter]} orders` : `${FILTER_LABELS[filter]} 주문이 없어요`)}
          </p>
          <p className="text-sm text-[var(--muted)] mb-7">
            {filter === 'all'
              ? (locale === 'en' ? 'Start your first order' : '첫 주문을 시작해 보세요')
              : (locale === 'en' ? 'Try another status too' : '다른 상태도 확인해 보세요')}
          </p>
          <Link
            href="/shop"
            className="inline-flex items-center gap-1.5 px-6 py-3 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-bold shadow-md shadow-emerald-500/30 active:scale-95"
          >
            <Sparkles size={16} /> {locale === 'en' ? 'Go shopping' : '쇼핑하러 가기'}
          </Link>
        </div>
      ) : (
        <div className="px-4 pt-4 space-y-2.5">
          {orders.map(o => (
            <div key={o.id} className="card p-4 active:scale-[0.99] transition group">
              <Link href={`/shop/order?id=${o.id}`} className="block">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[13px] text-[var(--muted)] font-medium">
                    {new Date(o.created_at).toLocaleString(locale === 'en' ? 'en-US' : 'ko-KR', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                  <span className={`text-[13px] font-extrabold px-2 py-0.5 rounded-full bg-[var(--card-border)]/40 ${orderStatusColor(o.status)}`}>
                    {orderStatusLabel(o.status)}
                  </span>
                </div>
                <p className="text-[13px] text-[var(--muted)] mb-1.5">{locale === 'en' ? 'Order #' : '주문번호 ·'} {o.order_no ?? o.id.slice(0, 8)}</p>
                <div className="flex items-baseline justify-between">
                  <span className="text-lg font-extrabold text-[var(--foreground)]">
                    {formatKrw(o.total_krw, locale)}
                  </span>
                  <ChevronRight size={16} className="text-[var(--muted)] group-active:translate-x-0.5 transition" />
                </div>
              </Link>
              {o.status === 'delivered' && (
                <Link
                  href={`/shop/order?id=${o.id}`}
                  className="mt-3 w-full py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-xs font-extrabold inline-flex items-center justify-center gap-1.5 active:scale-[0.98]"
                >
                  <Star size={13} className="fill-amber-400 text-amber-400" /> {tt('리뷰 작성하기')}
                </Link>
              )}
            </div>
          ))}
          {hasMore && (
            <button
              onClick={loadMore}
              className="w-full py-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-sm font-bold active:scale-[0.98]"
            >
              {locale === 'en' ? 'Load more' : '더 보기'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function MyOrdersPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    }>
      <MyOrdersContent />
    </Suspense>
  );
}
