'use client';

// 결제 — 배송지 선택 + 마일리지 사용 + 토스 SDK 결제 호출.
// mode=cart  : 장바구니 전체
// mode=buyNow: sessionStorage 의 buyNowItem 1건만

import { useEffect, useState, Suspense, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, MapPin, Plus, Coins, Package, Check } from 'lucide-react';
import {
  fetchCart, fetchAddresses, createAddress, createOrderDraft,
  type OrderDraftItem, type NewAddressInput,
} from '@/lib/shop-data';
import type { CartItem, ShippingAddress } from '@/types';
import { fetchMileageBalance } from '@/lib/mileage-data';
import { useAuth } from '@/components/AuthProvider';
import AppToast from '@/components/AppToast';

function CheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode') === 'buyNow' ? 'buyNow' : 'cart';
  const { user, loading: authLoading } = useAuth();

  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [addresses, setAddresses] = useState<ShippingAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [mileageBalance, setMileageBalance] = useState(0);
  const [mileageUseInput, setMileageUseInput] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const [addressFormOpen, setAddressFormOpen] = useState(false);
  const [newAddr, setNewAddr] = useState<NewAddressInput>({
    recipient_name: '', phone: '', postal_code: '', address_line1: '',
    address_line2: '', is_default: true, label: '집',
  });

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }

    let cancelled = false;
    const loadCart = async (): Promise<CartItem[]> => {
      if (mode === 'buyNow') {
        const raw = sessionStorage.getItem('buyNowItem');
        if (!raw) return [];
        try {
          const buyNow = JSON.parse(raw) as OrderDraftItem;
          // buyNow 도 표시 위해 cart 형식으로 변환 — product/variant 정보 채우기
          const { fetchProduct, fetchProductVariants } = await import('@/lib/shop-data');
          const [p, vs] = await Promise.all([
            fetchProduct(buyNow.product_id),
            buyNow.variant_id ? fetchProductVariants(buyNow.product_id) : Promise.resolve([]),
          ]);
          if (!p) return [];
          const variant = buyNow.variant_id ? vs.find(v => v.id === buyNow.variant_id) ?? null : null;
          return [{
            id: 'buynow',
            user_id: user.id,
            product_id: p.id,
            variant_id: buyNow.variant_id ?? null,
            quantity: buyNow.quantity,
            added_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            product: p,
            variant,
          }];
        } catch { return []; }
      }
      return await fetchCart();
    };

    Promise.all([
      loadCart(),
      fetchAddresses(),
      fetchMileageBalance(user.id),
    ]).then(([cart, addrs, mb]) => {
      if (cancelled) return;
      setCartItems(cart);
      setAddresses(addrs);
      const def = addrs.find(a => a.is_default) ?? addrs[0];
      if (def) setSelectedAddressId(def.id);
      setMileageBalance(mb);
    }).catch(e => {
      if (!cancelled) console.warn('[checkout] load fail', e);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [authLoading, user, mode, router]);

  const totals = useMemo(() => {
    let subtotal = 0;
    for (const it of cartItems) {
      const unit = (it.product?.price_krw ?? 0) + (it.variant?.price_delta_krw ?? 0);
      subtotal += unit * it.quantity;
    }
    const shipping = subtotal > 0 && subtotal < 50000 ? 3000 : 0;
    const beforeMileage = subtotal + shipping;
    const maxMileage = Math.min(mileageBalance, beforeMileage);
    const mileageUse = Math.max(0, Math.min(mileageUseInput, maxMileage));
    const total = beforeMileage - mileageUse;
    return { subtotal, shipping, beforeMileage, mileageUse, maxMileage, total };
  }, [cartItems, mileageBalance, mileageUseInput]);

  const selectedAddress = addresses.find(a => a.id === selectedAddressId) ?? null;

  const handleSaveAddress = async () => {
    if (!newAddr.recipient_name.trim() || !newAddr.phone.trim() || !newAddr.address_line1.trim() || !newAddr.postal_code.trim()) {
      setToast({ text: '필수 항목을 모두 입력해주세요', tone: 'warn' });
      setTimeout(() => setToast(null), 2500);
      return;
    }
    try {
      const created = await createAddress(newAddr);
      setAddresses(prev => [created, ...prev.map(a => created.is_default ? { ...a, is_default: false } : a)]);
      setSelectedAddressId(created.id);
      setAddressFormOpen(false);
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : '저장 실패', tone: 'warn' });
      setTimeout(() => setToast(null), 2500);
    }
  };

  const handlePay = async () => {
    if (!user || !selectedAddress || cartItems.length === 0) return;
    if (totals.total < 0) {
      setToast({ text: '결제 금액 오류', tone: 'warn' });
      return;
    }
    setSubmitting(true);
    try {
      // 1) 주문서 (pending) 생성
      const items: OrderDraftItem[] = cartItems.map(it => ({
        product_id: it.product_id,
        variant_id: it.variant_id ?? null,
        quantity: it.quantity,
      }));
      const draft = await createOrderDraft(items, {
        recipient: selectedAddress.recipient_name,
        phone: selectedAddress.phone,
        postal_code: selectedAddress.postal_code,
        address_line1: selectedAddress.address_line1,
        address_line2: selectedAddress.address_line2 ?? undefined,
      }, totals.mileageUse);

      // 2) 마일리지 100% 결제 (total=0) 면 토스 SDK 우회 — 직접 mark_order_paid 호출 위해
      //    별도 API endpoint /api/orders/finalize-zero 가 필요. 일단 0원 결제는 비허용 안내.
      if (draft.total_krw === 0) {
        setToast({ text: '0원 결제는 준비 중이에요. 일부 마일리지로 사용해주세요', tone: 'warn' });
        setTimeout(() => setToast(null), 3500);
        setSubmitting(false);
        return;
      }

      // 3) 토스 SDK 호출
      const tossClientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
      if (!tossClientKey) {
        setToast({ text: '결제 서비스 설정이 필요합니다', tone: 'warn' });
        setTimeout(() => setToast(null), 3500);
        setSubmitting(false);
        return;
      }

      const { loadTossPayments } = await import('@tosspayments/payment-sdk');
      const tossPayments = await loadTossPayments(tossClientKey);

      const customerName = (user.user_metadata?.name as string) || (user.email?.split('@')[0]) || '고객';
      const successUrl = `${window.location.origin}/shop/payment/success?orderUuid=${draft.order_id}`;
      const failUrl = `${window.location.origin}/shop/payment/fail?orderUuid=${draft.order_id}`;

      // 결제창 띄움 (모달 또는 redirect)
      await tossPayments.requestPayment('카드', {
        amount: draft.total_krw,
        orderId: draft.order_no,
        orderName: cartItems.length === 1
          ? `${cartItems[0].product?.name ?? '상품'} ${cartItems[0].quantity > 1 ? `외 ${cartItems[0].quantity - 1}` : ''}`.trim()
          : `${cartItems[0].product?.name ?? '상품'} 외 ${cartItems.length - 1}건`,
        customerName,
        customerEmail: user.email ?? undefined,
        successUrl,
        failUrl,
      });
      // 결제창에서 사용자가 카드 입력 → success/fail URL 로 redirect → 거기서 confirm 호출
    } catch (e) {
      console.warn('[checkout] payment fail', e);
      const msg = e instanceof Error ? e.message : '결제 시작 실패';
      setToast({ text: msg, tone: 'warn' });
      setTimeout(() => setToast(null), 3000);
      setSubmitting(false);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (cartItems.length === 0) {
    return (
      <div className="max-w-lg mx-auto p-4 text-center">
        <button onClick={() => router.back()} className="inline-flex items-center gap-2 text-[var(--muted)] mb-4">
          <ArrowLeft size={20} /> 뒤로
        </button>
        <p className="text-sm text-[var(--muted)] mt-12">결제할 상품이 없어요</p>
        <Link href="/shop" className="inline-block mt-4 text-sm text-[var(--accent)] font-semibold">쇼핑하러 가기</Link>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto pb-32">
      <div className="flex items-center gap-3 px-4 py-3 sticky top-0 bg-[var(--background)]/95 backdrop-blur z-10">
        <button onClick={() => router.back()} className="p-1 active:scale-90" aria-label="뒤로">
          <ArrowLeft size={24} className="text-[var(--foreground)]" />
        </button>
        <h1 className="text-xl font-bold text-[var(--foreground)] flex-1">결제</h1>
      </div>

      {/* 배송지 */}
      <div className="px-4 mt-2">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-[var(--foreground)] flex items-center gap-1.5">
              <MapPin size={16} /> 배송지
            </h2>
            {addresses.length > 0 && !addressFormOpen && (
              <button
                onClick={() => setAddressFormOpen(true)}
                className="text-xs text-[var(--accent)] font-semibold inline-flex items-center gap-1"
              >
                <Plus size={14} /> 새 주소
              </button>
            )}
          </div>

          {addresses.length === 0 || addressFormOpen ? (
            <div className="space-y-2">
              <input
                type="text" placeholder="받는 사람 이름"
                value={newAddr.recipient_name}
                onChange={e => setNewAddr({ ...newAddr, recipient_name: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm"
              />
              <input
                type="tel" placeholder="연락처 (010-1234-5678)"
                value={newAddr.phone}
                onChange={e => setNewAddr({ ...newAddr, phone: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm"
              />
              <input
                type="text" placeholder="우편번호"
                value={newAddr.postal_code}
                onChange={e => setNewAddr({ ...newAddr, postal_code: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm"
              />
              <input
                type="text" placeholder="기본 주소"
                value={newAddr.address_line1}
                onChange={e => setNewAddr({ ...newAddr, address_line1: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm"
              />
              <input
                type="text" placeholder="상세 주소 (선택)"
                value={newAddr.address_line2 ?? ''}
                onChange={e => setNewAddr({ ...newAddr, address_line2: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm"
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={handleSaveAddress}
                  className="flex-1 py-2 rounded-lg bg-emerald-500 text-white text-sm font-bold active:scale-95"
                >
                  저장
                </button>
                {addresses.length > 0 && (
                  <button
                    onClick={() => setAddressFormOpen(false)}
                    className="px-4 py-2 rounded-lg border border-[var(--card-border)] text-sm text-[var(--muted)]"
                  >
                    취소
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {addresses.map(a => (
                <button
                  key={a.id}
                  onClick={() => setSelectedAddressId(a.id)}
                  className={`w-full text-left p-3 rounded-xl border-2 transition ${
                    a.id === selectedAddressId
                      ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20'
                      : 'border-[var(--card-border)] bg-[var(--background)]'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-bold text-[var(--foreground)]">{a.recipient_name}</p>
                    {a.label && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--card-border)]/60">
                        {a.label}
                      </span>
                    )}
                    {a.is_default && (
                      <span className="text-xs text-emerald-600 font-semibold">기본</span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--muted)]">{a.phone}</p>
                  <p className="text-xs text-[var(--foreground)] mt-0.5">
                    [{a.postal_code}] {a.address_line1} {a.address_line2 ?? ''}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 주문 상품 */}
      <div className="px-4 mt-3">
        <div className="card p-4">
          <h2 className="text-sm font-bold text-[var(--foreground)] mb-3">주문 상품 ({cartItems.length})</h2>
          <div className="space-y-3">
            {cartItems.map(it => {
              const unit = (it.product?.price_krw ?? 0) + (it.variant?.price_delta_krw ?? 0);
              return (
                <div key={it.id} className="flex gap-3">
                  <div className="w-14 h-14 rounded-lg bg-[var(--card-border)] overflow-hidden flex-shrink-0">
                    {it.product?.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.product.thumbnail_url} alt={it.product.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[var(--muted)]"><Package size={20} /></div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--foreground)] line-clamp-1">{it.product?.name}</p>
                    {it.variant?.option_value && (
                      <p className="text-xs text-[var(--muted)]">{it.variant.option_value}</p>
                    )}
                    <p className="text-xs text-[var(--muted)] mt-0.5">{it.quantity}개 · {(unit * it.quantity).toLocaleString()}원</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 마일리지 */}
      <div className="px-4 mt-3">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-[var(--foreground)] flex items-center gap-1.5">
              <Coins size={16} /> 마일리지 사용
            </h2>
            <span className="text-xs text-[var(--muted)]">보유 {mileageBalance.toLocaleString()}P</span>
          </div>
          <div className="flex gap-2">
            <input
              type="number" min={0} max={totals.maxMileage}
              value={mileageUseInput || ''}
              onChange={e => setMileageUseInput(Math.max(0, Math.min(totals.maxMileage, parseInt(e.target.value) || 0)))}
              placeholder="0"
              className="flex-1 px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm"
            />
            <button
              onClick={() => setMileageUseInput(totals.maxMileage)}
              className="px-3 py-2 rounded-lg border border-[var(--card-border)] text-xs font-semibold text-[var(--muted)]"
            >
              모두 사용
            </button>
          </div>
        </div>
      </div>

      {/* 합계 */}
      <div className="px-4 mt-3">
        <div className="card p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-[var(--muted)]">상품 금액</span>
            <span>{totals.subtotal.toLocaleString()}원</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[var(--muted)]">배송비</span>
            <span>{totals.shipping === 0 ? '무료' : `${totals.shipping.toLocaleString()}원`}</span>
          </div>
          {totals.mileageUse > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-[var(--muted)]">마일리지 사용</span>
              <span className="text-orange-500">- {totals.mileageUse.toLocaleString()}P</span>
            </div>
          )}
          <div className="pt-2 border-t border-[var(--card-border)] flex justify-between items-baseline">
            <span className="text-sm font-semibold">최종 결제 금액</span>
            <span className="text-2xl font-extrabold text-[var(--accent)]">{totals.total.toLocaleString()}원</span>
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-[var(--background)] border-t border-[var(--card-border)] safe-area-bottom">
        <div className="max-w-lg mx-auto p-3">
          <button
            onClick={handlePay}
            disabled={submitting || !selectedAddress || cartItems.length === 0}
            className="w-full py-3.5 rounded-xl bg-emerald-500 text-white font-bold text-base active:scale-95 disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            {submitting ? '결제 진행 중…' : <><Check size={18} /> {totals.total.toLocaleString()}원 결제하기</>}
          </button>
        </div>
      </div>

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={3000} />}
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
      </div>
    }>
      <CheckoutContent />
    </Suspense>
  );
}
