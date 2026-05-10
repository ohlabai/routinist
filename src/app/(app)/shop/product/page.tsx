'use client';

// 상품 상세 — 옵션 선택 / 수량 / 장바구니 / 바로 구매.

import { useEffect, useState, Suspense, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ShoppingCart, Plus, Minus, Package, ChevronRight, Check } from 'lucide-react';
import { fetchProduct, fetchProductVariants, addToCart } from '@/lib/shop-data';
import { useAuth } from '@/components/AuthProvider';
import AppToast from '@/components/AppToast';
import type { Product, ProductVariant } from '@/types';

function ProductDetailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const productId = searchParams.get('id') ?? '';

  const [product, setProduct] = useState<Product | null>(null);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const [bottomSheetOpen, setBottomSheetOpen] = useState(false);
  const [imageIdx, setImageIdx] = useState(0);

  useEffect(() => {
    if (!productId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    Promise.all([
      fetchProduct(productId),
      fetchProductVariants(productId),
    ]).then(([p, vs]) => {
      if (cancelled) return;
      setProduct(p);
      setVariants(vs);
      // 기본 옵션 자동 선택 (default → 재고 있는 첫 옵션)
      const def = vs.find(v => v.is_default && v.stock > 0) ?? vs.find(v => v.stock > 0) ?? vs[0];
      if (def) setSelectedVariantId(def.id);
    }).catch(e => {
      if (!cancelled) console.warn('[product detail] load fail', e);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [productId]);

  const selectedVariant = useMemo(
    () => variants.find(v => v.id === selectedVariantId) ?? null,
    [variants, selectedVariantId]
  );

  const unitPrice = useMemo(() => {
    if (!product) return 0;
    return product.price_krw + (selectedVariant?.price_delta_krw ?? 0);
  }, [product, selectedVariant]);

  const availableStock = selectedVariant ? selectedVariant.stock : product?.stock ?? 0;
  const maxQty = Math.min(availableStock, 99);

  const galleryImages = useMemo(() => {
    if (!product) return [];
    const arr: string[] = [];
    if (product.thumbnail_url) arr.push(product.thumbnail_url);
    if (Array.isArray(product.images)) arr.push(...product.images);
    return arr;
  }, [product]);

  const handleAddToCart = async () => {
    if (!product) return;
    if (!user) {
      router.push('/login');
      return;
    }
    if (variants.length > 0 && !selectedVariantId) {
      setToast({ text: '옵션을 선택해주세요', tone: 'warn' });
      setTimeout(() => setToast(null), 2000);
      setBottomSheetOpen(true);
      return;
    }
    if (availableStock < quantity) {
      setToast({ text: '재고가 부족합니다', tone: 'warn' });
      setTimeout(() => setToast(null), 2000);
      return;
    }
    setSubmitting(true);
    try {
      await addToCart(product.id, selectedVariantId, quantity);
      setToast({ text: '장바구니에 담았어요 🛒', tone: 'ok' });
      setTimeout(() => setToast(null), 2000);
      setBottomSheetOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '담기 실패';
      setToast({ text: msg, tone: 'warn' });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setSubmitting(false);
    }
  };

  const handleBuyNow = async () => {
    if (!product) return;
    if (!user) {
      router.push('/login');
      return;
    }
    if (variants.length > 0 && !selectedVariantId) {
      setBottomSheetOpen(true);
      return;
    }
    if (availableStock < quantity) {
      setToast({ text: '재고가 부족합니다', tone: 'warn' });
      setTimeout(() => setToast(null), 2000);
      return;
    }
    // 장바구니 거치지 않고 바로 결제 — checkout 에 한 건만 넘김 (sessionStorage)
    const buyNowItem = {
      product_id: product.id,
      variant_id: selectedVariantId,
      quantity,
    };
    sessionStorage.setItem('buyNowItem', JSON.stringify(buyNowItem));
    router.push('/shop/checkout?mode=buyNow');
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="max-w-lg mx-auto px-4 py-6 text-center">
        <button onClick={() => router.back()} className="inline-flex items-center gap-2 text-[var(--muted)] mb-4">
          <ArrowLeft size={20} /> 뒤로
        </button>
        <p className="text-sm text-[var(--muted)] mt-12">상품을 찾을 수 없어요</p>
      </div>
    );
  }

  const discount = product.compare_price_krw && product.compare_price_krw > product.price_krw
    ? Math.round((1 - product.price_krw / product.compare_price_krw) * 100)
    : 0;
  const isSoldOut = availableStock <= 0;

  return (
    <div className="max-w-lg mx-auto pb-32">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 sticky top-0 bg-[var(--background)]/95 backdrop-blur z-10">
        <button onClick={() => router.back()} className="p-1 active:scale-90" aria-label="뒤로">
          <ArrowLeft size={24} className="text-[var(--foreground)]" />
        </button>
        <Link href="/shop/cart" className="p-2 active:scale-90" aria-label="장바구니">
          <ShoppingCart size={22} className="text-[var(--foreground)]" />
        </Link>
      </div>

      {/* 이미지 갤러리 */}
      <div className="aspect-square bg-[var(--card)] relative">
        {galleryImages.length > 0 ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={galleryImages[imageIdx]} alt={product.name} className="w-full h-full object-cover" />
            {galleryImages.length > 1 && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                {galleryImages.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setImageIdx(i)}
                    className={`w-2 h-2 rounded-full transition ${i === imageIdx ? 'bg-white w-4' : 'bg-white/50'}`}
                    aria-label={`이미지 ${i + 1}`}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[var(--muted)]">
            <Package size={64} />
          </div>
        )}
        {discount > 0 && (
          <span className="absolute top-3 left-3 px-3 py-1 rounded-full bg-red-500 text-white text-sm font-bold shadow">
            {discount}% 할인
          </span>
        )}
        {isSoldOut && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <span className="text-white text-2xl font-bold">품절</span>
          </div>
        )}
      </div>

      {/* 정보 */}
      <div className="px-4 py-5">
        {product.brand && (
          <p className="text-xs text-[var(--muted)] mb-1">{product.brand}</p>
        )}
        <h1 className="text-xl font-bold text-[var(--foreground)] leading-tight">{product.name}</h1>

        <div className="flex items-baseline gap-2 mt-3">
          <span className="text-2xl font-extrabold text-[var(--foreground)]">
            {product.price_krw.toLocaleString()}원
          </span>
          {product.compare_price_krw && product.compare_price_krw > product.price_krw && (
            <span className="text-sm text-[var(--muted)] line-through">
              {product.compare_price_krw.toLocaleString()}
            </span>
          )}
        </div>

        {product.category && (
          <Link
            href={`/shop?category=${encodeURIComponent(product.category)}`}
            className="inline-flex items-center gap-1 mt-3 text-xs text-[var(--accent)]"
          >
            {product.category} <ChevronRight size={14} />
          </Link>
        )}

        {/* 설명 */}
        {product.description && (
          <div className="mt-6 pt-6 border-t border-[var(--card-border)]">
            <h2 className="text-sm font-bold text-[var(--foreground)] mb-3">상품 설명</h2>
            <p className="text-sm text-[var(--foreground)] whitespace-pre-wrap leading-relaxed">
              {product.description}
            </p>
          </div>
        )}

        {/* 추가 이미지 */}
        {galleryImages.length > 1 && (
          <div className="mt-6 pt-6 border-t border-[var(--card-border)] space-y-3">
            {galleryImages.slice(1).map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={url} alt={`${product.name} ${i + 2}`} className="w-full rounded-xl" />
            ))}
          </div>
        )}
      </div>

      {/* 하단 sticky 액션 바 */}
      <div className="fixed bottom-0 left-0 right-0 bg-[var(--background)] border-t border-[var(--card-border)] safe-area-bottom">
        <div className="max-w-lg mx-auto flex gap-2 p-3">
          <button
            onClick={handleAddToCart}
            disabled={submitting || isSoldOut}
            className="flex-1 py-3.5 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-sm font-bold text-[var(--foreground)] active:scale-95 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
          >
            <ShoppingCart size={18} />
            장바구니
          </button>
          <button
            onClick={handleBuyNow}
            disabled={submitting || isSoldOut}
            className="flex-[1.2] py-3.5 rounded-xl bg-emerald-500 text-white text-sm font-bold active:scale-95 disabled:opacity-50"
          >
            {isSoldOut ? '품절' : '바로 구매'}
          </button>
        </div>
      </div>

      {/* 옵션 선택 bottom sheet */}
      {bottomSheetOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-end"
          onClick={(e) => { if (e.target === e.currentTarget) setBottomSheetOpen(false); }}
        >
          <div className="w-full bg-[var(--background)] rounded-t-3xl max-h-[85vh] overflow-y-auto">
            <div className="sticky top-0 bg-[var(--background)] px-5 py-4 border-b border-[var(--card-border)] flex items-center justify-between">
              <h3 className="text-base font-bold">옵션 선택</h3>
              <button onClick={() => setBottomSheetOpen(false)} className="text-[var(--muted)] text-sm">닫기</button>
            </div>
            <div className="p-5 space-y-4">
              {variants.length > 0 && (
                <div>
                  <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">
                    {variants[0].option_name ?? '옵션'}
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {variants.map(v => {
                      const oos = v.stock <= 0;
                      const sel = v.id === selectedVariantId;
                      return (
                        <button
                          key={v.id}
                          onClick={() => !oos && setSelectedVariantId(v.id)}
                          disabled={oos}
                          className={`py-2.5 rounded-xl text-sm font-semibold transition active:scale-95 ${
                            sel ? 'bg-[var(--accent)] text-white' :
                            oos ? 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)] line-through opacity-50' :
                            'bg-[var(--card)] border border-[var(--card-border)] text-[var(--foreground)]'
                          }`}
                        >
                          {v.option_value}
                          {v.price_delta_krw !== 0 && (
                            <span className="block text-xs">
                              {v.price_delta_krw > 0 ? '+' : ''}{v.price_delta_krw.toLocaleString()}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">수량</label>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setQuantity(q => Math.max(1, q - 1))}
                    className="w-10 h-10 rounded-xl bg-[var(--card)] border border-[var(--card-border)] flex items-center justify-center active:scale-90"
                  >
                    <Minus size={18} />
                  </button>
                  <span className="w-12 text-center text-base font-bold">{quantity}</span>
                  <button
                    onClick={() => setQuantity(q => Math.min(maxQty, q + 1))}
                    disabled={quantity >= maxQty}
                    className="w-10 h-10 rounded-xl bg-[var(--card)] border border-[var(--card-border)] flex items-center justify-center active:scale-90 disabled:opacity-50"
                  >
                    <Plus size={18} />
                  </button>
                  <span className="text-xs text-[var(--muted)] ml-auto">최대 {maxQty}개</span>
                </div>
              </div>

              <div className="pt-4 border-t border-[var(--card-border)] flex items-baseline justify-between">
                <span className="text-sm text-[var(--muted)]">총 결제 금액</span>
                <span className="text-2xl font-extrabold text-[var(--accent)]">
                  {(unitPrice * quantity).toLocaleString()}원
                </span>
              </div>

              <button
                onClick={handleAddToCart}
                disabled={submitting}
                className="w-full py-3.5 rounded-xl bg-emerald-500 text-white font-bold text-base active:scale-95 disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                <Check size={18} />
                {submitting ? '담는 중…' : '장바구니에 담기'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2500} />}
    </div>
  );
}

export default function ProductDetailPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
      </div>
    }>
      <ProductDetailContent />
    </Suspense>
  );
}
