'use client';

// 네이티브 쇼핑 메인 — 상품 그리드 + 카테고리 필터 + 검색 + 장바구니 액세스.
// 기존 Cafe24 iframe 풀 교체 (Phase 2 백엔드 + Phase 3 프론트엔드).

import { useEffect, useState, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, ShoppingCart, Package } from 'lucide-react';
import { fetchProducts, fetchProductCategories, fetchCart } from '@/lib/shop-data';
import { useAuth } from '@/components/AuthProvider';
import BusinessFooter from '@/components/shop/BusinessFooter';
import type { Product } from '@/types';

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

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (searchInput.trim()) params.set('q', searchInput.trim());
    if (category) params.set('category', category);
    router.push(`/shop?${params.toString()}`);
  };

  const handleCategory = (cat: string) => {
    const params = new URLSearchParams();
    if (cat) params.set('category', cat);
    if (search) params.set('q', search);
    router.push(`/shop?${params.toString()}`);
  };

  return (
    <div className="max-w-lg mx-auto pb-12">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 sticky top-0 bg-[var(--background)]/95 backdrop-blur z-10">
        <h1 className="text-2xl font-bold text-[var(--foreground)]">쇼핑</h1>
        <Link
          href="/shop/cart"
          className="relative p-2 active:scale-90"
          aria-label="장바구니"
        >
          <ShoppingCart size={24} className="text-[var(--foreground)]" />
          {cartCount > 0 && (
            <span className="absolute top-0 right-0 w-5 h-5 rounded-full bg-emerald-500 text-white text-xs font-bold flex items-center justify-center">
              {cartCount > 9 ? '9+' : cartCount}
            </span>
          )}
        </Link>
      </div>

      {/* 검색 */}
      <form onSubmit={handleSearch} className="px-4 mb-3">
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="상품 검색"
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
      </form>

      {/* 카테고리 칩 */}
      {categories.length > 0 && (
        <div className="flex gap-2 px-4 mb-4 overflow-x-auto pb-1">
          <button
            onClick={() => handleCategory('')}
            className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-semibold transition active:scale-95 ${
              !category
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
            }`}
          >
            전체
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => handleCategory(cat)}
              className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-semibold transition active:scale-95 ${
                category === cat
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* 본문 */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
        </div>
      ) : products.length === 0 ? (
        <div className="text-center py-16">
          <Package size={48} className="mx-auto mb-3 text-[var(--muted)]" />
          <p className="text-sm text-[var(--muted)]">
            {search ? `"${search}" 검색 결과가 없어요` : category ? `${category} 카테고리에 상품이 없어요` : '상품을 준비 중이에요'}
          </p>
        </div>
      ) : (
        <>
          {/* 추천 (featured) — 큰 가로 카드 */}
          {featured.length > 0 && !category && !search && (
            <div className="px-4 mb-6">
              <h2 className="text-sm font-bold text-[var(--foreground)] mb-2">⭐ 추천 상품</h2>
              <div className="flex gap-3 overflow-x-auto px-1 pb-1">
                {featured.slice(0, 6).map(p => (
                  <Link
                    key={p.id}
                    href={`/shop/product?id=${p.id}`}
                    className="flex-shrink-0 w-40 active:scale-95 transition"
                  >
                    <div className="aspect-square bg-[var(--card)] rounded-xl overflow-hidden border border-[var(--card-border)]">
                      {p.thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.thumbnail_url} alt={p.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[var(--muted)]">
                          <Package size={32} />
                        </div>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-[var(--foreground)] mt-2 line-clamp-2">{p.name}</p>
                    <p className="text-base font-bold text-[var(--accent)] mt-0.5">{p.price_krw.toLocaleString()}원</p>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* 일반 그리드 (2 cols) */}
          <div className="px-4">
            <h2 className="text-sm font-bold text-[var(--foreground)] mb-3">
              {category || search ? `${products.length}개 상품` : '전체 상품'}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {(category || search ? products : regular).map(p => {
                const discount = p.compare_price_krw && p.compare_price_krw > p.price_krw
                  ? Math.round((1 - p.price_krw / p.compare_price_krw) * 100)
                  : 0;
                return (
                  <Link
                    key={p.id}
                    href={`/shop/product?id=${p.id}`}
                    className="active:scale-95 transition"
                  >
                    <div className="aspect-square bg-[var(--card)] rounded-xl overflow-hidden border border-[var(--card-border)] relative">
                      {p.thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.thumbnail_url} alt={p.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[var(--muted)]">
                          <Package size={36} />
                        </div>
                      )}
                      {discount > 0 && (
                        <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-red-500 text-white text-xs font-bold">
                          {discount}%
                        </span>
                      )}
                      {p.stock <= 0 && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                          <span className="text-white text-xs font-bold">품절</span>
                        </div>
                      )}
                    </div>
                    {p.brand && (
                      <p className="text-xs text-[var(--muted)] mt-2">{p.brand}</p>
                    )}
                    <p className="text-sm font-medium text-[var(--foreground)] mt-0.5 line-clamp-2 leading-tight">{p.name}</p>
                    <div className="mt-1 flex items-baseline gap-1.5">
                      <span className="text-base font-bold text-[var(--foreground)]">
                        {p.price_krw.toLocaleString()}원
                      </span>
                      {p.compare_price_krw && p.compare_price_krw > p.price_krw && (
                        <span className="text-xs text-[var(--muted)] line-through">
                          {p.compare_price_krw.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </>
      )}

      <BusinessFooter variant="compact" />
    </div>
  );
}

export default function ShopPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
      </div>
    }>
      <ShopContent />
    </Suspense>
  );
}
