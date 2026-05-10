'use client';

// 주문 상세 — 상품 / 배송지 / 결제 / 취소.

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Package, MapPin, CreditCard, AlertCircle } from 'lucide-react';
import { fetchOrder, cancelOrder, orderStatusLabel, orderStatusColor } from '@/lib/shop-data';
import AppToast from '@/components/AppToast';
import type { Order, OrderItem, ShopPayment } from '@/types';

function OrderDetailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get('id') ?? '';

  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [payments, setPayments] = useState<ShopPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  useEffect(() => {
    if (!id) { setLoading(false); return; }
    let cancelled = false;
    fetchOrder(id)
      .then(res => {
        if (cancelled || !res) { if (!cancelled) setOrder(null); return; }
        setOrder(res.order);
        setItems(res.items);
        setPayments(res.payments);
      })
      .catch(e => { if (!cancelled) console.warn('[order] load fail', e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  const handleCancel = async () => {
    if (!order) return;
    if (!confirm('정말 주문을 취소하시겠어요?\n결제 완료된 주문은 환불 처리됩니다.')) return;
    setCancelling(true);
    try {
      await cancelOrder(order.id, '사용자 요청');
      // PG 환불은 별도 — 운영팀이 수동 진행 (Toss 대시보드 또는 webhook 으로 자동)
      setToast({ text: '취소 요청 완료. 환불은 영업일 기준 3-5일 소요돼요', tone: 'ok' });
      setTimeout(() => setToast(null), 3500);
      // 새로고침
      const res = await fetchOrder(order.id);
      if (res) {
        setOrder(res.order);
        setItems(res.items);
        setPayments(res.payments);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '취소 실패';
      setToast({ text: msg, tone: 'warn' });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="max-w-lg mx-auto p-4 text-center">
        <button onClick={() => router.back()} className="inline-flex items-center gap-2 text-[var(--muted)] mb-4">
          <ArrowLeft size={20} /> 뒤로
        </button>
        <p className="text-sm text-[var(--muted)] mt-12">주문을 찾을 수 없어요</p>
      </div>
    );
  }

  const canCancel = order.status === 'pending' || order.status === 'paid';
  const latestPayment = payments[0];

  return (
    <div className="max-w-lg mx-auto pb-12">
      <div className="flex items-center gap-3 px-4 py-3 sticky top-0 bg-[var(--background)]/95 backdrop-blur z-10">
        <button onClick={() => router.back()} className="p-1 active:scale-90" aria-label="뒤로">
          <ArrowLeft size={24} className="text-[var(--foreground)]" />
        </button>
        <h1 className="text-xl font-bold text-[var(--foreground)] flex-1">주문 상세</h1>
      </div>

      {/* 상태 카드 */}
      <div className="px-4 mb-3">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className={`text-base font-bold ${orderStatusColor(order.status)}`}>
              {orderStatusLabel(order.status)}
            </span>
            <span className="text-xs text-[var(--muted)]">
              {new Date(order.created_at).toLocaleString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <p className="text-xs text-[var(--muted)]">주문번호: {order.order_no ?? order.id.slice(0, 8)}</p>
          {order.tracking_no && (
            <p className="text-xs text-[var(--muted)] mt-1">
              운송장: {order.tracking_carrier ?? ''} {order.tracking_no}
            </p>
          )}
          {order.cancelled_reason && (
            <div className="mt-3 p-3 rounded-lg bg-red-50 dark:bg-red-950/20 flex items-start gap-2">
              <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-600 dark:text-red-400">{order.cancelled_reason}</p>
            </div>
          )}
        </div>
      </div>

      {/* 주문 상품 */}
      <div className="px-4 mb-3">
        <div className="card p-4">
          <h2 className="text-sm font-bold text-[var(--foreground)] mb-3">주문 상품 ({items.length})</h2>
          <div className="space-y-3">
            {items.map(it => (
              <div key={it.id} className="flex gap-3">
                <Link
                  href={`/shop/product?id=${it.product_id}`}
                  className="w-16 h-16 rounded-lg bg-[var(--card-border)] overflow-hidden flex-shrink-0"
                >
                  {it.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.thumbnail_url} alt={it.product_name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[var(--muted)]"><Package size={24} /></div>
                  )}
                </Link>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--foreground)] line-clamp-2 leading-tight">{it.product_name}</p>
                  {it.variant_label && (
                    <p className="text-xs text-[var(--muted)] mt-0.5">{it.variant_label}</p>
                  )}
                  <p className="text-xs text-[var(--muted)] mt-0.5">
                    {it.quantity}개 × {it.unit_price_krw.toLocaleString()}원
                  </p>
                </div>
                <p className="text-sm font-bold text-[var(--foreground)]">
                  {((it.subtotal_krw ?? it.unit_price_krw * it.quantity)).toLocaleString()}원
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 배송지 */}
      <div className="px-4 mb-3">
        <div className="card p-4">
          <h2 className="text-sm font-bold text-[var(--foreground)] mb-3 flex items-center gap-1.5">
            <MapPin size={16} /> 배송지
          </h2>
          <p className="text-sm font-bold text-[var(--foreground)]">{order.shipping_name}</p>
          <p className="text-xs text-[var(--muted)] mt-0.5">{order.shipping_phone}</p>
          <p className="text-xs text-[var(--foreground)] mt-1">
            {order.shipping_postal_code && `[${order.shipping_postal_code}] `}
            {order.shipping_address}
            {order.shipping_address_line2 && ` ${order.shipping_address_line2}`}
          </p>
          {order.shipping_memo && (
            <p className="text-xs text-[var(--muted)] mt-2 italic">메모: {order.shipping_memo}</p>
          )}
        </div>
      </div>

      {/* 결제 정보 */}
      <div className="px-4 mb-3">
        <div className="card p-4 space-y-2">
          <h2 className="text-sm font-bold text-[var(--foreground)] mb-2 flex items-center gap-1.5">
            <CreditCard size={16} /> 결제 정보
          </h2>
          <div className="flex justify-between text-sm">
            <span className="text-[var(--muted)]">상품 금액</span>
            <span>{order.subtotal_krw.toLocaleString()}원</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[var(--muted)]">배송비</span>
            <span>{order.shipping_fee_krw === 0 ? '무료' : `${order.shipping_fee_krw.toLocaleString()}원`}</span>
          </div>
          {order.mileage_used > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-[var(--muted)]">마일리지 사용</span>
              <span className="text-orange-500">- {order.mileage_used.toLocaleString()}P</span>
            </div>
          )}
          <div className="pt-2 border-t border-[var(--card-border)] flex justify-between items-baseline">
            <span className="text-sm font-semibold">총 결제 금액</span>
            <span className="text-xl font-extrabold text-[var(--accent)]">{order.total_krw.toLocaleString()}원</span>
          </div>
          {latestPayment && (
            <p className="text-xs text-[var(--muted)] mt-1">
              {latestPayment.method ?? '카드'} · {latestPayment.approved_at && new Date(latestPayment.approved_at).toLocaleString('ko-KR')}
            </p>
          )}
        </div>
      </div>

      {/* 액션 */}
      {canCancel && (
        <div className="px-4 mt-5">
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="w-full py-3 rounded-xl border border-red-200 dark:border-red-900/40 text-red-500 text-sm font-bold disabled:opacity-50"
          >
            {cancelling ? '처리 중…' : '주문 취소'}
          </button>
        </div>
      )}

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={3500} />}
    </div>
  );
}

export default function OrderDetailPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
      </div>
    }>
      <OrderDetailContent />
    </Suspense>
  );
}
