'use client';

// 어드민 상품 관리 — 모던 모바일 UX/UI (에메랄드 그린).

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Edit2, Trash2, Image as ImageIcon, Star, Package } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import AppToast from '@/components/AppToast';
import type { Product, ProductStatus } from '@/types';

const ADMIN_EMAIL = 'hans@openhan.kr';
type StatusFilter = 'all' | 'published' | 'draft' | 'archived';

const FILTER_LABELS: Record<StatusFilter, string> = {
  all: '전체', published: '판매중', draft: '임시저장', archived: '비활성',
};

export default function AdminProductsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = user?.email === ADMIN_EMAIL;
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    if (!isAdmin) { router.replace('/'); return; }
  }, [authLoading, user, isAdmin, router]);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2500);
  };

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const supabase = getSupabase();
      let q = supabase.from('products').select('*').order('created_at', { ascending: false }).limit(200);
      if (filter !== 'all') q = q.eq('status', filter);
      const { data, error } = await q;
      if (error) throw error;
      setProducts((data ?? []) as Product[]);
    } catch (e) {
      console.warn('[admin/products] load fail', e);
      showToast('로드 실패', 'warn');
    } finally { setLoading(false); }
  }, [filter, isAdmin]);

  useEffect(() => { load(); }, [load]);

  const handleStatusChange = async (id: string, status: ProductStatus) => {
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from('products').update({ status, is_active: status === 'published' }).eq('id', id);
      if (error) throw error;
      setProducts(prev => prev.map(p => p.id === id ? { ...p, status, is_active: status === 'published' } : p));
      showToast(`상태: ${status}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '실패', 'warn');
    }
  };

  const handleFeatured = async (id: string, on: boolean) => {
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from('products').update({ is_featured: on }).eq('id', id);
      if (error) throw error;
      setProducts(prev => prev.map(p => p.id === id ? { ...p, is_featured: on } : p));
    } catch (e) {
      showToast(e instanceof Error ? e.message : '실패', 'warn');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`"${name}" 상품을 영구 삭제하시겠어요?\n주문에 사용 중이면 archived 처리 권장`)) return;
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) throw error;
      setProducts(prev => prev.filter(p => p.id !== id));
      showToast('삭제 완료');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '삭제 실패', 'warn');
    }
  };

  if (authLoading || !isAdmin) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-extrabold tracking-tight flex-1">상품 관리</h1>
          <Link
            href="/admin/products/edit?id=new"
            className="text-xs font-bold text-emerald-600 inline-flex items-center gap-1 active:scale-95 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30"
          >
            <Plus size={14} /> 신규
          </Link>
        </div>
        {/* 필터 칩 */}
        <div className="flex gap-1.5 px-3 pb-3 overflow-x-auto scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
          {(Object.keys(FILTER_LABELS) as StatusFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition active:scale-95 ${
                filter === f
                  ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30'
                  : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
              }`}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>
      </header>

      {loading ? (
        <div className="px-4 pt-4 space-y-2.5">
          {[0,1,2,3].map(i => (
            <div key={i} className="card p-3 flex gap-3 animate-pulse">
              <div className="w-16 h-16 rounded-2xl bg-[var(--card-border)]/50" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-2/3 bg-[var(--card-border)]/50 rounded" />
                <div className="h-3 w-1/3 bg-[var(--card-border)]/50 rounded" />
                <div className="h-4 w-1/2 bg-[var(--card-border)]/50 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : products.length === 0 ? (
        <div className="text-center py-20 px-6">
          <div className="w-20 h-20 rounded-full bg-emerald-50 dark:bg-emerald-950/30 mx-auto mb-4 flex items-center justify-center">
            <Package size={36} className="text-emerald-500" />
          </div>
          <p className="text-base font-bold mb-1">{FILTER_LABELS[filter]} 상품이 없어요</p>
          <Link
            href="/admin/products/edit?id=new"
            className="mt-5 inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-sm font-bold active:scale-95"
          >
            <Plus size={14} /> 첫 상품 등록
          </Link>
        </div>
      ) : (
        <div className="px-4 pt-4 space-y-2.5">
          {products.map(p => (
            <div key={p.id} className="card p-3 flex gap-3">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950 overflow-hidden flex-shrink-0 relative">
                {p.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumbnail_url} alt={p.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[var(--muted)]"><ImageIcon size={20} /></div>
                )}
                {p.source === 'cafe24' && (
                  <span className="absolute top-0 left-0 text-[8px] bg-blue-500 text-white px-1 py-0.5 rounded-br-md font-extrabold">C24</span>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-bold text-[var(--foreground)] line-clamp-1">{p.name}</p>
                  <button
                    onClick={() => handleFeatured(p.id, !p.is_featured)}
                    className={`flex-shrink-0 active:scale-90 ${p.is_featured ? 'text-amber-500' : 'text-[var(--muted)]'}`}
                    aria-label="추천 토글"
                  >
                    <Star size={16} fill={p.is_featured ? 'currentColor' : 'transparent'} />
                  </button>
                </div>
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className="text-sm font-extrabold text-[var(--foreground)]">
                    {p.price_krw.toLocaleString()}원
                  </span>
                  <span className="text-[10px] text-[var(--muted)] font-medium">재고 {p.stock}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-2">
                  <select
                    value={p.status}
                    onChange={e => handleStatusChange(p.id, e.target.value as ProductStatus)}
                    className="text-[10px] font-bold px-2 py-1 rounded-full border border-[var(--card-border)] bg-[var(--background)] focus:outline-none focus:border-emerald-500"
                  >
                    <option value="published">판매중</option>
                    <option value="draft">임시저장</option>
                    <option value="archived">비활성</option>
                  </select>
                  <Link
                    href={`/admin/products/edit?id=${p.id}`}
                    className="text-[11px] font-bold text-emerald-600 inline-flex items-center gap-0.5 active:scale-95"
                  >
                    <Edit2 size={11} /> 편집
                  </Link>
                  <button
                    onClick={() => handleDelete(p.id, p.name)}
                    className="ml-auto text-[11px] font-bold text-red-500 inline-flex items-center gap-0.5 active:scale-95"
                  >
                    <Trash2 size={11} /> 삭제
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2500} />}

      <style jsx>{`:global(.scrollbar-hide::-webkit-scrollbar) { display: none; }`}</style>
    </div>
  );
}
