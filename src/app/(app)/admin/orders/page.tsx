'use client';

// 어드민 주문 관리 — 모든 주문 조회 + 상태 필터 + 운송장 입력 + 배송완료 처리.
// hans@openhan.kr 만 접근 가능. RLS 의 is_shop_admin() 함수가 service-side 보호.

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Truck, CheckCircle, Package, Filter } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { orderStatusLabel, orderStatusColor } from '@/lib/shop-data';
import AppToast from '@/components/AppToast';
import type { Order } from '@/types';

const ADMIN_EMAIL = 'hans@openhan.kr';

type StatusFilter = 'all' | 'pending' | 'paid' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';

const FILTER_LABELS: Record<StatusFilter, string> = {
  all: '전체',
  pending: '결제 대기',
  paid: '결제 완료',
  shipped: '배송 중',
  delivered: '배송 완료',
  cancelled: '취소',
  refunded: '환불',
};

const CARRIERS = ['CJ대한통운', '한진택배', '롯데택배', '우체국택배', '로젠택배', '직접 입력'];

export default function AdminOrdersPage() {
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [trackingFor, setTrackingFor] = useState<string | null>(null);
  const [carrier, setCarrier] = useState(CARRIERS[0]);
  const [carrierCustom, setCarrierCustom] = useState('');
  const [trackingNo, setTrackingNo] = useState('');
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2500);
  };

  const isAdmin = user?.email === ADMIN_EMAIL;
  void profile;

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    if (!isAdmin) { router.replace('/'); return; }
  }, [authLoading, user, isAdmin, router]);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const supabase = getSupabase();
      let q = supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(100);
      if (filter !== 'all') q = q.eq('status', filter);
      const { data, error } = await q;
      if (error) throw error;
      setOrders((data ?? []) as Order[]);
    } catch (e) {
      console.warn('[admin/orders] load fail', e);
      showToast('로드 실패', 'warn');
    } finally {
      setLoading(false);
    }
  }, [filter, isAdmin]);

  useEffect(() => { load(); }, [load]);

  const startTracking = (orderId: string) => {
    setTrackingFor(orderId);
    setCarrier(CARRIERS[0]);
    setCarrierCustom('');
    setTrackingNo('');
  };

  const cancelTracking = () => {
    setTrackingFor(null);
  };

  const submitTracking = async (orderId: string) => {
    const carrierFinal = carrier === '직접 입력' ? carrierCustom.trim() : carrier;
    if (!carrierFinal || !trackingNo.trim()) {
      showToast('택배사와 운송장 번호를 입력해주세요', 'warn');
      return;
    }
    setBusy(orderId);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.rpc('admin_mark_order_shipped', {
        p_order_id: orderId,
        p_carrier: carrierFinal,
        p_tracking_no: trackingNo.trim(),
      });
      if (error) throw error;
      showToast('배송 처리 완료');
      cancelTracking();
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '실패', 'warn');
    } finally {
      setBusy(null);
    }
  };

  const markDelivered = async (orderId: string) => {
    if (!confirm('배송 완료 처리하시겠습니까?')) return;
    setBusy(orderId);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.rpc('admin_mark_order_delivered', { p_order_id: orderId });
      if (error) throw error;
      showToast('배송 완료 처리됨');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '실패', 'warn');
    } finally {
      setBusy(null);
    }
  };

  if (authLoading || !isAdmin) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto pb-12">
      <div className="flex items-center gap-3 px-4 py-3 sticky top-0 bg-[var(--background)]/95 backdrop-blur z-10">
        <button onClick={() => router.back()} className="p-1 active:scale-90" aria-label="뒤로">
          <ArrowLeft size={24} />
        </button>
        <h1 className="text-xl font-bold flex-1">주문 관리</h1>
        <span className="text-xs text-[var(--muted)]">{orders.length}건</span>
      </div>

      {/* 필터 칩 */}
      <div className="flex gap-2 px-4 mb-3 overflow-x-auto pb-1">
        {(Object.keys(FILTER_LABELS) as StatusFilter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition active:scale-95 ${
              filter === f ? 'bg-[var(--accent)] text-white' : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
            }`}
          >
            {FILTER_LABELS[f]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-16">
          <Package size={40} className="mx-auto mb-3 text-[var(--muted)]" />
          <p className="text-sm text-[var(--muted)]">{FILTER_LABELS[filter]} 주문이 없어요</p>
        </div>
      ) : (
        <div className="px-4 space-y-3">
          {orders.map(o => (
            <div key={o.id} className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-bold">{o.order_no ?? o.id.slice(0, 8)}</p>
                  <p className="text-xs text-[var(--muted)] mt-0.5">
                    {new Date(o.created_at).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <span className={`text-xs font-bold ${orderStatusColor(o.status)}`}>
                  {orderStatusLabel(o.status)}
                </span>
              </div>

              <div className="text-sm text-[var(--muted)] space-y-0.5">
                <p>{o.shipping_name} ({o.shipping_phone})</p>
                <p className="text-xs">[{o.shipping_postal_code}] {o.shipping_address} {o.shipping_address_line2 ?? ''}</p>
                {o.shipping_memo && <p className="text-xs italic">메모: {o.shipping_memo}</p>}
              </div>

              <div className="mt-2 pt-2 border-t border-[var(--card-border)] flex items-center justify-between text-sm">
                <span className="text-[var(--muted)]">결제 금액</span>
                <span className="font-bold">{o.total_krw.toLocaleString()}원</span>
              </div>

              {o.tracking_no && (
                <p className="mt-2 text-xs text-[var(--muted)]">
                  📦 {o.tracking_carrier} {o.tracking_no}
                </p>
              )}

              {/* 액션 */}
              <div className="mt-3 flex gap-2">
                <Link
                  href={`/shop/order?id=${o.id}`}
                  className="flex-1 py-2 rounded-lg bg-[var(--card)] border border-[var(--card-border)] text-xs font-semibold text-center text-[var(--muted)]"
                >
                  상세
                </Link>
                {o.status === 'paid' && trackingFor !== o.id && (
                  <button
                    onClick={() => startTracking(o.id)}
                    className="flex-1 py-2 rounded-lg bg-emerald-500 text-white text-xs font-bold inline-flex items-center justify-center gap-1"
                  >
                    <Truck size={14} /> 발송 처리
                  </button>
                )}
                {o.status === 'shipped' && (
                  <button
                    onClick={() => markDelivered(o.id)}
                    disabled={busy === o.id}
                    className="flex-1 py-2 rounded-lg bg-blue-500 text-white text-xs font-bold inline-flex items-center justify-center gap-1 disabled:opacity-50"
                  >
                    <CheckCircle size={14} /> 배송완료
                  </button>
                )}
              </div>

              {/* 운송장 입력 폼 */}
              {trackingFor === o.id && (
                <div className="mt-3 space-y-2 p-3 rounded-lg bg-[var(--background)] border border-[var(--card-border)]">
                  <select
                    value={carrier}
                    onChange={e => setCarrier(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--card)] border border-[var(--card-border)] text-sm"
                  >
                    {CARRIERS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {carrier === '직접 입력' && (
                    <input
                      type="text" placeholder="택배사명"
                      value={carrierCustom}
                      onChange={e => setCarrierCustom(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-[var(--card)] border border-[var(--card-border)] text-sm"
                    />
                  )}
                  <input
                    type="text" placeholder="운송장 번호"
                    value={trackingNo}
                    onChange={e => setTrackingNo(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--card)] border border-[var(--card-border)] text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={cancelTracking}
                      className="flex-1 py-2 rounded-lg border border-[var(--card-border)] text-xs text-[var(--muted)]"
                    >
                      취소
                    </button>
                    <button
                      onClick={() => submitTracking(o.id)}
                      disabled={busy === o.id}
                      className="flex-1 py-2 rounded-lg bg-emerald-500 text-white text-xs font-bold disabled:opacity-50"
                    >
                      {busy === o.id ? '저장 중…' : '발송 확정'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2500} />}
    </div>
  );
}
