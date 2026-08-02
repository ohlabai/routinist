'use client';

// build 205 #15: 셀러 콘솔 — 본인 상품 list. 등록·편집은 /admin/products/edit 재사용 (RLS 가 seller_id 보호).

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Edit2, Trash2, Image as ImageIcon, Package, Store } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import AppToast from '@/components/AppToast';
import type { Product, ProductStatus } from '@/types';

type StatusFilter = 'all' | 'published' | 'draft' | 'archived';
const FILTER_LABELS: Record<StatusFilter, string> = { all: '전체', published: '판매중', draft: '임시저장', archived: '비활성' };

export default function SellerProductsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [seller, setSeller] = useState<{ id: string; brand_name: string; status: string } | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login?redirect=/seller/products');
  }, [authLoading, user, router]);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2500);
  };

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const sb = getSupabase();
      const { data: s } = await sb.from('sellers').select('id, brand_name, status').eq('user_id', user.id).maybeSingle();
      if (!s || s.status !== 'active') {
        setSeller(null);
        return;
      }
      setSeller(s);
      let q = sb.from('products').select('*').eq('seller_id', s.id).order('created_at', { ascending: false });
      if (filter !== 'all') q = q.eq('status', filter);
      const { data } = await q;
      setProducts((data ?? []) as Product[]);
    } finally { setLoading(false); }
  }, [user, filter]);
  useEffect(() => { load(); }, [load]);

  const handleStatusChange = async (id: string, status: ProductStatus) => {
    try {
      const sb = getSupabase();
      const { error } = await sb.from('products').update({ status }).eq('id', id);
      if (error) throw error;
      setProducts(prev => prev.map(p => p.id === id ? { ...p, status, is_active: status === 'published' } : p));
      showToast(`상태: ${FILTER_LABELS[status as StatusFilter] ?? status}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '실패', 'warn');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`"${name}" 상품을 영구 삭제하시겠어요?`)) return;
    try {
      const sb = getSupabase();
      const { error } = await sb.from('products').delete().eq('id', id);
      if (error) throw error;
      setProducts(prev => prev.filter(p => p.id !== id));
      showToast('삭제 완료');
    } catch (e) { showToast(e instanceof Error ? e.message : '실패', 'warn'); }
  };

  if (authLoading || loading) return <div className="flex justify-center py-20"><div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" /></div>;

  if (!seller) {
    return (
      <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen px-6 py-12 text-center">
        <Store size={48} className="mx-auto text-emerald-500 mb-4 opacity-60" />
        <h1 className="text-xl font-extrabold mb-2">아직 판매자가 아니에요</h1>
        <p className="text-sm text-[var(--muted)] mb-6 break-keep">상품을 직접 등록하려면 판매자 신청을 먼저 해주세요.</p>
        <Link href="/seller/apply" className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-sm font-extrabold active:scale-95 shadow-md shadow-emerald-500/30">
          판매자 신청
        </Link>
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
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-extrabold tracking-tight truncate">{seller.brand_name}</h1>
            <p className="text-[12px] text-[var(--muted)]">셀러 콘솔</p>
          </div>
          <Link
            href={`/admin/products/edit?id=new&seller_id=${seller.id}`}
            className="text-xs font-bold text-emerald-600 inline-flex items-center gap-1 active:scale-95 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30"
          >
            <Plus size={14} /> 신규
          </Link>
        </div>
        <div className="flex gap-1.5 px-3 pb-3 overflow-x-auto">
          {(Object.keys(FILTER_LABELS) as StatusFilter[]).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition active:scale-95 ${
                filter === f ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30' : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
              }`}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>
      </header>

      <div className="px-4 pt-4 space-y-2.5">
        {products.length === 0 ? (
          <div className="text-center py-16">
            <Package size={36} className="mx-auto text-emerald-500 opacity-60 mb-3" />
            <p className="text-sm font-bold mb-3">{FILTER_LABELS[filter]} 상품이 없어요</p>
            <Link href={`/admin/products/edit?id=new&seller_id=${seller.id}`}
              className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-sm font-bold active:scale-95">
              <Plus size={14} /> 첫 상품 등록
            </Link>
          </div>
        ) : products.map(p => (
          <div key={p.id} onClick={() => router.push(`/admin/products/edit?id=${p.id}`)}
            className="card p-3 flex gap-3 cursor-pointer active:scale-[0.99] transition">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950 overflow-hidden flex-shrink-0">
              {p.thumbnail_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.thumbnail_url} alt={p.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[var(--muted)]"><ImageIcon size={20} /></div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold line-clamp-1">{p.name}</p>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-sm font-extrabold">{p.price_krw.toLocaleString()}원</span>
                <span className="text-[12px] text-[var(--muted)] font-medium">재고 {p.stock}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-2">
                <select
                  value={p.status}
                  onClick={e => e.stopPropagation()}
                  onChange={e => { e.stopPropagation(); handleStatusChange(p.id, e.target.value as ProductStatus); }}
                  className="text-[12px] font-bold px-2 py-1 rounded-full border border-[var(--card-border)] bg-[var(--background)] focus:outline-none focus:border-emerald-500"
                >
                  <option value="published">판매중</option>
                  <option value="draft">임시저장</option>
                  <option value="archived">비활성</option>
                </select>
                <Link href={`/admin/products/edit?id=${p.id}`} onClick={e => e.stopPropagation()}
                  className="text-[13px] font-bold text-emerald-600 inline-flex items-center gap-0.5 active:scale-95">
                  <Edit2 size={11} /> 편집
                </Link>
                <button onClick={e => { e.stopPropagation(); handleDelete(p.id, p.name); }}
                  className="ml-auto text-[13px] font-bold text-red-500 inline-flex items-center gap-0.5 active:scale-95">
                  <Trash2 size={11} /> 삭제
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2500} />}
    </div>
  );
}
