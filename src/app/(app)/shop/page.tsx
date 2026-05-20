'use client';

// 네이티브 쇼핑 메인 — 모던 모바일 UX/UI 리디자인 (에메랄드 그린).
// 핵심: 에메랄드 그라데이션 hero / 큰 카테고리 아이콘 / 추천 가로 캐러셀 / 깔끔 그리드 / FAB

import { useEffect, useState, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Search, ShoppingCart, Package, Sparkles, TrendingUp, X,
  Heart, Star, Tag, ChevronRight, Menu, ShoppingBag, MapPin, Receipt,
  HelpCircle, FileText, LogOut, Info,
} from 'lucide-react';
import { fetchProducts, fetchProductCategories, fetchCart, fetchWishlistIds, toggleWishlist } from '@/lib/shop-data';
import AppToast from '@/components/AppToast';
import AppLogo from '@/components/AppLogo';
import { useAuth } from '@/components/AuthProvider';
import { signOut } from '@/lib/auth';
import BusinessFooter from '@/components/shop/BusinessFooter';
import type { Product } from '@/types';
import { useI18n, type TranslationKey } from '@/lib/i18n';

// 표시 카테고리 (고정 4개) + cafe24 raw 카테고리 → 표시 카테고리 매핑
// 사용자 결정: 의류 / 모자 / 악세사리 / 굿즈 4개. 조끼→의류, 장갑→악세사리, 다이어리→굿즈.
const DISPLAY_CATEGORIES = ['의류', '모자', '악세사리', '굿즈'] as const;
type DisplayCategory = typeof DISPLAY_CATEGORIES[number];

const CATEGORY_MAP: Record<string, DisplayCategory> = {
  의류: '의류', 조끼: '의류', 상의: '의류', 하의: '의류', 자켓: '의류',
  모자: '모자', 캡: '모자', 비니: '모자',
  악세사리: '악세사리', 액세사리: '악세사리', 장갑: '악세사리', 양말: '악세사리',
  굿즈: '굿즈', 다이어리: '굿즈', 키링: '굿즈', 텀블러: '굿즈',
};

const CATEGORY_EMOJI: Record<DisplayCategory, string> = {
  의류: '👕', 모자: '🧢', 악세사리: '⌚', 굿즈: '🎁',
};

function mapToDisplay(raw: string | null): DisplayCategory | null {
  if (!raw) return null;
  return CATEGORY_MAP[raw] ?? null;
}

function ShopContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useI18n();
  const category = searchParams.get('category') ?? '';
  const search = searchParams.get('q') ?? '';

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [cartCount, setCartCount] = useState(0);
  const [wishlistIds, setWishlistIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState(search);
  const [searchOpen, setSearchOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2200);
  };

  const handleHeartClick = async (e: React.MouseEvent, productId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) { router.push('/login'); return; }
    const wasLiked = wishlistIds.has(productId);
    setWishlistIds(prev => {
      const n = new Set(prev);
      if (wasLiked) n.delete(productId); else n.add(productId);
      return n;
    });
    try {
      await toggleWishlist(productId, wasLiked);
      showToast(wasLiked ? t('shop.unliked') : t('shop.liked'));
    } catch {
      // revert
      setWishlistIds(prev => {
        const n = new Set(prev);
        if (wasLiked) n.add(productId); else n.delete(productId);
        return n;
      });
      showToast(t('shop.retryLater'), 'warn');
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // 카테고리 필터 — display 카테고리 (예: '의류') 선택 시 매핑된 모든 raw 를 fetch 후 클라사이드 필터.
    // fetchProducts 가 단일 category 만 지원하므로 일단 전체를 받아 클라에서 필터.
    Promise.all([
      fetchProducts({
        search: search || undefined,
        sort: 'featured',
        limit: 100,
      }),
      user ? fetchCart().then(c => c.length).catch(() => 0) : Promise.resolve(0),
      user ? fetchWishlistIds().catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
    ]).then(([allProds, cnt, wish]) => {
      if (cancelled) return;
      // display 카테고리로 매핑되는 상품만 노출 — 매핑 안 되는 raw 는 제외 (목업 방지).
      // 또한 썸네일 없는 미등록 상품도 제외 (사용자 피드백 #4 — 빈 박스 이미지 숨김).
      const validDisplay = (p: Product) => {
        if (!p.thumbnail_url) return false;
        const disp = mapToDisplay(p.category);
        return disp !== null;
      };
      const filtered = allProds
        .filter(validDisplay)
        .filter(p => !category || mapToDisplay(p.category) === category);
      setProducts(filtered);
      // 실제 상품이 있는 display 카테고리만 노출
      const presentDisplays = new Set<DisplayCategory>();
      for (const p of allProds.filter(validDisplay)) {
        const d = mapToDisplay(p.category);
        if (d) presentDisplays.add(d);
      }
      setCategories(DISPLAY_CATEGORIES.filter(c => presentDisplays.has(c)));
      setCartCount(cnt);
      setWishlistIds(wish);
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
    const q = searchInput.trim();
    if (q) {
      params.set('q', q);
      // 최근 검색어 저장 (localStorage)
      try {
        const KEY = 'shop_recent_searches';
        const prev: string[] = JSON.parse(localStorage.getItem(KEY) || '[]');
        const next = [q, ...prev.filter(x => x !== q)].slice(0, 8);
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {}
    }
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
      {/* ===== Sticky Header — 다른 탭 (홈/지도/랭킹) 과 동일 패턴 ===== */}
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center justify-between px-4 py-3">
          {/* 좌측: 다른 탭과 동일 [R심볼 + 메뉴명] 패턴 (build 100 통일) */}
          <div className="flex items-center gap-2">
            <AppLogo size={28} />
            <h1 className="text-xl font-extrabold tracking-tight text-[var(--foreground)]">{t('shop.title')}</h1>
          </div>
          {/* 우측: 검색 / 카트 / 메뉴 — 햄버거는 좌측에서 우측으로 이동 (사용자 피드백) */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSearchOpen(true)}
              className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition"
              aria-label={t('shop.search')}
            >
              <Search size={20} className="text-[var(--foreground)]" />
            </button>
            <Link
              href="/shop/cart"
              className="relative w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition"
              aria-label={t('shop.cart')}
            >
              <ShoppingCart size={20} className="text-[var(--foreground)]" />
              {cartCount > 0 && (
                <span className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-white text-[10px] font-extrabold flex items-center justify-center ring-2 ring-[var(--background)]">
                  {cartCount > 9 ? '9+' : cartCount}
                </span>
              )}
            </Link>
            <button
              onClick={() => setMenuOpen(true)}
              className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition"
              aria-label={t('shop.menu')}
            >
              <Menu size={20} className="text-[var(--foreground)]" />
            </button>
          </div>
        </div>

        {/* Search Modal Sheet — 검색어 입력 + 최근/추천 (사용자 피드백) */}
        {searchOpen && (
          <div className="absolute top-0 inset-x-0 bg-[var(--background)] z-40 border-b border-[var(--card-border)]/30 animate-[slideDown_0.2s_ease-out]">
            <div className="px-4 py-3">
              <form onSubmit={handleSearch} className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-emerald-500" />
                  <input
                    type="search"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder={t('shop.searchPlaceholder')}
                    autoFocus
                    className="w-full pl-11 pr-4 py-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border-2 border-emerald-200 dark:border-emerald-900/40 text-sm font-medium text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => { setSearchOpen(false); setSearchInput(search); }}
                  className="text-sm font-semibold text-[var(--muted)] active:scale-95"
                >
                  {t('shop.cancel')}
                </button>
              </form>
              {/* 최근 검색어 + 추천 (카테고리) */}
              <SearchSuggestions
                value={searchInput}
                onPick={(q) => {
                  setSearchInput(q);
                  const params = new URLSearchParams();
                  params.set('q', q);
                  router.push(`/shop?${params.toString()}`);
                  setSearchOpen(false);
                }}
              />
            </div>
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
                <span className="text-[11px] font-bold text-white tracking-wide">{t('shop.heroBadge')}</span>
              </div>
              <h2 className="text-2xl font-extrabold text-white leading-tight mb-1">
                {t('shop.heroTitle1')}<br />
                <span className="text-emerald-100">{t('shop.heroTitle2')}</span>
              </h2>
              <p className="text-sm text-white/90 mt-2 mb-4">
                {t('shop.heroSub')}
              </p>
              <Link
                href="/mileage"
                className="inline-flex items-center gap-1 px-4 py-2 rounded-full bg-white text-emerald-700 text-xs font-bold shadow-md active:scale-95 transition"
              >
                {t('shop.heroCta')} <ChevronRight size={12} />
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ===== Categories — 의류/모자/악세사리/굿즈 4개 고정 ===== */}
      {!search && (
        <section className="px-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-extrabold text-[var(--foreground)]">{t('shop.categories')}</h3>
            {category && (
              <button
                onClick={() => handleCategory('')}
                className="text-xs text-emerald-600 font-bold inline-flex items-center gap-0.5 active:scale-95"
              >
                {t('shop.seeAll')} <ChevronRight size={12} />
              </button>
            )}
          </div>
          <div className="grid grid-cols-5 gap-2">
            <button
              onClick={() => handleCategory('')}
              className={`flex flex-col items-center gap-1.5 py-3 rounded-2xl transition active:scale-95 ${
                !category
                  ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30'
                  : 'bg-[var(--card)] hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
              }`}
            >
              <span className="text-2xl">🛍️</span>
              <span className="text-xs font-bold">{t('shop.all')}</span>
            </button>
            {DISPLAY_CATEGORIES.map(cat => {
              const labelKey: TranslationKey = cat === '의류' ? 'shop.catClothes' : cat === '모자' ? 'shop.catHats' : cat === '악세사리' ? 'shop.catAccessories' : 'shop.catGoods';
              return (
                <button
                  key={cat}
                  onClick={() => handleCategory(cat)}
                  className={`flex flex-col items-center gap-1.5 py-3 rounded-2xl transition active:scale-95 ${
                    category === cat
                      ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30'
                      : 'bg-[var(--card)] hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                  }`}
                >
                  <span className="text-2xl">{CATEGORY_EMOJI[cat]}</span>
                  <span className="text-xs font-bold truncate w-full px-1 text-center">{t(labelKey)}</span>
                </button>
              );
            })}
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
            {search ? t('shop.searchNoResult') : category ? t('shop.categoryPreparing') : t('shop.comingSoon')}
          </p>
          {(search || category) && (
            <Link
              href="/shop"
              className="inline-flex mt-5 px-5 py-2.5 rounded-full bg-emerald-500 text-white text-sm font-bold active:scale-95"
            >
              {t('shop.viewAllProducts')}
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
                  {t('shop.hotProducts')}
                </h3>
                <span className="text-xs text-[var(--muted)]">{t('shop.itemUnit').replace('{n}', String(featured.length))}</span>
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
                        <button
                          onClick={(e) => handleHeartClick(e, p.id)}
                          className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full bg-white/90 backdrop-blur flex items-center justify-center shadow-sm active:scale-90 transition"
                          aria-label={t('shop.like')}
                        >
                          <Heart
                            size={14}
                            className={wishlistIds.has(p.id) ? 'text-red-500 fill-red-500' : 'text-zinc-400'}
                          />
                        </button>
                        {!!process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY && p.stock <= 0 && (
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
                    {t('shop.allProducts')}
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
                      <button
                        onClick={(e) => handleHeartClick(e, p.id)}
                        className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90 backdrop-blur flex items-center justify-center shadow-sm active:scale-90 transition"
                        aria-label={t('shop.like')}
                      >
                        <Heart
                          size={13}
                          className={wishlistIds.has(p.id) ? 'text-red-500 fill-red-500' : 'text-zinc-400'}
                        />
                      </button>
                      {!!process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY && p.stock <= 0 && (
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
          aria-label={t('shop.cart')}
        >
          <ShoppingCart size={18} />
          <span className="text-sm">{t('shop.fabCart').replace('{n}', String(cartCount))}</span>
        </Link>
      )}

      <BusinessFooter variant="compact" />

      {/* 햄버거 메뉴 (좌측 슬라이드 drawer) */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/55 animate-[fadeIn_0.18s_ease-out]"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="absolute left-0 top-0 bottom-0 w-72 max-w-[80vw] bg-[var(--background)] shadow-2xl overflow-y-auto animate-[slideInLeft_0.22s_ease-out] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-4 border-b border-[var(--card-border)]/30 flex items-center gap-2">
              <AppLogo size={28} />
              <span className="text-base font-extrabold tracking-tight">Routinist {t('shop.title')}</span>
              <button
                onClick={() => setMenuOpen(false)}
                className="ml-auto w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--card-border)]/40 active:scale-90"
                aria-label={t('shop.menuClose')}
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 py-2">
              {[
                { href: '/shop/wishlist', icon: Heart, label: t('shop.menuWishlist') },
                { href: '/shop/orders', icon: ShoppingBag, label: t('shop.menuOrders') },
                { href: '/shop/addresses', icon: MapPin, label: t('shop.menuAddresses') },
                { href: '/mileage', icon: Receipt, label: t('shop.menuMileage') },
                { href: '/support', icon: HelpCircle, label: t('shop.menuSupport') },
                { href: '/shop/info', icon: Info, label: t('shop.menuBusinessInfo') },
                { href: '/shop/terms', icon: FileText, label: t('shop.menuTerms') },
                { href: '/shop/refund', icon: FileText, label: t('shop.menuRefund') },
              ].map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 text-sm font-semibold text-[var(--foreground)] hover:bg-emerald-50 dark:hover:bg-emerald-950/20 active:scale-[0.99] transition"
                >
                  <item.icon size={18} className="text-emerald-500" />
                  <span className="flex-1">{item.label}</span>
                  <ChevronRight size={14} className="text-[var(--muted)]" />
                </Link>
              ))}
            </div>

            {user && (
              <div className="border-t border-[var(--card-border)]/30 p-3">
                <button
                  onClick={async () => {
                    setMenuOpen(false);
                    await signOut();
                    router.replace('/login');
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-xl active:scale-[0.99]"
                >
                  <LogOut size={18} />
                  {t('shop.menuSignOut')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2200} />}

      {/* CSS — slideDown 애니 + scrollbar-hide */}
      <style jsx>{`
        @keyframes slideDown {
          from { transform: translateY(-10px); opacity: 0; }
          to   { transform: translateY(0);     opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes slideInLeft {
          from { transform: translateX(-100%); }
          to   { transform: translateX(0); }
        }
        :global(.scrollbar-hide::-webkit-scrollbar) { display: none; }
      `}</style>
    </div>
  );
}

function SearchSuggestions({ value, onPick }: { value: string; onPick: (q: string) => void }) {
  const { t } = useI18n();
  const SUGGESTED = ['러닝화', '러닝 조끼', '비니', '장갑', '다이어리'];
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('shop_recent_searches');
      if (raw) setRecent(JSON.parse(raw));
    } catch {}
  }, []);

  const clearRecent = () => {
    try { localStorage.removeItem('shop_recent_searches'); } catch {}
    setRecent([]);
  };

  // 검색어 입력 중이면 추천 숨김
  if (value.trim()) return null;

  return (
    <div className="pt-3 pb-2 space-y-3">
      {recent.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-bold text-[var(--muted)]">{t('shop.recentSearch')}</span>
            <button onClick={clearRecent} className="text-[10px] text-[var(--muted)] active:scale-95">{t('shop.clearAll')}</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {recent.map(q => (
              <button
                key={q}
                onClick={() => onPick(q)}
                className="px-3 py-1 rounded-full bg-[var(--card)] border border-[var(--card-border)] text-xs font-bold active:scale-95"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
      <div>
        <span className="text-[11px] font-bold text-[var(--muted)]">{t('shop.suggested')}</span>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {SUGGESTED.map(q => (
            <button
              key={q}
              onClick={() => onPick(q)}
              className="px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-xs font-bold active:scale-95"
            >
              #{q}
            </button>
          ))}
        </div>
      </div>
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
