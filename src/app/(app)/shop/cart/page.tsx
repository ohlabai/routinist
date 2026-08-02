'use client';

// 장바구니 — 모던 모바일 UX/UI (에메랄드 그린).

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Trash2, Plus, Minus, Package, ShoppingBag, Sparkles, ChevronRight,
} from 'lucide-react';
import { fetchCart, updateCartQuantity, removeFromCart } from '@/lib/shop-data';
import { useAuth } from '@/components/AuthProvider';
import AppToast from '@/components/AppToast';
import BusinessFooter from '@/components/shop/BusinessFooter';
import { useI18n, formatKrw } from '@/lib/i18n';
import type { CartItem } from '@/types';

export default function CartPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { tt, locale } = useI18n();
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    let cancelled = false;
    fetchCart()
      .then(c => { if (!cancelled) setItems(c); })
      .catch(e => { if (!cancelled) console.warn('[cart] load fail', e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user, authLoading, router]);

  const totals = useMemo(() => {
    let subtotal = 0;
    let count = 0;
    for (const it of items) {
      const unit = (it.product?.price_krw ?? 0) + (it.variant?.price_delta_krw ?? 0);
      subtotal += unit * it.quantity;
      count += it.quantity;
    }
    const shipping = subtotal > 0 && subtotal < 50000 ? 3000 : 0;
    return { subtotal, shipping, total: subtotal + shipping, count };
  }, [items]);

  const showToast = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 2500);
  };

  const handleQty = async (itemId: string, next: number) => {
    setBusy(itemId);
    try {
      if (next < 1) {
        await removeFromCart(itemId);
        setItems(prev => prev.filter(i => i.id !== itemId));
      } else {
        const item = items.find(i => i.id === itemId);
        const stock = item?.variant?.stock ?? item?.product?.stock ?? 99;
        if (next > stock) {
          showToast(`${tt('재고가 부족해요')} (max ${stock})`);
          return;
        }
        await updateCartQuantity(itemId, next);
        setItems(prev => prev.map(i => i.id === itemId ? { ...i, quantity: next } : i));
      }
    } catch (e) {
      console.warn('[cart] update fail', e);
      showToast(tt('실패했어요. 다시 시도해주세요'));
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async (itemId: string) => {
    if (!confirm(tt('장바구니에서 빼시겠어요?'))) return;
    setBusy(itemId);
    try {
      await removeFromCart(itemId);
      setItems(prev => prev.filter(i => i.id !== itemId));
    } catch (e) {
      console.warn('[cart] remove fail', e);
    } finally {
      setBusy(null);
    }
  };

  const handleCheckout = () => {
    if (items.length === 0) return;
    router.push('/shop/checkout?mode=cart');
  };

  const progressToFreeShipping = useMemo(() => {
    if (totals.subtotal === 0 || totals.subtotal >= 50000) return null;
    const remaining = 50000 - totals.subtotal;
    const pct = Math.min(100, (totals.subtotal / 50000) * 100);
    return { remaining, pct };
  }, [totals.subtotal]);

  if (loading) {
    return (
      <div className="max-w-lg mx-auto pb-32">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="w-9 h-9 rounded-full bg-[var(--card)] animate-pulse" />
          <div className="h-6 w-32 bg-[var(--card)] rounded animate-pulse" />
        </div>
        <div className="px-4 space-y-3">
          {[0,1,2].map(i => (
            <div key={i} className="card p-3 flex gap-3">
              <div className="w-20 h-20 rounded-xl bg-[var(--card-border)]/50 animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-3/4 bg-[var(--card-border)]/50 rounded animate-pulse" />
                <div className="h-3 w-1/2 bg-[var(--card-border)]/50 rounded animate-pulse" />
                <div className="h-4 w-2/3 bg-[var(--card-border)]/50 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto pb-32 bg-[var(--background)] min-h-screen">
      {/* Sticky Header */}
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <button
            onClick={() => router.back()}
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition"
            aria-label="뒤로"
          >
            <ArrowLeft size={20} className="text-[var(--foreground)]" />
          </button>
          <h1 className="text-xl font-extrabold tracking-tight text-[var(--foreground)]">
            {tt('장바구니')} <span className="text-emerald-500">{items.length}</span>
          </h1>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="text-center py-24 px-6">
          <div className="w-24 h-24 rounded-full bg-emerald-50 dark:bg-emerald-950/30 mx-auto mb-5 flex items-center justify-center">
            <ShoppingBag size={42} className="text-emerald-500" />
          </div>
          <p className="text-lg font-extrabold text-[var(--foreground)] mb-1.5">{tt('장바구니가 비어있어요')}</p>
          <p className="text-sm text-[var(--muted)] mb-7">{tt('관심있는 상품을 담아보세요')}</p>
          <Link
            href="/shop"
            className="inline-flex items-center gap-1.5 px-6 py-3 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-bold shadow-md shadow-emerald-500/30 active:scale-95"
          >
            <Sparkles size={16} /> {tt('쇼핑하러 가기')}
          </Link>
        </div>
      ) : (
        <>
          {/* 무료배송 진행 바 */}
          {progressToFreeShipping && (
            <div className="px-4 mt-4 mb-3">
              <div className="card p-4 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/20 dark:to-teal-950/20 border-emerald-200/50 dark:border-emerald-900/30">
                <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300 mb-2 inline-flex items-center gap-1.5">
                  <Sparkles size={12} className="text-emerald-500" />
                  <span>
                    {locale === 'en'
                      ? `Add ₩${progressToFreeShipping.remaining.toLocaleString()} more for free shipping!`
                      : `${progressToFreeShipping.remaining.toLocaleString()}원 더 담으면 무료배송!`}
                  </span>
                </p>
                <div className="w-full h-2 rounded-full bg-emerald-100 dark:bg-emerald-950/40 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full transition-all duration-300"
                    style={{ width: `${progressToFreeShipping.pct}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* 아이템 목록 */}
          <div className="px-4 space-y-2.5">
            {items.map(it => {
              const unit = (it.product?.price_krw ?? 0) + (it.variant?.price_delta_krw ?? 0);
              return (
                <div key={it.id} className="card p-3.5 flex gap-3.5 group">
                  <Link
                    href={`/shop/product?id=${it.product_id}`}
                    className="w-20 h-20 rounded-2xl bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950 overflow-hidden flex-shrink-0 active:scale-95 transition"
                  >
                    {it.product?.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.product.thumbnail_url} alt={it.product.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[var(--muted)]"><Package size={28} /></div>
                    )}
                  </Link>
                  <div className="flex-1 min-w-0 flex flex-col justify-between">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {it.product?.brand && (
                          <p className="text-[12px] font-bold text-emerald-600 uppercase tracking-wider">{it.product.brand}</p>
                        )}
                        <p className="text-sm font-semibold text-[var(--foreground)] line-clamp-2 leading-snug">
                          {it.product?.name ?? (locale === 'en' ? '(no product)' : '(상품 없음)')}
                        </p>
                        {it.variant?.option_value && (
                          <p className="text-[13px] text-[var(--muted)] mt-0.5 inline-block px-1.5 py-0.5 rounded bg-[var(--card-border)]/40">
                            {it.variant.option_value}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => handleRemove(it.id)}
                        disabled={busy === it.id}
                        className="w-7 h-7 flex items-center justify-center text-[var(--muted)] hover:text-red-500 active:scale-90 disabled:opacity-50 transition"
                        aria-label="삭제"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-1.5 px-1.5 py-1 rounded-full bg-[var(--card-border)]/30">
                        <button
                          onClick={() => handleQty(it.id, it.quantity - 1)}
                          disabled={busy === it.id}
                          className="w-7 h-7 rounded-full bg-white dark:bg-zinc-800 shadow-sm flex items-center justify-center active:scale-90 disabled:opacity-50"
                        >
                          <Minus size={13} />
                        </button>
                        <span className="w-6 text-center text-sm font-extrabold">{it.quantity}</span>
                        <button
                          onClick={() => handleQty(it.id, it.quantity + 1)}
                          disabled={busy === it.id}
                          className="w-7 h-7 rounded-full bg-white dark:bg-zinc-800 shadow-sm flex items-center justify-center active:scale-90 disabled:opacity-50"
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                      <span className="text-base font-extrabold text-[var(--foreground)]">
                        {formatKrw(unit * it.quantity, locale)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 계속 쇼핑 link */}
          <div className="px-4 mt-3">
            <Link
              href="/shop"
              className="block text-center py-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-sm font-bold active:scale-[0.98] inline-flex items-center justify-center gap-1 w-full"
            >
              {locale === 'en' ? 'Keep shopping' : '계속 쇼핑하기'} <ChevronRight size={14} />
            </Link>
          </div>

          {/* 합계 카드 */}
          <div className="px-4 mt-5">
            <div className="card p-5 space-y-2.5 bg-gradient-to-br from-emerald-50/30 to-transparent dark:from-emerald-950/10">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--muted)]">{locale === 'en' ? 'Subtotal' : '상품 금액'}</span>
                <span className="text-[var(--foreground)] font-bold">{formatKrw(totals.subtotal, locale)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--muted)]">{locale === 'en' ? 'Shipping' : '배송비'}</span>
                <span className={`font-bold ${totals.shipping === 0 ? 'text-emerald-600' : 'text-[var(--foreground)]'}`}>
                  {totals.shipping === 0 ? tt('무료 🎉') : formatKrw(totals.shipping, locale)}
                </span>
              </div>
              <div className="pt-3 border-t border-emerald-200/40 dark:border-emerald-900/30 flex justify-between items-baseline">
                <span className="text-sm font-bold">{locale === 'en' ? 'Total' : '총 결제 금액'}</span>
                <span className="text-2xl font-extrabold text-emerald-600">{formatKrw(totals.total, locale)}</span>
              </div>
            </div>
          </div>

          <BusinessFooter variant="compact" />

          {/* Sticky CTA */}
          <div className="fixed bottom-0 left-1/2 -translate-x-1/2 max-w-lg w-full bg-[var(--background)]/95 backdrop-blur-lg border-t border-[var(--card-border)]/30 safe-area-bottom z-20">
            <div className="p-3">
              <button
                onClick={handleCheckout}
                className="w-full py-4 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-base active:scale-[0.98] shadow-md shadow-emerald-500/30 inline-flex items-center justify-center gap-2"
              >
                {locale === 'en' ? `Pay ${formatKrw(totals.total, locale)}` : `${totals.total.toLocaleString()}원 결제하기`}
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        </>
      )}

      {toast && <AppToast text={toast} tone="warn" onClose={() => setToast(null)} durationMs={2500} />}
    </div>
  );
}
