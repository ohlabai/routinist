'use client';

// 결제 — 모던 모바일 UX/UI (에메랄드 그린).
// 흐름: 배송지 선택 → 상품 확인 → 마일리지 사용 → 토스 결제

import { useEffect, useState, Suspense, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, MapPin, Plus, Coins, Package, Check, ShieldCheck, FileText, ChevronRight, CreditCard,
} from 'lucide-react';

function CreditCardIcon() { return <CreditCard size={16} className="text-emerald-500" />; }
import {
  fetchCart, fetchAddresses, createAddress, createOrderDraft,
  validatePhone, validatePostalCode,
  type OrderDraftItem, type NewAddressInput,
} from '@/lib/shop-data';
import { fetchMileageBalance } from '@/lib/mileage-data';
import { useAuth } from '@/components/AuthProvider';
import AppToast from '@/components/AppToast';
import BusinessFooter from '@/components/shop/BusinessFooter';
import type { CartItem, ShippingAddress } from '@/types';

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
  // 토스 SDK v1 이 직접 받는 결제수단만 노출. 카드 진입 후 결제창에서 카카오페이·네이버페이 선택 가능.
  type PayMethod = '카드' | '계좌이체' | '가상계좌' | '휴대폰' | '토스페이';
  const [payMethod, setPayMethod] = useState<PayMethod>('카드');

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

    Promise.all([loadCart(), fetchAddresses(), fetchMileageBalance(user.id)])
      .then(([cart, addrs, mb]) => {
        if (cancelled) return;
        setCartItems(cart);
        setAddresses(addrs);
        const def = addrs.find(a => a.is_default) ?? addrs[0];
        if (def) setSelectedAddressId(def.id);
        setMileageBalance(mb);
      })
      .catch(e => { if (!cancelled) console.warn('[checkout] load fail', e); })
      .finally(() => { if (!cancelled) setLoading(false); });
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

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok', ms = 2500) => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), ms);
  };

  const handleSaveAddress = async () => {
    if (!newAddr.recipient_name.trim() || !newAddr.phone.trim() || !newAddr.address_line1.trim() || !newAddr.postal_code.trim()) {
      showToast('필수 항목을 모두 입력해주세요', 'warn');
      return;
    }
    if (!validatePhone(newAddr.phone)) {
      showToast('전화번호 형식이 올바르지 않아요\n예) 010-1234-5678', 'warn', 3500);
      return;
    }
    if (!validatePostalCode(newAddr.postal_code)) {
      showToast('우편번호는 5자리 숫자예요', 'warn');
      return;
    }
    try {
      const created = await createAddress(newAddr);
      setAddresses(prev => [created, ...prev.map(a => created.is_default ? { ...a, is_default: false } : a)]);
      setSelectedAddressId(created.id);
      setAddressFormOpen(false);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '저장 실패', 'warn');
    }
  };

  const handlePay = async () => {
    if (!user || !selectedAddress || cartItems.length === 0) return;
    if (totals.total < 0) { showToast('결제 금액 오류', 'warn'); return; }
    setSubmitting(true);
    try {
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

      if (draft.total_krw === 0) {
        showToast('0원 결제는 준비 중이에요', 'warn', 3500);
        setSubmitting(false);
        return;
      }

      const tossClientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
      if (!tossClientKey) {
        showToast('조금만 기다려주세요\n다음주 정식 런칭 후 살 수 있어요 ✨', 'warn', 4000);
        setSubmitting(false);
        return;
      }

      const { loadTossPayments } = await import('@tosspayments/payment-sdk');
      const tossPayments = await loadTossPayments(tossClientKey);

      const customerName = (user.user_metadata?.name as string) || (user.email?.split('@')[0]) || '고객';
      const successUrl = `${window.location.origin}/shop/payment/success?orderUuid=${draft.order_id}`;
      const failUrl = `${window.location.origin}/shop/payment/fail?orderUuid=${draft.order_id}`;

      await tossPayments.requestPayment(payMethod, {
        amount: draft.total_krw,
        orderId: draft.order_no,
        orderName: cartItems.length === 1
          ? (cartItems[0].product?.name ?? '상품')
          : `${cartItems[0].product?.name ?? '상품'} 외 ${cartItems.length - 1}건`,
        customerName,
        customerEmail: user.email ?? undefined,
        successUrl,
        failUrl,
      });
    } catch (e) {
      console.warn('[checkout] payment fail', e);
      showToast(e instanceof Error ? e.message : '결제 시작 실패', 'warn', 3000);
      setSubmitting(false);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (cartItems.length === 0) {
    return (
      <div className="max-w-lg mx-auto px-6 py-20 text-center bg-[var(--background)] min-h-screen">
        <button onClick={() => router.back()} className="absolute top-4 left-4 w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90">
          <ArrowLeft size={20} />
        </button>
        <div className="w-20 h-20 rounded-full bg-emerald-50 dark:bg-emerald-950/30 mx-auto mb-4 flex items-center justify-center">
          <Package size={36} className="text-emerald-500" />
        </div>
        <p className="text-base font-bold mb-1">결제할 상품이 없어요</p>
        <Link href="/shop" className="inline-flex mt-5 px-5 py-2.5 rounded-full bg-emerald-500 text-white text-sm font-bold active:scale-95">
          쇼핑하러 가기
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto pb-32 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <button
            onClick={() => router.back()}
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition"
            aria-label="뒤로"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-extrabold tracking-tight">결제</h1>
        </div>
      </header>

      {/* 토스 미설정 시 상시 안내 배너 */}
      {!process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY && (
        <div className="px-4 pt-3">
          <div className="card p-3.5 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 border-amber-200/60 dark:border-amber-900/40 inline-flex items-start gap-2.5 w-full">
            <span className="text-base">✨</span>
            <div className="flex-1">
              <p className="text-xs font-extrabold text-amber-700 dark:text-amber-300 mb-0.5">정식 런칭 임박</p>
              <p className="text-[11px] text-[var(--muted)] leading-relaxed">
                다음주 정식 런칭 후 결제가 열려요. 그때까지 둘러보기 + 장바구니에 미리 담아두기는 모두 가능합니다 ✨
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 배송지 */}
      <Section title="배송지" icon={<MapPin size={16} className="text-emerald-500" />}>
        {addresses.length > 0 && !addressFormOpen && selectedAddress && (
          <>
            <div className="card p-4 mb-2 border-2 border-emerald-200 dark:border-emerald-900/40 bg-gradient-to-br from-emerald-50/30 to-transparent dark:from-emerald-950/10">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <p className="text-sm font-extrabold">{selectedAddress.recipient_name}</p>
                    {selectedAddress.label && (
                      <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40">
                        {selectedAddress.label}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--muted)]">{selectedAddress.phone}</p>
                </div>
                {addresses.length > 1 && (
                  <button
                    onClick={() => {
                      const next = addresses.find(a => a.id !== selectedAddressId);
                      if (next) setSelectedAddressId(next.id);
                    }}
                    className="text-xs font-bold text-emerald-600 active:scale-95"
                  >
                    변경
                  </button>
                )}
              </div>
              <p className="text-xs text-[var(--foreground)] leading-relaxed">
                [{selectedAddress.postal_code}] {selectedAddress.address_line1} {selectedAddress.address_line2 ?? ''}
              </p>
            </div>
            <button
              onClick={() => setAddressFormOpen(true)}
              className="text-xs font-bold text-emerald-600 inline-flex items-center gap-0.5 active:scale-95"
            >
              <Plus size={12} /> 새 배송지 추가
            </button>
          </>
        )}

        {(addresses.length === 0 || addressFormOpen) && (
          <div className="card p-4 space-y-2">
            <Field>
              <input type="text" placeholder="별칭 (집, 회사 등)"
                value={newAddr.label ?? ''}
                onChange={e => setNewAddr({ ...newAddr, label: e.target.value })}
              />
            </Field>
            <Field>
              <input type="text" placeholder="받는 사람 이름 *"
                value={newAddr.recipient_name}
                onChange={e => setNewAddr({ ...newAddr, recipient_name: e.target.value })}
              />
            </Field>
            <Field>
              <input type="tel" placeholder="연락처 (010-1234-5678) *"
                value={newAddr.phone}
                onChange={e => setNewAddr({ ...newAddr, phone: e.target.value })}
              />
            </Field>
            <Field>
              <input type="text" placeholder="우편번호 *"
                value={newAddr.postal_code}
                onChange={e => setNewAddr({ ...newAddr, postal_code: e.target.value })}
              />
            </Field>
            <Field>
              <input type="text" placeholder="기본 주소 *"
                value={newAddr.address_line1}
                onChange={e => setNewAddr({ ...newAddr, address_line1: e.target.value })}
              />
            </Field>
            <Field>
              <input type="text" placeholder="상세 주소 (선택)"
                value={newAddr.address_line2 ?? ''}
                onChange={e => setNewAddr({ ...newAddr, address_line2: e.target.value })}
              />
            </Field>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSaveAddress}
                className="flex-1 py-2.5 rounded-2xl bg-emerald-500 text-white text-sm font-bold active:scale-[0.98]"
              >
                저장
              </button>
              {addresses.length > 0 && (
                <button
                  onClick={() => setAddressFormOpen(false)}
                  className="px-5 py-2.5 rounded-2xl border border-[var(--card-border)] text-sm text-[var(--muted)] active:scale-[0.98]"
                >
                  취소
                </button>
              )}
            </div>
          </div>
        )}
      </Section>

      {/* 주문 상품 */}
      <Section title={`주문 상품 ${cartItems.length}`} icon={<Package size={16} className="text-emerald-500" />}>
        <div className="card p-4 space-y-3">
          {cartItems.map(it => {
            const unit = (it.product?.price_krw ?? 0) + (it.variant?.price_delta_krw ?? 0);
            return (
              <div key={it.id} className="flex gap-3 items-center">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950 overflow-hidden flex-shrink-0">
                  {it.product?.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.product.thumbnail_url} alt={it.product.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[var(--muted)]"><Package size={20} /></div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--foreground)] line-clamp-1">{it.product?.name}</p>
                  {it.variant?.option_value && (
                    <p className="text-[10px] text-[var(--muted)] mt-0.5 inline-block px-1.5 py-0.5 rounded bg-[var(--card-border)]/40">
                      {it.variant.option_value}
                    </p>
                  )}
                  <p className="text-xs text-[var(--muted)] mt-0.5">{it.quantity}개 · {(unit * it.quantity).toLocaleString()}원</p>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* 마일리지 */}
      <Section title="마일리지" icon={<Coins size={16} className="text-emerald-500" />} extra={
        <span className="text-xs text-[var(--muted)]">보유 <span className="font-bold text-emerald-600">{mileageBalance.toLocaleString()}P</span></span>
      }>
        <div className="card p-4">
          <div className="flex gap-2 mb-2">
            <input
              type="number" min={0} max={totals.maxMileage}
              value={mileageUseInput || ''}
              onChange={e => setMileageUseInput(Math.max(0, Math.min(totals.maxMileage, parseInt(e.target.value) || 0)))}
              placeholder="0"
              className="flex-1 px-4 py-2.5 rounded-xl bg-[var(--background)] border-2 border-[var(--card-border)] text-sm font-bold text-[var(--foreground)] focus:outline-none focus:border-emerald-500"
            />
            <button
              onClick={() => setMileageUseInput(totals.maxMileage)}
              className="px-4 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-xs font-extrabold active:scale-95"
            >
              모두 사용
            </button>
          </div>
          {totals.mileageUse > 0 && (
            <p className="text-[11px] text-emerald-600 font-bold">
              ✓ {totals.mileageUse.toLocaleString()}P 사용 → 결제 후 잔액 {(mileageBalance - totals.mileageUse).toLocaleString()}P
            </p>
          )}
        </div>
      </Section>

      {/* 결제 수단 */}
      <Section title="결제 수단" icon={<CreditCardIcon />}>
        <div className="card p-3.5">
          <div className="grid grid-cols-3 gap-2">
            {(['카드', '토스페이', '계좌이체', '가상계좌', '휴대폰'] as const).map(m => (
              <button
                key={m}
                onClick={() => setPayMethod(m)}
                className={`py-2.5 px-2 rounded-xl text-xs font-extrabold transition active:scale-95 border-2 ${
                  payMethod === m
                    ? 'bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-500/25'
                    : 'bg-[var(--card)] border-[var(--card-border)] text-[var(--foreground)]'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {/* 결제 금액 */}
      <Section title="결제 정보" icon={<FileText size={16} className="text-emerald-500" />}>
        <div className="card p-5 space-y-2.5 bg-gradient-to-br from-emerald-50/30 to-transparent dark:from-emerald-950/10">
          <Row label="상품 금액" value={`${totals.subtotal.toLocaleString()}원`} />
          <Row label="배송비" value={totals.shipping === 0 ? '무료 🎉' : `${totals.shipping.toLocaleString()}원`} highlight={totals.shipping === 0} />
          {totals.mileageUse > 0 && (
            <Row label="마일리지 사용" value={`-${totals.mileageUse.toLocaleString()}P`} negative />
          )}
          <div className="pt-3 border-t border-emerald-200/40 dark:border-emerald-900/30 flex justify-between items-baseline">
            <span className="text-sm font-bold">최종 결제 금액</span>
            <span className="text-2xl font-extrabold text-emerald-600">{totals.total.toLocaleString()}원</span>
          </div>
        </div>
      </Section>

      {/* 약관 동의 */}
      <div className="px-4 mt-4">
        <div className="card p-3.5 flex items-start gap-2">
          <ShieldCheck size={14} className="text-emerald-500 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-[var(--muted)] leading-relaxed">
            결제 시{' '}
            <a href="/shop/terms" target="_blank" className="text-emerald-600 underline font-bold">이용약관</a>{', '}
            <a href="/shop/refund" target="_blank" className="text-emerald-600 underline font-bold">취소·환불 정책</a>{', '}
            <a href="/privacy" target="_blank" className="text-emerald-600 underline font-bold">개인정보처리방침</a>에 동의합니다
          </p>
        </div>
      </div>

      <BusinessFooter variant="full" />

      {/* Sticky CTA — bottom-16 으로 5탭 nav (h-16, z-40) 위에 배치. z-50 으로 nav 덮음 */}
      <div className="fixed bottom-16 left-1/2 -translate-x-1/2 max-w-lg w-full bg-[var(--background)]/95 backdrop-blur-lg border-t border-[var(--card-border)]/30 z-50">
        <div className="p-3">
          <button
            onClick={handlePay}
            disabled={submitting || !selectedAddress || cartItems.length === 0}
            className="w-full py-4 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-base active:scale-[0.98] disabled:opacity-50 inline-flex items-center justify-center gap-2 shadow-md shadow-emerald-500/30"
          >
            {submitting ? (
              <>
                <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                결제 진행 중…
              </>
            ) : (
              <>
                <Check size={18} />
                {totals.total.toLocaleString()}원 결제하기
                <ChevronRight size={18} />
              </>
            )}
          </button>
        </div>
      </div>

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={3000} />}
    </div>
  );
}

function Section({ title, icon, extra, children }: { title: string; icon?: React.ReactNode; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="px-4 mt-4">
      <div className="flex items-center justify-between mb-2.5">
        <h2 className="text-sm font-extrabold inline-flex items-center gap-1.5">{icon}{title}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

function Field({ children }: { children: React.ReactElement<React.InputHTMLAttributes<HTMLInputElement>> }) {
  const className = 'w-full px-3.5 py-2.5 rounded-xl bg-[var(--background)] border-2 border-[var(--card-border)] text-sm focus:outline-none focus:border-emerald-500 transition';
  return <div>{ React.cloneElement(children, { className }) }</div>;
}
import React from 'react';

function Row({ label, value, highlight, negative }: { label: string; value: string; highlight?: boolean; negative?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <span className={`font-bold ${highlight ? 'text-emerald-600' : negative ? 'text-orange-500' : 'text-[var(--foreground)]'}`}>{value}</span>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    }>
      <CheckoutContent />
    </Suspense>
  );
}
