'use client';

// 어드민 상품 관리 — 목록 / 신규 / 편집 / 삭제 / 옵션 / 이미지 업로드.
// hans@openhan.kr 만 접근. RLS 의 is_shop_admin() 함수가 server side 보호.

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
    } finally {
      setLoading(false);
    }
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
    if (!confirm(`"${name}" 상품을 영구 삭제하시겠어요? (주문에 사용 중이면 archived 처리 권장)`)) return;
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) throw error;
      setProducts(prev => prev.filter(p => p.id !== id));
      showToast('삭제 완료');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '삭제 실패';
      showToast(msg, 'warn');
    }
  };

  if (authLoading || !isAdmin) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto pb-12">
      <div className="flex items-center gap-3 px-4 py-3 sticky top-0 bg-[var(--background)]/95 backdrop-blur z-10">
        <button onClick={() => router.back()} className="p-1 active:scale-90"><ArrowLeft size={24} /></button>
        <h1 className="text-xl font-bold flex-1">상품 관리</h1>
        <Link
          href="/admin/products/edit?id=new"
          className="text-sm text-emerald-600 font-bold inline-flex items-center gap-1 active:scale-95"
        >
          <Plus size={16} /> 신규
        </Link>
      </div>

      {/* 필터 */}
      <div className="flex gap-2 px-4 mb-3 overflow-x-auto pb-1">
        {(['all', 'published', 'draft', 'archived'] as StatusFilter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition active:scale-95 ${
              filter === f ? 'bg-[var(--accent)] text-white' : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
            }`}
          >
            {f === 'all' ? '전체' : f === 'published' ? '판매중' : f === 'draft' ? '임시저장' : '비활성'} ({filter === f ? products.length : '·'})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
        </div>
      ) : products.length === 0 ? (
        <div className="text-center py-16">
          <Package size={40} className="mx-auto mb-3 text-[var(--muted)]" />
          <p className="text-sm text-[var(--muted)]">상품이 없어요</p>
          <Link
            href="/admin/products/edit?id=new"
            className="mt-3 inline-block px-4 py-2 rounded-xl bg-emerald-500 text-white text-sm font-bold"
          >
            첫 상품 등록
          </Link>
        </div>
      ) : (
        <div className="px-4 space-y-2">
          {products.map(p => (
            <div key={p.id} className="card p-3 flex gap-3">
              <div className="w-16 h-16 rounded-lg bg-[var(--card-border)] overflow-hidden flex-shrink-0 relative">
                {p.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumbnail_url} alt={p.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[var(--muted)]"><ImageIcon size={20} /></div>
                )}
                {p.source === 'cafe24' && (
                  <span className="absolute top-0 left-0 text-[8px] bg-blue-500 text-white px-1 rounded-br">C24</span>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-bold text-[var(--foreground)] line-clamp-1">{p.name}</p>
                  <button
                    onClick={() => handleFeatured(p.id, !p.is_featured)}
                    className={p.is_featured ? 'text-amber-500' : 'text-[var(--muted)]'}
                    aria-label="추천 토글"
                  >
                    <Star size={16} fill={p.is_featured ? 'currentColor' : 'transparent'} />
                  </button>
                </div>

                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className="text-sm font-semibold text-[var(--foreground)]">
                    {p.price_krw.toLocaleString()}원
                  </span>
                  <span className="text-xs text-[var(--muted)]">재고 {p.stock}</span>
                </div>

                <div className="flex items-center gap-2 mt-2">
                  <select
                    value={p.status}
                    onChange={e => handleStatusChange(p.id, e.target.value as ProductStatus)}
                    className="text-xs px-2 py-1 rounded border border-[var(--card-border)] bg-[var(--background)]"
                  >
                    <option value="published">판매중</option>
                    <option value="draft">임시저장</option>
                    <option value="archived">비활성</option>
                  </select>
                  <Link
                    href={`/admin/products/edit?id=${p.id}`}
                    className="text-xs text-[var(--muted)] inline-flex items-center gap-0.5 active:scale-95"
                  >
                    <Edit2 size={12} /> 편집
                  </Link>
                  <button
                    onClick={() => handleDelete(p.id, p.name)}
                    className="text-xs text-red-500 inline-flex items-center gap-0.5 active:scale-95 ml-auto"
                  >
                    <Trash2 size={12} /> 삭제
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2500} />}
    </div>
  );
}
