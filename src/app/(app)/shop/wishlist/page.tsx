'use client';

// 위시리스트 — 찜한 상품 모음.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Heart, Package, Sparkles, ShoppingCart, X,
} from 'lucide-react';
import { fetchWishlist, removeFromWishlist, addToCart } from '@/lib/shop-data';
import { useAuth } from '@/components/AuthProvider';
import AppToast from '@/components/AppToast';
import { useI18n, formatKrw } from '@/lib/i18n';
import type { Product } from '@/types';

export default function WishlistPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { tt, locale } = useI18n();
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2500);
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    fetchWishlist()
      .then(list => setItems(list))
      .catch(e => console.warn('[wishlist] load fail', e))
      .finally(() => setLoading(false));
  }, [authLoading, user, router]);

  const handleRemove = async (productId: string) => {
    setBusy(productId);
    try {
      await removeFromWishlist(productId);
      setItems(prev => prev.filter(p => p.id !== productId));
    } catch {
      showToast(tt('잠시 후 다시 시도해주세요'), 'warn');
    } finally {
      setBusy(null);
    }
  };

  const handleAddToCart = async (productId: string) => {
    setBusy(productId);
    try {
      await addToCart(productId, null, 1);
      showToast(tt('장바구니에 담았어요 🛒'));
    } catch (e) {
      showToast(e instanceof Error ? e.message : tt('담기 실패'), 'warn');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-extrabold tracking-tight">
            {locale === 'en' ? 'Favorites' : '찜'} <span className="text-emerald-500">{items.length}</span>
          </h1>
        </div>
      </header>

      {loading || authLoading ? (
        <div className="px-4 pt-4 grid grid-cols-2 gap-3">
          {[0,1,2,3].map(i => (
            <div key={i} className="space-y-2">
              <div className="aspect-square rounded-2xl bg-[var(--card)] animate-pulse" />
              <div className="h-3 w-3/4 rounded bg-[var(--card)] animate-pulse" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-24 px-6">
          <div className="w-24 h-24 rounded-full bg-emerald-50 dark:bg-emerald-950/30 mx-auto mb-5 flex items-center justify-center">
            <Heart size={42} className="text-emerald-500" />
          </div>
          <p className="text-lg font-extrabold mb-1.5">{tt('아직 찜한 상품이 없어요')}</p>
          <p className="text-sm text-[var(--muted)] mb-7">{locale === 'en' ? 'Tap ♥ on items you like' : '관심있는 상품에 ♥ 를 눌러보세요'}</p>
          <Link
            href="/shop"
            className="inline-flex items-center gap-1.5 px-6 py-3 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-bold shadow-md shadow-emerald-500/30 active:scale-95"
          >
            <Sparkles size={16} /> {locale === 'en' ? 'Go shopping' : '쇼핑하러 가기'}
          </Link>
        </div>
      ) : (
        <div className="px-4 pt-4 grid grid-cols-2 gap-3">
          {items.map(p => {
            const discount = p.compare_price_krw && p.compare_price_krw > p.price_krw
              ? Math.round((1 - p.price_krw / p.compare_price_krw) * 100) : 0;
            // 가맹키 환경변수 기반 자동 분기 — 가맹키 없으면 false (런칭 전), 있으면 stock 판정.
            const isSoldOut = !!process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY && p.stock <= 0;
            return (
              <div key={p.id} className="active:scale-[0.97] transition group">
                <Link href={`/shop/product?id=${p.id}`} className="block">
                  <div className="aspect-square bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950 rounded-2xl overflow-hidden relative shadow-sm">
                    {p.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.thumbnail_url} alt={p.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[var(--muted)]"><Package size={36} /></div>
                    )}
                    {discount > 0 && (
                      <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-extrabold shadow">
                        -{discount}%
                      </span>
                    )}
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRemove(p.id); }}
                      disabled={busy === p.id}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90 backdrop-blur flex items-center justify-center shadow-sm active:scale-90 transition disabled:opacity-50"
                      aria-label={locale === 'en' ? 'Remove from favorites' : '찜 해제'}
                    >
                      <X size={13} className="text-zinc-600" />
                    </button>
                    {isSoldOut && (
                      <div className="absolute inset-0 bg-black/55 backdrop-blur-[1px] flex items-center justify-center">
                        <span className="text-white text-xs font-bold">SOLD OUT</span>
                      </div>
                    )}
                  </div>
                  <div className="px-0.5 mt-2.5">
                    {p.brand && (
                      <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">{p.brand}</p>
                    )}
                    <p className="text-sm font-medium text-[var(--foreground)] line-clamp-2 leading-snug mt-0.5">{p.name}</p>
                    <p className="mt-1 text-base font-extrabold text-[var(--foreground)]">{formatKrw(p.price_krw, locale)}</p>
                  </div>
                </Link>
                {!isSoldOut && (
                  <button
                    onClick={() => handleAddToCart(p.id)}
                    disabled={busy === p.id}
                    className="mt-2 w-full py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-xs font-bold inline-flex items-center justify-center gap-1 active:scale-[0.97] disabled:opacity-50"
                  >
                    <ShoppingCart size={12} /> {locale === 'en' ? 'Cart' : '장바구니'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2500} />}
    </div>
  );
}
