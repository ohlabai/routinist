'use client';

// 어드민 주문 관리 — 모던 모바일 UX/UI (에메랄드 그린).

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Truck, CheckCircle, Package, ChevronRight, ShoppingBag,
} from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { orderStatusLabel, orderStatusColor } from '@/lib/shop-data';
import AppToast from '@/components/AppToast';
import type { Order } from '@/types';

const ADMIN_EMAIL = 'hans@openhan.kr';
type StatusFilter = 'all' | 'pending' | 'paid' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';

const FILTER_LABELS: Record<StatusFilter, string> = {
  all: '전체', pending: '결제대기', paid: '결제완료',
  shipped: '배송중', delivered: '배송완료', cancelled: '취소', refunded: '환불',
};

const CARRIERS = ['CJ대한통운', '한진택배', '롯데택배', '우체국택배', '로젠택배', '직접 입력'];

export default function AdminOrdersPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = user?.email === ADMIN_EMAIL;
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
    } finally { setLoading(false); }
  }, [filter, isAdmin]);

  useEffect(() => { load(); }, [load]);

  const startTracking = (orderId: string) => {
    setTrackingFor(orderId);
    setCarrier(CARRIERS[0]); setCarrierCustom(''); setTrackingNo('');
  };
  const cancelTracking = () => setTrackingFor(null);

  const submitTracking = async (orderId: string) => {
    const carrierFinal = carrier === '직접 입력' ? carrierCustom.trim() : carrier;
    if (!carrierFinal || !trackingNo.trim()) {
      showToast('택배사와 운송장 번호를 입력해주세요', 'warn'); return;
    }
    setBusy(orderId);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.rpc('admin_mark_order_shipped', {
        p_order_id: orderId, p_carrier: carrierFinal, p_tracking_no: trackingNo.trim(),
      });
      if (error) throw error;
      showToast('배송 처리 완료');
      cancelTracking();
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '실패', 'warn');
    } finally { setBusy(null); }
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
    } finally { setBusy(null); }
  };

  if (authLoading || !isAdmin) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-extrabold tracking-tight flex-1">주문 관리</h1>
          <span className="text-xs text-[var(--muted)] font-medium">{orders.length}건</span>
        </div>
        {/* 필터 칩 */}
        <div className="flex gap-1.5 px-3 pb-3 overflow-x-auto scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
          {(Object.keys(FILTER_LABELS) as StatusFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition active:scale-95 ${
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

      {loading ? (
        <div className="px-4 pt-4 space-y-3">
          {[0,1,2].map(i => (
            <div key={i} className="card p-4 space-y-2 animate-pulse">
              <div className="h-3 w-1/3 bg-[var(--card-border)]/50 rounded" />
              <div className="h-4 w-2/3 bg-[var(--card-border)]/50 rounded" />
              <div className="h-3 w-1/2 bg-[var(--card-border)]/50 rounded" />
            </div>
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-20 px-6">
          <div className="w-20 h-20 rounded-full bg-emerald-50 dark:bg-emerald-950/30 mx-auto mb-4 flex items-center justify-center">
            <Package size={36} className="text-emerald-500" />
          </div>
          <p className="text-base font-bold mb-1">{FILTER_LABELS[filter]} 주문이 없어요</p>
          <p className="text-xs text-[var(--muted)]">필터를 변경하거나 잠시 후 다시 확인해주세요</p>
        </div>
      ) : (
        <div className="px-4 pt-4 space-y-2.5">
          {orders.map(o => (
            <div key={o.id} className="card p-4">
              {/* 주문 헤더 */}
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-extrabold">{o.order_no ?? o.id.slice(0, 8)}</p>
                  <p className="text-[11px] text-[var(--muted)]">
                    {new Date(o.created_at).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <span className={`text-[11px] font-extrabold px-2.5 py-1 rounded-full bg-[var(--card-border)]/40 ${orderStatusColor(o.status)}`}>
                  {orderStatusLabel(o.status)}
                </span>
              </div>

              {/* 배송지 */}
              <div className="text-xs space-y-0.5">
                <p className="font-semibold">{o.shipping_name} <span className="text-[var(--muted)] font-normal">({o.shipping_phone})</span></p>
                <p className="text-[var(--muted)]">[{o.shipping_postal_code}] {o.shipping_address} {o.shipping_address_line2 ?? ''}</p>
                {o.shipping_memo && <p className="text-[var(--muted)] italic">메모: {o.shipping_memo}</p>}
              </div>

              {/* 결제 금액 */}
              <div className="mt-2 pt-2 border-t border-[var(--card-border)]/40 flex items-center justify-between">
                <span className="text-xs text-[var(--muted)]">결제 금액</span>
                <span className="text-base font-extrabold text-emerald-600">{o.total_krw.toLocaleString()}원</span>
              </div>

              {/* 운송장 (있을 때만) */}
              {o.tracking_no && (
                <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                  <Truck size={11} /> {o.tracking_carrier} {o.tracking_no}
                </div>
              )}

              {/* 액션 */}
              <div className="mt-3 flex gap-2">
                <Link
                  href={`/shop/order?id=${o.id}`}
                  className="flex-1 py-2 rounded-xl bg-[var(--card-border)]/30 text-xs font-bold text-center text-[var(--muted)] active:scale-95"
                >
                  상세
                </Link>
                {o.status === 'paid' && trackingFor !== o.id && (
                  <button
                    onClick={() => startTracking(o.id)}
                    className="flex-1 py-2 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-xs font-extrabold inline-flex items-center justify-center gap-1 active:scale-95 shadow-sm shadow-emerald-500/30"
                  >
                    <Truck size={13} /> 발송 처리
                  </button>
                )}
                {o.status === 'shipped' && (
                  <button
                    onClick={() => markDelivered(o.id)}
                    disabled={busy === o.id}
                    className="flex-1 py-2 rounded-xl bg-blue-500 text-white text-xs font-extrabold inline-flex items-center justify-center gap-1 active:scale-95 disabled:opacity-50"
                  >
                    <CheckCircle size={13} /> 배송완료
                  </button>
                )}
              </div>

              {/* 운송장 입력 폼 */}
              {trackingFor === o.id && (
                <div className="mt-3 space-y-2 p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/20 border-2 border-emerald-200 dark:border-emerald-900/40">
                  <select
                    value={carrier} onChange={e => setCarrier(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--background)] border-2 border-[var(--card-border)] text-sm font-medium focus:outline-none focus:border-emerald-500"
                  >
                    {CARRIERS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {carrier === '직접 입력' && (
                    <input
                      type="text" placeholder="택배사명"
                      value={carrierCustom} onChange={e => setCarrierCustom(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-[var(--background)] border-2 border-[var(--card-border)] text-sm font-medium focus:outline-none focus:border-emerald-500"
                    />
                  )}
                  <input
                    type="text" placeholder="운송장 번호"
                    value={trackingNo} onChange={e => setTrackingNo(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--background)] border-2 border-[var(--card-border)] text-sm font-medium focus:outline-none focus:border-emerald-500"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={cancelTracking}
                      className="flex-1 py-2 rounded-xl border border-[var(--card-border)] text-xs font-bold text-[var(--muted)] active:scale-95"
                    >
                      취소
                    </button>
                    <button
                      onClick={() => submitTracking(o.id)}
                      disabled={busy === o.id}
                      className="flex-1 py-2 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-xs font-extrabold disabled:opacity-50 active:scale-95"
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

      <style jsx>{`:global(.scrollbar-hide::-webkit-scrollbar) { display: none; }`}</style>
    </div>
  );
}
