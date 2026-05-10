'use client';

// 주문 내역 — 모던 모바일 UX/UI (에메랄드 그린).

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ShoppingBag, ChevronRight, Sparkles, Receipt } from 'lucide-react';
import { fetchMyOrders, orderStatusLabel, orderStatusColor } from '@/lib/shop-data';
import { useAuth } from '@/components/AuthProvider';
import type { Order } from '@/types';

export default function MyOrdersPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const PAGE_SIZE = 20;

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    fetchMyOrders(PAGE_SIZE, 0)
      .then(list => { setOrders(list); setHasMore(list.length === PAGE_SIZE); })
      .catch(e => console.warn('[orders] load fail', e))
      .finally(() => setLoading(false));
  }, [authLoading, user, router]);

  const loadMore = async () => {
    if (!hasMore) return;
    const next = await fetchMyOrders(PAGE_SIZE, orders.length);
    setOrders(prev => [...prev, ...next]);
    if (next.length < PAGE_SIZE) setHasMore(false);
  };

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-extrabold tracking-tight">주문 내역</h1>
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
      ) : orders.length === 0 ? (
        <div className="text-center py-24 px-6">
          <div className="w-24 h-24 rounded-full bg-emerald-50 dark:bg-emerald-950/30 mx-auto mb-5 flex items-center justify-center">
            <Receipt size={42} className="text-emerald-500" />
          </div>
          <p className="text-lg font-extrabold mb-1.5">아직 주문 내역이 없어요</p>
          <p className="text-sm text-[var(--muted)] mb-7">첫 주문을 시작해 보세요</p>
          <Link
            href="/shop"
            className="inline-flex items-center gap-1.5 px-6 py-3 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-bold shadow-md shadow-emerald-500/30 active:scale-95"
          >
            <Sparkles size={16} /> 쇼핑하러 가기
          </Link>
        </div>
      ) : (
        <div className="px-4 pt-4 space-y-2.5">
          {orders.map(o => (
            <Link
              key={o.id}
              href={`/shop/order?id=${o.id}`}
              className="card p-4 block active:scale-[0.99] transition group"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] text-[var(--muted)] font-medium">
                  {new Date(o.created_at).toLocaleString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
                <span className={`text-[11px] font-extrabold px-2 py-0.5 rounded-full bg-[var(--card-border)]/40 ${orderStatusColor(o.status)}`}>
                  {orderStatusLabel(o.status)}
                </span>
              </div>
              <p className="text-[11px] text-[var(--muted)] mb-1.5">주문번호 · {o.order_no ?? o.id.slice(0, 8)}</p>
              <div className="flex items-baseline justify-between">
                <span className="text-lg font-extrabold text-[var(--foreground)]">
                  {o.total_krw.toLocaleString()}원
                </span>
                <ChevronRight size={16} className="text-[var(--muted)] group-active:translate-x-0.5 transition" />
              </div>
            </Link>
          ))}
          {hasMore && (
            <button
              onClick={loadMore}
              className="w-full py-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-sm font-bold active:scale-[0.98]"
            >
              더 보기
            </button>
          )}
        </div>
      )}
    </div>
  );
}
