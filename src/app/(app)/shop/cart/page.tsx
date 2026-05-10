'use client';

// 장바구니 — 수량 조정 / 삭제 / 결제로 진행.

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Trash2, Plus, Minus, Package, ShoppingBag } from 'lucide-react';
import { fetchCart, updateCartQuantity, removeFromCart } from '@/lib/shop-data';
import { useAuth } from '@/components/AuthProvider';
import AppToast from '@/components/AppToast';
import BusinessFooter from '@/components/shop/BusinessFooter';
import type { CartItem } from '@/types';

export default function CartPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    let cancelled = false;
    fetchCart().then(c => { if (!cancelled) setItems(c); })
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
          setToast(`재고가 부족해요 (최대 ${stock}개)`);
          setTimeout(() => setToast(null), 2500);
          return;
        }
        await updateCartQuantity(itemId, next);
        setItems(prev => prev.map(i => i.id === itemId ? { ...i, quantity: next } : i));
      }
    } catch (e) {
      console.warn('[cart] update fail', e);
      setToast('실패했어요. 다시 시도해주세요');
      setTimeout(() => setToast(null), 2500);
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async (itemId: string) => {
    if (!confirm('장바구니에서 빼시겠어요?')) return;
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

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto pb-32">
      <div className="flex items-center gap-3 px-4 py-3 sticky top-0 bg-[var(--background)]/95 backdrop-blur z-10">
        <button onClick={() => router.back()} className="p-1 active:scale-90" aria-label="뒤로">
          <ArrowLeft size={24} className="text-[var(--foreground)]" />
        </button>
        <h1 className="text-xl font-bold text-[var(--foreground)] flex-1">장바구니 ({items.length})</h1>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-20 px-4">
          <ShoppingBag size={48} className="mx-auto mb-4 text-[var(--muted)]" />
          <p className="text-sm text-[var(--muted)]">장바구니가 비어있어요</p>
          <Link
            href="/shop"
            className="inline-block mt-4 px-5 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-bold active:scale-95"
          >
            쇼핑하러 가기
          </Link>
        </div>
      ) : (
        <>
          <div className="px-4 space-y-3">
            {items.map(it => {
              const unit = (it.product?.price_krw ?? 0) + (it.variant?.price_delta_krw ?? 0);
              return (
                <div key={it.id} className="card p-3 flex gap-3">
                  <Link
                    href={`/shop/product?id=${it.product_id}`}
                    className="w-20 h-20 rounded-xl bg-[var(--card-border)] overflow-hidden flex-shrink-0"
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
                        <p className="text-sm font-semibold text-[var(--foreground)] line-clamp-2 leading-tight">
                          {it.product?.name ?? '(상품 없음)'}
                        </p>
                        {it.variant?.option_value && (
                          <p className="text-xs text-[var(--muted)] mt-0.5">{it.variant.option_value}</p>
                        )}
                      </div>
                      <button
                        onClick={() => handleRemove(it.id)}
                        disabled={busy === it.id}
                        className="text-[var(--muted)] active:scale-90 disabled:opacity-50"
                        aria-label="삭제"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleQty(it.id, it.quantity - 1)}
                          disabled={busy === it.id}
                          className="w-7 h-7 rounded-lg bg-[var(--card-border)]/50 flex items-center justify-center active:scale-90"
                        >
                          <Minus size={14} />
                        </button>
                        <span className="w-7 text-center text-sm font-bold">{it.quantity}</span>
                        <button
                          onClick={() => handleQty(it.id, it.quantity + 1)}
                          disabled={busy === it.id}
                          className="w-7 h-7 rounded-lg bg-[var(--card-border)]/50 flex items-center justify-center active:scale-90"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                      <span className="text-base font-bold text-[var(--foreground)]">
                        {(unit * it.quantity).toLocaleString()}원
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 합계 카드 */}
          <div className="px-4 mt-5">
            <div className="card p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--muted)]">상품 금액</span>
                <span className="text-[var(--foreground)] font-semibold">{totals.subtotal.toLocaleString()}원</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--muted)]">배송비</span>
                <span className="text-[var(--foreground)] font-semibold">
                  {totals.shipping === 0 ? '무료' : `${totals.shipping.toLocaleString()}원`}
                </span>
              </div>
              {totals.shipping > 0 && (
                <p className="text-xs text-[var(--accent)]">
                  💡 {(50000 - totals.subtotal).toLocaleString()}원 더 담으면 배송비 무료!
                </p>
              )}
              <div className="pt-2 border-t border-[var(--card-border)] flex justify-between items-baseline">
                <span className="text-sm font-semibold">총 결제 금액</span>
                <span className="text-xl font-extrabold text-[var(--accent)]">{totals.total.toLocaleString()}원</span>
              </div>
            </div>
          </div>
        </>
      )}

      {items.length > 0 && <BusinessFooter variant="compact" />}

      {/* 하단 sticky 결제 버튼 */}
      {items.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-[var(--background)] border-t border-[var(--card-border)] safe-area-bottom">
          <div className="max-w-lg mx-auto p-3">
            <button
              onClick={handleCheckout}
              className="w-full py-3.5 rounded-xl bg-emerald-500 text-white font-bold text-base active:scale-95"
            >
              {totals.total.toLocaleString()}원 결제하기
            </button>
          </div>
        </div>
      )}

      {toast && <AppToast text={toast} tone="warn" onClose={() => setToast(null)} durationMs={2500} />}
    </div>
  );
}
