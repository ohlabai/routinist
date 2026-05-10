'use client';

// 내 주문 목록.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ShoppingBag } from 'lucide-react';
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

  if (loading || authLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto pb-12">
      <div className="flex items-center gap-3 px-4 py-3 sticky top-0 bg-[var(--background)]/95 backdrop-blur z-10">
        <button onClick={() => router.back()} className="p-1 active:scale-90" aria-label="뒤로">
          <ArrowLeft size={24} className="text-[var(--foreground)]" />
        </button>
        <h1 className="text-xl font-bold text-[var(--foreground)] flex-1">주문 내역</h1>
      </div>

      {orders.length === 0 ? (
        <div className="text-center py-20 px-4">
          <ShoppingBag size={48} className="mx-auto mb-4 text-[var(--muted)]" />
          <p className="text-sm text-[var(--muted)]">아직 주문 내역이 없어요</p>
          <Link
            href="/shop"
            className="inline-block mt-4 px-5 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-bold"
          >
            쇼핑하러 가기
          </Link>
        </div>
      ) : (
        <div className="px-4 space-y-3">
          {orders.map(o => (
            <Link
              key={o.id}
              href={`/shop/order?id=${o.id}`}
              className="card p-4 block active:scale-[0.99] transition"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-[var(--muted)]">
                  {new Date(o.created_at).toLocaleString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
                <span className={`text-xs font-bold ${orderStatusColor(o.status)}`}>
                  {orderStatusLabel(o.status)}
                </span>
              </div>
              <p className="text-xs text-[var(--muted)] mb-1">주문번호 {o.order_no ?? o.id.slice(0, 8)}</p>
              <p className="text-base font-bold text-[var(--foreground)]">
                {o.total_krw.toLocaleString()}원
              </p>
            </Link>
          ))}
          {hasMore && (
            <button
              onClick={loadMore}
              className="w-full py-3 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-sm text-[var(--muted)]"
            >
              더 보기
            </button>
          )}
        </div>
      )}
    </div>
  );
}
