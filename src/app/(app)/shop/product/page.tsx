'use client';

// 상품 상세 — 모던 모바일 UX/UI (에메랄드 그린).
// 핵심: 풀블리드 이미지 + 떠있는 헤더 + 옵션 bottom sheet + sticky CTA.

import { useEffect, useState, Suspense, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, ShoppingCart, Plus, Minus, Package, ChevronRight,
  Check, Heart, Share2, Star, Truck, ShieldCheck,
} from 'lucide-react';
import {
  fetchProduct, fetchProductVariants, addToCart,
  fetchWishlistIds, toggleWishlist,
} from '@/lib/shop-data';
import { useAuth } from '@/components/AuthProvider';
import AppToast from '@/components/AppToast';
import ProductReviews from '@/components/shop/ProductReviews';
import DOMPurify from 'isomorphic-dompurify';
import { useI18n, formatKrw } from '@/lib/i18n';
import type { Product, ProductVariant } from '@/types';

function ProductDetailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const { tt, locale } = useI18n();
  const productId = searchParams.get('id') ?? '';

  const [product, setProduct] = useState<Product | null>(null);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const [bottomSheetOpen, setBottomSheetOpen] = useState(false);
  const [bottomSheetMode, setBottomSheetMode] = useState<'cart' | 'buyNow'>('cart');
  const [imageIdx, setImageIdx] = useState(0);
  const [liked, setLiked] = useState(false);

  useEffect(() => {
    if (!productId) { setLoading(false); return; }
    let cancelled = false;
    Promise.all([
      fetchProduct(productId),
      fetchProductVariants(productId),
      user ? fetchWishlistIds().catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
    ])
      .then(([p, vs, wishIds]) => {
        if (cancelled) return;
        setProduct(p);
        setVariants(vs);
        const def = vs.find(v => v.is_default && v.stock > 0) ?? vs.find(v => v.stock > 0) ?? vs[0];
        if (def) setSelectedVariantId(def.id);
        if (p) setLiked(wishIds.has(p.id));
      })
      .catch(e => { if (!cancelled) console.warn('[product detail] load fail', e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [productId, user]);

  const selectedVariant = useMemo(
    () => variants.find(v => v.id === selectedVariantId) ?? null,
    [variants, selectedVariantId]
  );
  const unitPrice = useMemo(() =>
    product ? product.price_krw + (selectedVariant?.price_delta_krw ?? 0) : 0,
    [product, selectedVariant]
  );
  const availableStock = selectedVariant ? selectedVariant.stock : product?.stock ?? 0;
  const maxQty = Math.min(availableStock, 99);
  const galleryImages = useMemo(() => {
    if (!product) return [];
    const arr: string[] = [];
    if (product.thumbnail_url) arr.push(product.thumbnail_url);
    if (Array.isArray(product.images)) arr.push(...product.images);
    return arr;
  }, [product]);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok', ms = 2500) => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), ms);
  };

  // 바로 구매: 항상 BottomSheet 열기 (옵션 + 수량 선택). 사용자 피드백 build 100.
  // 옵션 없는 상품도 수량 선택 가능하게 + 옵션 있는 상품은 컬러/사이즈 선택.
  const handleBuyNow = async () => {
    if (!product) return;
    if (!user) { router.push('/login'); return; }
    setBottomSheetMode('buyNow');
    setBottomSheetOpen(true);
  };

  // 장바구니: BottomSheet 옵션 선택 모드 (variants 있으면) / 빠른 추가 (variants 없으면)
  const handleAddToCart = async () => {
    if (!product) return;
    if (!user) { router.push('/login'); return; }
    // variants 있고 옵션 미선택 → 옵션 선택 BottomSheet. 그 외엔 BottomSheet 로 수량까지 같이.
    setBottomSheetMode('cart');
    setBottomSheetOpen(true);
  };

  // BottomSheet 내 confirm — 모드별 분기
  const confirmAddToCart = async () => {
    if (!product) return;
    if (variants.length > 0 && !selectedVariantId) { showToast(tt('옵션을 선택해주세요'), 'warn'); return; }
    if (availableStock < quantity) { showToast(tt('재고가 부족해요'), 'warn'); return; }
    setSubmitting(true);
    try {
      await addToCart(product.id, selectedVariantId, quantity);
      showToast(tt('장바구니에 담았어요 🛒'));
      setBottomSheetOpen(false);
    } catch (e) {
      showToast(e instanceof Error ? e.message : tt('담기 실패'), 'warn', 3000);
    } finally {
      setSubmitting(false);
    }
  };

  const confirmBuyNow = () => {
    if (!product) return;
    if (variants.length > 0 && !selectedVariantId) { showToast(tt('옵션을 선택해주세요'), 'warn'); return; }
    if (availableStock < quantity) { showToast(tt('재고가 부족해요'), 'warn'); return; }
    // 토스 가맹키 도착 전까지 결제 비활성화 — 친근 안내 (사용자 피드백).
    if (!process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY) {
      showToast(tt('조금만 기다려주세요\n다음주 정식 런칭 후 살 수 있어요 ✨'), 'warn', 3500);
      return;
    }
    sessionStorage.setItem('buyNowItem', JSON.stringify({
      product_id: product.id, variant_id: selectedVariantId, quantity,
    }));
    router.push('/shop/checkout?mode=buyNow');
  };

  const handleShare = async () => {
    if (!product) return;
    const url = `https://app.routinist.kr/shop/product?id=${product.id}`;
    const text = `${product.name} - ${formatKrw(product.price_krw, locale)}`;
    try {
      // 2026-07-15 리뷰: Android WebView 엔 navigator.share 가 없어 항상 클립보드로
      // 강등됐음 — 다른 공유 지점과 동일하게 네이티브 공유시트 우선.
      const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
      if (cap?.isNativePlatform?.()) {
        const { Share } = await import('@capacitor/share');
        await Share.share({ title: product.name, text, url });
      } else if (navigator.share) {
        await navigator.share({ title: product.name, text, url });
      } else {
        await navigator.clipboard.writeText(url);
        showToast(tt('링크를 복사했어요 📋'));
      }
    } catch {}
  };

  if (loading) {
    return (
      <div className="max-w-lg mx-auto pb-32">
        <div className="aspect-square bg-[var(--card)] animate-pulse" />
        <div className="px-4 py-5 space-y-3">
          <div className="h-3 w-20 bg-[var(--card)] rounded animate-pulse" />
          <div className="h-5 w-4/5 bg-[var(--card)] rounded animate-pulse" />
          <div className="h-7 w-32 bg-[var(--card)] rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12 text-center">
        <button onClick={() => router.back()} className="inline-flex items-center gap-1 text-[var(--muted)] mb-8 active:scale-95">
          <ArrowLeft size={20} /> {locale === 'en' ? 'Back' : '뒤로'}
        </button>
        <div className="w-20 h-20 rounded-full bg-emerald-50 dark:bg-emerald-950/30 mx-auto mb-4 flex items-center justify-center">
          <Package size={36} className="text-emerald-500" />
        </div>
        <p className="text-base font-semibold mb-1">{tt('상품을 찾을 수 없어요')}</p>
        <p className="text-sm text-[var(--muted)]">{locale === 'en' ? 'It may have been deleted or the link is invalid' : '삭제됐거나 잘못된 링크일 수 있어요'}</p>
        <Link href="/shop" className="inline-flex mt-6 px-5 py-2.5 rounded-full bg-emerald-500 text-white text-sm font-bold active:scale-95">
          {locale === 'en' ? 'Go shopping' : '쇼핑하러 가기'}
        </Link>
      </div>
    );
  }

  const discount = product.compare_price_krw && product.compare_price_krw > product.price_krw
    ? Math.round((1 - product.price_krw / product.compare_price_krw) * 100) : 0;
  // 토스 가맹키 (NEXT_PUBLIC_TOSS_CLIENT_KEY) 환경변수 유무로 SOLD OUT 자동 분기.
  // 가맹키 없음 (정식 런칭 전): 모든 상품 둘러보기 가능 + "바로 구매" 클릭 시 토스트 안내.
  // 가맹키 있음 (정식 런칭 후): 재고 0 이면 정상 품절 처리.
  const PAYMENT_LIVE = !!process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
  const isSoldOut = PAYMENT_LIVE ? (availableStock <= 0) : false;

  return (
    <div className="max-w-lg mx-auto pb-32 bg-[var(--background)] min-h-screen">
      {/* Floating Header — 이미지 위에 떠있음. status bar/notch 회피 위해 safe-area top padding. */}
      <header className="fixed top-0 left-1/2 -translate-x-1/2 max-w-lg w-full z-30" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="flex items-center justify-between px-3 py-3">
          <button
            onClick={() => router.back()}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md shadow-sm active:scale-90 transition"
            aria-label={locale === 'en' ? 'Back' : '뒤로'}
          >
            <ArrowLeft size={20} className="text-[var(--foreground)]" />
          </button>
          <div className="flex gap-2">
            <button
              onClick={handleShare}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md shadow-sm active:scale-90 transition"
              aria-label={locale === 'en' ? 'Share' : '공유'}
            >
              <Share2 size={18} className="text-[var(--foreground)]" />
            </button>
            <Link
              href="/shop/cart"
              className="w-10 h-10 flex items-center justify-center rounded-full bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md shadow-sm active:scale-90 transition"
              aria-label={locale === 'en' ? 'Cart' : '장바구니'}
            >
              <ShoppingCart size={18} className="text-[var(--foreground)]" />
            </Link>
          </div>
        </div>
      </header>

      {/* 메인 이미지 갤러리 */}
      <div className="aspect-square bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950 relative overflow-hidden">
        {galleryImages.length > 0 ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={galleryImages[imageIdx]} alt={product.name} className="w-full h-full object-cover" />
            {galleryImages.length > 1 && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 px-2.5 py-1.5 rounded-full bg-black/40 backdrop-blur-md">
                {galleryImages.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setImageIdx(i)}
                    className={`w-1.5 h-1.5 rounded-full transition-all ${i === imageIdx ? 'bg-white w-5' : 'bg-white/50'}`}
                    aria-label={locale === 'en' ? `Image ${i + 1}` : `이미지 ${i + 1}`}
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
          <span className="absolute top-20 left-4 px-3 py-1.5 rounded-full bg-red-500 text-white text-xs font-extrabold shadow-lg">
            -{discount}%
          </span>
        )}
        {isSoldOut && (
          <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px] flex items-center justify-center">
            <span className="text-white text-2xl font-extrabold tracking-wider">SOLD OUT</span>
          </div>
        )}
      </div>

      {/* 상품 정보 카드 */}
      <div className="px-4 pt-5 pb-4">
        {product.brand && (
          <p className="text-[11px] font-extrabold text-emerald-600 uppercase tracking-widest mb-1.5">{product.brand}</p>
        )}
        <h1 className="text-xl font-extrabold text-[var(--foreground)] leading-tight mb-3">{product.name}</h1>

        {/* 평점 — 클릭 시 리뷰 섹션으로 스크롤 (사용자 피드백 build 100) */}
        {(product.rating_count ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById('product-reviews');
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className="inline-flex items-center gap-1.5 mb-3 active:scale-95 transition"
          >
            <div className="flex items-center gap-0.5">
              {[1,2,3,4,5].map(i => (
                <Star key={i} size={13} className={i <= Math.round(product.rating_avg ?? 0) ? 'text-amber-400 fill-amber-400' : 'text-zinc-300 dark:text-zinc-600'} />
              ))}
            </div>
            <span className="text-sm font-bold text-[var(--foreground)]">{(product.rating_avg ?? 0).toFixed(1)}</span>
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-bold underline">{locale === 'en' ? `${product.rating_count} reviews \u2192` : `리뷰 ${product.rating_count}개 \u2192`}</span>
          </button>
        )}

        {/* 재고 긴급 안내 */}
        {!isSoldOut && availableStock > 0 && availableStock <= 5 && (
          <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-orange-50 dark:bg-orange-950/30 text-orange-600 dark:text-orange-400 text-[11px] font-extrabold mb-2.5 animate-pulse">
            🔥 {locale === 'en' ? `Only ${availableStock} left` : `마지막 ${availableStock}개 남음`}
          </div>
        )}

        {/* 가격 */}
        <div className="flex items-baseline gap-2 mb-4">
          {discount > 0 && (
            <span className="text-base font-extrabold text-red-500">{discount}%</span>
          )}
          <span className="text-3xl font-extrabold text-[var(--foreground)]">
            {locale === 'en' ? (
              <>
                <span className="text-lg font-bold mr-0.5">₩</span>
                {product.price_krw.toLocaleString()}
              </>
            ) : (
              <>
                {product.price_krw.toLocaleString()}
                <span className="text-lg font-bold ml-0.5">원</span>
              </>
            )}
          </span>
          {product.compare_price_krw && product.compare_price_krw > product.price_krw && (
            <span className="text-sm text-[var(--muted)] line-through">
              {product.compare_price_krw.toLocaleString()}
            </span>
          )}
        </div>

        {/* 카테고리 */}
        {product.category && (
          <Link
            href={`/shop?category=${encodeURIComponent(product.category)}`}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-xs font-bold active:scale-95"
          >
            #{product.category}
          </Link>
        )}
      </div>

      {/* 혜택 카드 — 사용자 친화 문구 (build 100). "청약철회" 같은 법률 용어 제거. */}
      <div className="px-4 mb-4">
        <div className="grid grid-cols-2 gap-2">
          <div className="card p-3 flex items-center gap-2.5 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/20 dark:to-teal-950/20 border-emerald-200/50 dark:border-emerald-900/30">
            <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
              <Truck size={16} className="text-emerald-600" />
            </div>
            <div>
              <p className="text-[10px] text-[var(--muted)] font-medium">{locale === 'en' ? 'Always' : '무조건'}</p>
              <p className="text-xs font-bold text-[var(--foreground)]">{locale === 'en' ? 'Same-day shipping' : '당일 출고'}</p>
            </div>
          </div>
          <div className="card p-3 flex items-center gap-2.5 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/20 dark:to-teal-950/20 border-emerald-200/50 dark:border-emerald-900/30">
            <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
              <ShieldCheck size={16} className="text-emerald-600" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-[var(--muted)] font-medium whitespace-nowrap">{locale === 'en' ? 'Over ₩10,000' : '1만원 이상'}</p>
              <p className="text-xs font-bold text-[var(--foreground)] whitespace-nowrap">{locale === 'en' ? 'Free shipping' : '무료 배송'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* 설명 — cafe24 HTML 을 sanitize 후 렌더. 코드/스타일 그대로 노출되던 버그 fix. */}
      {product.description && (() => {
        const raw = product.description;
        // HTML 태그 포함 여부 판정 — 없으면 plain text 처리
        const hasHtml = /<[a-z][\s\S]*?>/i.test(raw);
        const cleanHtml = hasHtml
          ? DOMPurify.sanitize(raw, {
              ALLOWED_TAGS: ['p', 'br', 'span', 'div', 'strong', 'em', 'b', 'i', 'u',
                'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                'img', 'a', 'table', 'tbody', 'thead', 'tr', 'td', 'th',
                'figure', 'figcaption', 'blockquote', 'hr'],
              ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'style', 'colspan', 'rowspan'],
              FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input'],
              FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
            })
          : '';
        return (
          <div className="px-4 py-5 mt-2 border-t border-[var(--card-border)]/40">
            <h2 className="text-sm font-extrabold text-[var(--foreground)] mb-3 inline-flex items-center gap-1.5">
              <ChevronRight size={14} className="text-emerald-500" />
              {locale === 'en' ? 'Description' : '상품 설명'}
            </h2>
            {hasHtml ? (
              <div
                className="product-description text-sm text-[var(--foreground)] leading-relaxed [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-xl [&_img]:my-2 [&_table]:w-full [&_table]:my-2 [&_p]:my-1.5"
                dangerouslySetInnerHTML={{ __html: cleanHtml }}
              />
            ) : (
              <p className="text-sm text-[var(--foreground)] whitespace-pre-wrap leading-relaxed">
                {raw}
              </p>
            )}
          </div>
        );
      })()}

      {/* 추가 이미지 */}
      {galleryImages.length > 1 && (
        <div className="px-4 py-5 border-t border-[var(--card-border)]/40 space-y-3">
          <h2 className="text-sm font-extrabold text-[var(--foreground)] mb-1 inline-flex items-center gap-1.5">
            <ChevronRight size={14} className="text-emerald-500" />
            {locale === 'en' ? 'Detail images' : '상세 이미지'}
          </h2>
          {galleryImages.slice(1).map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={url} alt={`${product.name} ${i + 2}`} className="w-full rounded-2xl shadow-sm" />
          ))}
        </div>
      )}

      {/* 리뷰 — anchor scroll target (build 100) */}
      <div id="product-reviews" className="px-4 border-t border-[var(--card-border)]/40 scroll-mt-4">
        <ProductReviews
          productId={product.id}
          ratingAvg={product.rating_avg ?? 0}
          ratingCount={product.rating_count ?? 0}
        />
      </div>

      {/* Sticky 액션 바 — main 컨테이너 내 sticky 로 (build 100). BottomNav 위에 자연 노출.
          기존: fixed bottom-0 → BottomNav (z-40) 가 가려 결제 버튼 안 보임 신고. */}
      <div className="sticky bottom-0 left-0 right-0 bg-[var(--background)]/95 backdrop-blur-lg border-t border-[var(--card-border)]/30 z-20">
        <div className="flex items-center gap-2 px-3 py-3">
          <button
            onClick={async () => {
              if (!user) { router.push('/login'); return; }
              if (!product) return;
              const prev = liked;
              setLiked(!prev);  // optimistic
              try {
                await toggleWishlist(product.id, prev);
                showToast(prev ? tt('찜 해제했어요') : tt('찜했어요 ❤️'));
              } catch {
                setLiked(prev);
                showToast(tt('잠시 후 다시 시도해주세요'), 'warn');
              }
            }}
            className={`w-12 h-12 flex items-center justify-center rounded-2xl border-2 transition active:scale-90 ${
              liked
                ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/40'
                : 'bg-[var(--card)] border-[var(--card-border)]'
            }`}
            aria-label={locale === 'en' ? 'Wishlist' : '위시리스트'}
          >
            <Heart size={20} className={liked ? 'text-red-500 fill-red-500' : 'text-[var(--muted)]'} />
          </button>
          <button
            onClick={handleAddToCart}
            disabled={submitting || isSoldOut}
            className="flex-1 py-3.5 rounded-2xl bg-[var(--card)] border-2 border-emerald-200 dark:border-emerald-900/40 text-sm font-bold text-emerald-700 dark:text-emerald-300 active:scale-[0.98] disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
          >
            <ShoppingCart size={17} />
            {locale === 'en' ? 'Cart' : '장바구니'}
          </button>
          <button
            onClick={handleBuyNow}
            disabled={submitting || isSoldOut}
            className="flex-[1.3] py-3.5 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-sm font-extrabold active:scale-[0.98] disabled:opacity-50 shadow-md shadow-emerald-500/30"
          >
            {isSoldOut ? tt('품절') : tt('바로 구매')}
          </button>
        </div>
      </div>

      {/* 옵션 선택 Bottom Sheet */}
      {bottomSheetOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-end animate-[fadeIn_0.2s_ease-out]"
          onClick={(e) => { if (e.target === e.currentTarget) setBottomSheetOpen(false); }}
        >
          <div className="w-full max-w-lg mx-auto bg-[var(--background)] rounded-t-3xl max-h-[85vh] overflow-y-auto animate-[slideUp_0.25s_ease-out]">
            <div className="sticky top-0 bg-[var(--background)] px-5 py-4 border-b border-[var(--card-border)]/40 flex items-center justify-between">
              <div>
                <h3 className="text-base font-extrabold">{locale === 'en' ? 'Choose options' : '옵션 선택'}</h3>
                <p className="text-xs text-[var(--muted)] mt-0.5 line-clamp-1">{product.name}</p>
              </div>
              <button
                onClick={() => setBottomSheetOpen(false)}
                className="w-8 h-8 rounded-full bg-[var(--card)] flex items-center justify-center active:scale-90"
              >
                <span className="text-lg leading-none">×</span>
              </button>
            </div>
            <div className="p-5 space-y-5">
              {variants.length > 0 && (
                <div>
                  <label className="block text-sm font-bold text-[var(--foreground)] mb-2.5">
                    {variants[0].option_name ?? (locale === 'en' ? 'Option' : '옵션')}
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
                          className={`py-2.5 px-2 rounded-2xl text-sm font-bold transition active:scale-95 border-2 ${
                            sel ? 'bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-500/25' :
                            oos ? 'bg-[var(--card)] border-[var(--card-border)] text-[var(--muted)] line-through opacity-50' :
                            'bg-[var(--card)] border-[var(--card-border)] text-[var(--foreground)]'
                          }`}
                        >
                          <span className="block truncate">{v.option_value}</span>
                          {v.price_delta_krw !== 0 && (
                            <span className="block text-[10px] mt-0.5 opacity-90">
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
                <label className="block text-sm font-bold text-[var(--foreground)] mb-2.5">{locale === 'en' ? 'Quantity' : '수량'}</label>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setQuantity(q => Math.max(1, q - 1))}
                      className="w-11 h-11 rounded-2xl bg-[var(--card)] border-2 border-[var(--card-border)] flex items-center justify-center active:scale-90"
                    >
                      <Minus size={18} />
                    </button>
                    <span className="w-12 text-center text-lg font-extrabold">{quantity}</span>
                    <button
                      onClick={() => setQuantity(q => Math.min(maxQty, q + 1))}
                      disabled={quantity >= maxQty}
                      className="w-11 h-11 rounded-2xl bg-[var(--card)] border-2 border-[var(--card-border)] flex items-center justify-center active:scale-90 disabled:opacity-50"
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                  <span className="text-xs text-[var(--muted)]">{locale === 'en' ? `Max ${maxQty}` : `최대 ${maxQty}개 가능`}</span>
                </div>
              </div>

              <div className="pt-4 border-t border-[var(--card-border)]/40 flex justify-between items-baseline">
                <span className="text-sm text-[var(--muted)]">{locale === 'en' ? 'Total' : '총 결제 금액'}</span>
                <span className="text-2xl font-extrabold text-emerald-600">
                  {formatKrw(unitPrice * quantity, locale)}
                </span>
              </div>

              {/* CTA — mode 별 분기 (build 100). 바로 구매 시에는 결제 진입, 장바구니 시에는 add 후 닫기 */}
              {bottomSheetMode === 'buyNow' ? (
                <button
                  onClick={confirmBuyNow}
                  disabled={submitting}
                  className="w-full py-4 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-base active:scale-[0.98] disabled:opacity-50 inline-flex items-center justify-center gap-2 shadow-md shadow-emerald-500/30"
                >
                  <Check size={18} />
                  {locale === 'en' ? 'Buy now' : '바로 구매하기'}
                </button>
              ) : (
                <button
                  onClick={confirmAddToCart}
                  disabled={submitting}
                  className="w-full py-4 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-base active:scale-[0.98] disabled:opacity-50 inline-flex items-center justify-center gap-2 shadow-md shadow-emerald-500/30"
                >
                  <Check size={18} />
                  {submitting ? (locale === 'en' ? 'Adding…' : '담는 중…') : (locale === 'en' ? 'Add to cart' : '장바구니에 담기')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2500} />}

      <style jsx>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
      `}</style>
    </div>
  );
}

export default function ProductDetailPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    }>
      <ProductDetailContent />
    </Suspense>
  );
}
