'use client';

// 네이티브 쇼핑 메인 — 모던 모바일 UX/UI 리디자인 (에메랄드 그린).
// 핵심: 에메랄드 그라데이션 hero / 큰 카테고리 아이콘 / 추천 가로 캐러셀 / 깔끔 그리드 / FAB

import { useEffect, useState, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Search, ShoppingCart, Package, Sparkles, TrendingUp, X,
  Heart, Star, Tag, ChevronRight,
} from 'lucide-react';
import { fetchProducts, fetchProductCategories, fetchCart } from '@/lib/shop-data';
import { useAuth } from '@/components/AuthProvider';
import BusinessFooter from '@/components/shop/BusinessFooter';
import type { Product } from '@/types';

// 카테고리별 이모지 매핑 — 새 카테고리 추가 시 여기에 추가하면 자동 반영.
const CATEGORY_EMOJI: Record<string, string> = {
  장갑: '🧤',
  다이어리: '📔',
  조끼: '🦺',
  의류: '👕',
  굿즈: '🎁',
  악세사리: '⌚',
  신발: '👟',
  가방: '🎒',
  모자: '🧢',
  양말: '🧦',
  음료: '🥤',
  보충제: '💊',
};

function emojiFor(category: string): string {
  return CATEGORY_EMOJI[category] || '🏃';
}

function ShopContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const category = searchParams.get('category') ?? '';
  const search = searchParams.get('q') ?? '';

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [cartCount, setCartCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState(search);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchProducts({
        category: category || undefined,
        search: search || undefined,
        sort: 'featured',
        limit: 50,
      }),
      fetchProductCategories(),
      user ? fetchCart().then(c => c.length).catch(() => 0) : Promise.resolve(0),
    ]).then(([prods, cats, cnt]) => {
      if (cancelled) return;
      setProducts(prods);
      setCategories(cats);
      setCartCount(cnt);
    }).catch(e => {
      if (!cancelled) console.warn('[shop] load fail', e);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [category, search, user]);

  const featured = useMemo(() => products.filter(p => p.is_featured), [products]);
  const regular = useMemo(() => products.filter(p => !p.is_featured), [products]);
  const isFiltered = !!(category || search);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (searchInput.trim()) params.set('q', searchInput.trim());
    if (category) params.set('category', category);
    router.push(`/shop?${params.toString()}`);
    setSearchOpen(false);
  };

  const handleCategory = (cat: string) => {
    const params = new URLSearchParams();
    if (cat) params.set('category', cat);
    router.push(`/shop?${params.toString()}`);
  };

  return (
    <div className="max-w-lg mx-auto pb-24 bg-[var(--background)] min-h-screen">
      {/* ===== Sticky Header ===== */}
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center justify-between px-4 py-3">
          <h1 className="text-2xl font-extrabold tracking-tight text-[var(--foreground)]">
            쇼핑
          </h1>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSearchOpen(true)}
              className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition"
              aria-label="검색"
            >
              <Search size={20} className="text-[var(--foreground)]" />
            </button>
            <Link
              href="/shop/cart"
              className="relative w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition"
              aria-label="장바구니"
            >
              <ShoppingCart size={20} className="text-[var(--foreground)]" />
              {cartCount > 0 && (
                <span className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-white text-[10px] font-extrabold flex items-center justify-center ring-2 ring-[var(--background)]">
                  {cartCount > 9 ? '9+' : cartCount}
                </span>
              )}
            </Link>
          </div>
        </div>

        {/* Search Modal Sheet */}
        {searchOpen && (
          <div className="absolute top-0 inset-x-0 bg-[var(--background)] z-40 px-4 py-3 border-b border-[var(--card-border)]/30 animate-[slideDown_0.2s_ease-out]">
            <form onSubmit={handleSearch} className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-emerald-500" />
                <input
                  type="search"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="찾으시는 상품을 입력하세요"
                  autoFocus
                  className="w-full pl-11 pr-4 py-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border-2 border-emerald-200 dark:border-emerald-900/40 text-sm font-medium text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:border-emerald-500"
                />
              </div>
              <button
                type="button"
                onClick={() => { setSearchOpen(false); setSearchInput(search); }}
                className="text-sm font-semibold text-[var(--muted)] active:scale-95"
              >
                취소
              </button>
            </form>
          </div>
        )}
      </header>

      {/* ===== Hero Banner — 에메랄드 그라데이션 ===== */}
      {!isFiltered && (
        <section className="px-4 pt-4 pb-6">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-teal-600 p-6 shadow-lg shadow-emerald-500/25">
            {/* 배경 장식 — 큰 원 */}
            <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
            <div className="absolute -bottom-16 -left-8 w-32 h-32 rounded-full bg-emerald-300/30 blur-xl" />

            <div className="relative">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 backdrop-blur-sm mb-3">
                <Sparkles size={12} className="text-white" />
                <span className="text-[11px] font-bold text-white tracking-wide">RUNNERS PICK</span>
              </div>
              <h2 className="text-2xl font-extrabold text-white leading-tight mb-1">
                러닝을 더 즐겁게<br />
                <span className="text-emerald-100">루티니스트 컬렉션</span>
              </h2>
              <p className="text-sm text-white/90 mt-2 mb-4">
                매일 달리는 사람을 위한 큐레이션
              </p>
              <Link
                href="/mileage"
                className="inline-flex items-center gap-1 px-4 py-2 rounded-full bg-white text-emerald-700 text-xs font-bold shadow-md active:scale-95 transition"
              >
                마일리지로 결제하기 <ChevronRight size={12} />
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ===== Categories — 큰 아이콘 그리드 ===== */}
      {categories.length > 0 && !search && (
        <section className="px-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-extrabold text-[var(--foreground)]">카테고리</h3>
            {category && (
              <button
                onClick={() => handleCategory('')}
                className="text-xs text-emerald-600 font-bold inline-flex items-center gap-0.5 active:scale-95"
              >
                전체 보기 <ChevronRight size={12} />
              </button>
            )}
          </div>
          <div className="grid grid-cols-4 gap-2">
            <button
              onClick={() => handleCategory('')}
              className={`flex flex-col items-center gap-1.5 py-3 rounded-2xl transition active:scale-95 ${
                !category
                  ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30'
                  : 'bg-[var(--card)] hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
              }`}
            >
              <span className="text-2xl">🛍️</span>
              <span className="text-xs font-bold">전체</span>
            </button>
            {categories.slice(0, 7).map(cat => (
              <button
                key={cat}
                onClick={() => handleCategory(cat)}
                className={`flex flex-col items-center gap-1.5 py-3 rounded-2xl transition active:scale-95 ${
                  category === cat
                    ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30'
                    : 'bg-[var(--card)] hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                }`}
              >
                <span className="text-2xl">{emojiFor(cat)}</span>
                <span className="text-xs font-bold truncate w-full px-1 text-center">{cat}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ===== Loading / Empty States ===== */}
      {loading ? (
        <div className="px-4">
          <div className="grid grid-cols-2 gap-3">
            {[0,1,2,3].map(i => (
              <div key={i} className="space-y-2">
                <div className="aspect-square rounded-2xl bg-[var(--card)] animate-pulse" />
                <div className="h-3 w-3/4 rounded bg-[var(--card)] animate-pulse" />
                <div className="h-4 w-1/2 rounded bg-[var(--card)] animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      ) : products.length === 0 ? (
        <div className="text-center py-20 px-4">
          <div className="w-20 h-20 rounded-full bg-emerald-50 dark:bg-emerald-950/30 mx-auto mb-4 flex items-center justify-center">
            <Package size={36} className="text-emerald-500" />
          </div>
          <p className="text-base font-semibold text-[var(--foreground)] mb-1">
            {search ? `"${search}"` : category}
          </p>
          <p className="text-sm text-[var(--muted)]">
            {search ? '검색 결과가 없어요' : category ? '준비 중인 카테고리예요' : '곧 상품이 올라올 예정이에요'}
          </p>
          {(search || category) && (
            <Link
              href="/shop"
              className="inline-flex mt-5 px-5 py-2.5 rounded-full bg-emerald-500 text-white text-sm font-bold active:scale-95"
            >
              전체 상품 보기
            </Link>
          )}
        </div>
      ) : (
        <>
          {/* ===== Featured — 가로 캐러셀 (홈에서만) ===== */}
          {featured.length > 0 && !isFiltered && (
            <section className="mb-7">
              <div className="flex items-center justify-between px-4 mb-3">
                <h3 className="text-base font-extrabold text-[var(--foreground)] inline-flex items-center gap-1.5">
                  <Sparkles size={16} className="text-emerald-500" />
                  지금 핫한 상품
                </h3>
                <span className="text-xs text-[var(--muted)]">{featured.length}개</span>
              </div>
              <div
                className="flex gap-3 overflow-x-auto px-4 pb-2 snap-x snap-mandatory scrollbar-hide"
                style={{ scrollbarWidth: 'none' }}
              >
                {featured.slice(0, 8).map(p => {
                  const discount = p.compare_price_krw && p.compare_price_krw > p.price_krw
                    ? Math.round((1 - p.price_krw / p.compare_price_krw) * 100) : 0;
                  return (
                    <Link
                      key={p.id}
                      href={`/shop/product?id=${p.id}`}
                      className="flex-shrink-0 w-44 snap-start active:scale-[0.97] transition"
                    >
                      <div className="aspect-[4/5] bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/20 dark:to-teal-950/20 rounded-2xl overflow-hidden relative shadow-sm">
                        {p.thumbnail_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.thumbnail_url} alt={p.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[var(--muted)]">
                            <Package size={40} />
                          </div>
                        )}
                        {discount > 0 && (
                          <span className="absolute top-2.5 left-2.5 px-2.5 py-1 rounded-full bg-red-500 text-white text-[10px] font-extrabold shadow">
                            -{discount}%
                          </span>
                        )}
                        <div className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full bg-white/90 backdrop-blur flex items-center justify-center shadow-sm">
                          <Heart size={14} className="text-zinc-400" />
                        </div>
                        {p.stock <= 0 && (
                          <div className="absolute inset-0 bg-black/55 backdrop-blur-[1px] flex items-center justify-center">
                            <span className="text-white text-sm font-bold">SOLD OUT</span>
                          </div>
                        )}
                      </div>
                      <div className="px-1 mt-2.5">
                        {p.brand && (
                          <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">{p.brand}</p>
                        )}
                        <p className="text-sm font-semibold text-[var(--foreground)] line-clamp-2 leading-snug mt-0.5">{p.name}</p>
                        {(p.rating_count ?? 0) > 0 && (
                          <div className="flex items-center gap-0.5 mt-1">
                            <Star size={11} className="text-amber-400 fill-amber-400" />
                            <span className="text-[11px] font-bold text-[var(--foreground)]">{(p.rating_avg ?? 0).toFixed(1)}</span>
                            <span className="text-[10px] text-[var(--muted)]">({p.rating_count})</span>
                          </div>
                        )}
                        <div className="mt-1 flex items-baseline gap-1.5">
                          <span className="text-base font-extrabold text-[var(--foreground)]">
                            {p.price_krw.toLocaleString()}원
                          </span>
                          {p.compare_price_krw && p.compare_price_krw > p.price_krw && (
                            <span className="text-[10px] text-[var(--muted)] line-through">
                              {p.compare_price_krw.toLocaleString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {/* ===== Main Grid ===== */}
          <section className="px-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-extrabold text-[var(--foreground)] inline-flex items-center gap-1.5">
                {isFiltered ? (
                  <>
                    <Tag size={16} className="text-emerald-500" />
                    {search ? `"${search}"` : category} <span className="text-[var(--muted)] font-medium">· {products.length}개</span>
                  </>
                ) : (
                  <>
                    <TrendingUp size={16} className="text-emerald-500" />
                    전체 상품
                  </>
                )}
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(isFiltered ? products : regular).map(p => {
                const discount = p.compare_price_krw && p.compare_price_krw > p.price_krw
                  ? Math.round((1 - p.price_krw / p.compare_price_krw) * 100) : 0;
                return (
                  <Link
                    key={p.id}
                    href={`/shop/product?id=${p.id}`}
                    className="active:scale-[0.97] transition group"
                  >
                    <div className="aspect-square bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950 rounded-2xl overflow-hidden relative shadow-sm group-hover:shadow-md transition-shadow">
                      {p.thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.thumbnail_url} alt={p.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[var(--muted)]">
                          <Package size={36} />
                        </div>
                      )}
                      {discount > 0 && (
                        <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-extrabold shadow">
                          -{discount}%
                        </span>
                      )}
                      <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90 backdrop-blur flex items-center justify-center shadow-sm">
                        <Heart size={13} className="text-zinc-400" />
                      </div>
                      {p.stock <= 0 && (
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
                      {(p.rating_count ?? 0) > 0 && (
                        <div className="flex items-center gap-0.5 mt-1">
                          <Star size={11} className="text-amber-400 fill-amber-400" />
                          <span className="text-[11px] font-bold text-[var(--foreground)]">{(p.rating_avg ?? 0).toFixed(1)}</span>
                          <span className="text-[10px] text-[var(--muted)]">({p.rating_count})</span>
                        </div>
                      )}
                      <div className="mt-1 flex items-baseline gap-1.5">
                        <span className="text-base font-extrabold text-[var(--foreground)]">
                          {p.price_krw.toLocaleString()}원
                        </span>
                        {p.compare_price_krw && p.compare_price_krw > p.price_krw && (
                          <span className="text-[10px] text-[var(--muted)] line-through">
                            {p.compare_price_krw.toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        </>
      )}

      {/* ===== Floating Cart Action Button (FAB) — 우하단 ===== */}
      {!loading && cartCount > 0 && (
        <Link
          href="/shop/cart"
          className="fixed bottom-24 right-5 z-20 inline-flex items-center gap-2 pl-4 pr-5 py-3.5 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-bold shadow-lg shadow-emerald-500/40 active:scale-95 transition"
          aria-label="장바구니 보기"
        >
          <ShoppingCart size={18} />
          <span className="text-sm">장바구니 {cartCount}</span>
        </Link>
      )}

      <BusinessFooter variant="compact" />

      {/* CSS — slideDown 애니 + scrollbar-hide */}
      <style jsx>{`
        @keyframes slideDown {
          from { transform: translateY(-10px); opacity: 0; }
          to   { transform: translateY(0);     opacity: 1; }
        }
        :global(.scrollbar-hide::-webkit-scrollbar) { display: none; }
      `}</style>
    </div>
  );
}

export default function ShopPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    }>
      <ShopContent />
    </Suspense>
  );
}
