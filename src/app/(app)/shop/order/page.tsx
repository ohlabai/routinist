'use client';

// 주문 상세 — 모던 모바일 UX/UI (에메랄드 그린).

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Package, MapPin, CreditCard, AlertCircle, Receipt,
  Truck, CheckCircle, Clock,
} from 'lucide-react';
import { fetchOrder, cancelOrder, orderStatusLabel, orderStatusColor } from '@/lib/shop-data';
import AppToast from '@/components/AppToast';
import BusinessFooter from '@/components/shop/BusinessFooter';
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
      setToast({ text: '취소 요청 완료. 환불은 영업일 3-5일 소요돼요', tone: 'ok' });
      setTimeout(() => setToast(null), 3500);
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
        <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="max-w-lg mx-auto px-6 py-20 text-center bg-[var(--background)] min-h-screen">
        <button onClick={() => router.back()} className="absolute top-4 left-4 w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90">
          <ArrowLeft size={20} />
        </button>
        <div className="w-20 h-20 rounded-full bg-emerald-50 dark:bg-emerald-950/30 mx-auto mb-4 flex items-center justify-center">
          <Receipt size={36} className="text-emerald-500" />
        </div>
        <p className="text-base font-bold mb-1">주문을 찾을 수 없어요</p>
        <Link href="/shop/orders" className="inline-flex mt-5 px-5 py-2.5 rounded-full bg-emerald-500 text-white text-sm font-bold active:scale-95">
          주문 내역 보기
        </Link>
      </div>
    );
  }

  const canCancel = order.status === 'pending' || order.status === 'paid';
  const latestPayment = payments[0];
  const statusIcon = order.status === 'pending' ? <Clock size={18} /> :
                     order.status === 'paid' ? <CheckCircle size={18} /> :
                     order.status === 'shipped' ? <Truck size={18} /> :
                     order.status === 'delivered' ? <CheckCircle size={18} /> :
                     <AlertCircle size={18} />;

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-extrabold tracking-tight">주문 상세</h1>
        </div>
      </header>

      {/* 상태 카드 — Hero */}
      <div className="px-4 pt-4">
        <div className="card p-5 bg-gradient-to-br from-emerald-50 via-teal-50 to-emerald-50 dark:from-emerald-950/20 dark:via-teal-950/20 dark:to-emerald-950/20 border-emerald-200/40 dark:border-emerald-900/30">
          <div className="flex items-center gap-3 mb-2">
            <div className={`w-11 h-11 rounded-full flex items-center justify-center ${
              order.status === 'paid' || order.status === 'delivered' ? 'bg-emerald-500 text-white' :
              order.status === 'pending' ? 'bg-amber-500 text-white' :
              order.status === 'shipped' ? 'bg-blue-500 text-white' :
              'bg-zinc-400 text-white'
            }`}>
              {statusIcon}
            </div>
            <div>
              <p className={`text-base font-extrabold ${orderStatusColor(order.status)}`}>
                {orderStatusLabel(order.status)}
              </p>
              <p className="text-[11px] text-[var(--muted)]">
                {new Date(order.created_at).toLocaleString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
          <p className="text-xs text-[var(--muted)] mt-2">주문번호 · <span className="font-bold text-[var(--foreground)]">{order.order_no ?? order.id.slice(0, 8)}</span></p>
          {order.tracking_no && (
            <div className="mt-3 pt-3 border-t border-emerald-200/30 dark:border-emerald-900/20 flex items-center gap-2">
              <Truck size={14} className="text-emerald-600" />
              <p className="text-xs">
                <span className="text-[var(--muted)]">{order.tracking_carrier} </span>
                <span className="font-bold">{order.tracking_no}</span>
              </p>
            </div>
          )}
          {order.cancelled_reason && (
            <div className="mt-3 p-3 rounded-xl bg-red-50 dark:bg-red-950/20 flex items-start gap-2">
              <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-red-600 dark:text-red-400">{order.cancelled_reason}</p>
            </div>
          )}
        </div>
      </div>

      {/* 주문 상품 */}
      <Section title={`주문 상품 ${items.length}`} icon={<Package size={16} className="text-emerald-500" />}>
        <div className="card p-4 space-y-3.5">
          {items.map(it => (
            <div key={it.id} className="flex gap-3 items-start">
              <Link href={`/shop/product?id=${it.product_id}`} className="w-16 h-16 rounded-xl bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950 overflow-hidden flex-shrink-0 active:scale-95">
                {it.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.thumbnail_url} alt={it.product_name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[var(--muted)]"><Package size={24} /></div>
                )}
              </Link>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--foreground)] line-clamp-2 leading-snug">{it.product_name}</p>
                {it.variant_label && (
                  <p className="text-[10px] text-[var(--muted)] mt-0.5 inline-block px-1.5 py-0.5 rounded bg-[var(--card-border)]/40">{it.variant_label}</p>
                )}
                <p className="text-xs text-[var(--muted)] mt-0.5">{it.quantity}개 × {it.unit_price_krw.toLocaleString()}원</p>
              </div>
              <p className="text-sm font-extrabold text-[var(--foreground)] flex-shrink-0">
                {(it.subtotal_krw ?? it.unit_price_krw * it.quantity).toLocaleString()}원
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* 배송지 */}
      <Section title="배송지" icon={<MapPin size={16} className="text-emerald-500" />}>
        <div className="card p-4">
          <p className="text-sm font-extrabold text-[var(--foreground)]">{order.shipping_name}</p>
          <p className="text-xs text-[var(--muted)] mt-0.5">{order.shipping_phone}</p>
          <p className="text-xs text-[var(--foreground)] mt-1.5 leading-relaxed">
            {order.shipping_postal_code && `[${order.shipping_postal_code}] `}
            {order.shipping_address}
            {order.shipping_address_line2 && ` ${order.shipping_address_line2}`}
          </p>
          {order.shipping_memo && (
            <p className="text-[11px] text-[var(--muted)] mt-2 italic">메모: {order.shipping_memo}</p>
          )}
        </div>
      </Section>

      {/* 결제 정보 */}
      <Section title="결제 정보" icon={<CreditCard size={16} className="text-emerald-500" />}>
        <div className="card p-5 space-y-2.5 bg-gradient-to-br from-emerald-50/30 to-transparent dark:from-emerald-950/10">
          <Row label="상품 금액" value={`${order.subtotal_krw.toLocaleString()}원`} />
          <Row label="배송비" value={order.shipping_fee_krw === 0 ? '무료 🎉' : `${order.shipping_fee_krw.toLocaleString()}원`} highlight={order.shipping_fee_krw === 0} />
          {order.mileage_used > 0 && (
            <Row label="마일리지 사용" value={`-${order.mileage_used.toLocaleString()}P`} negative />
          )}
          <div className="pt-3 border-t border-emerald-200/40 dark:border-emerald-900/30 flex justify-between items-baseline">
            <span className="text-sm font-bold">총 결제 금액</span>
            <span className="text-2xl font-extrabold text-emerald-600">{order.total_krw.toLocaleString()}원</span>
          </div>
          {latestPayment && latestPayment.approved_at && (
            <p className="text-[11px] text-[var(--muted)] mt-1">
              {latestPayment.method ?? '카드'} · {new Date(latestPayment.approved_at).toLocaleString('ko-KR')}
            </p>
          )}
        </div>
      </Section>

      {/* 액션 */}
      {canCancel && (
        <div className="px-4 mt-5">
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="w-full py-3.5 rounded-2xl border-2 border-red-200 dark:border-red-900/40 bg-red-50/50 dark:bg-red-950/20 text-red-600 text-sm font-bold disabled:opacity-50 active:scale-[0.98]"
          >
            {cancelling ? '처리 중…' : '주문 취소'}
          </button>
        </div>
      )}

      <BusinessFooter variant="compact" />

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={3500} />}
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="px-4 mt-4">
      <h2 className="text-sm font-extrabold inline-flex items-center gap-1.5 mb-2.5">{icon}{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value, highlight, negative }: { label: string; value: string; highlight?: boolean; negative?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <span className={`font-bold ${highlight ? 'text-emerald-600' : negative ? 'text-orange-500' : 'text-[var(--foreground)]'}`}>{value}</span>
    </div>
  );
}

export default function OrderDetailPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    }>
      <OrderDetailContent />
    </Suspense>
  );
}
