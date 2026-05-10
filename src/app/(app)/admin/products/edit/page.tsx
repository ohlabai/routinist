'use client';

// 어드민 상품 편집 — id=new 면 신규, 그 외엔 편집.
// 이미지 업로드는 Supabase Storage 'product-images' 버킷 (없으면 자동 생성 — admin 이 수동으로 만들어야 안전).

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ImagePlus, X, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import AppToast from '@/components/AppToast';
import type { Product, ProductStatus, ProductVariant } from '@/types';

const ADMIN_EMAIL = 'hans@openhan.kr';
const STORAGE_BUCKET = 'product-images';

interface FormState {
  name: string;
  description: string;
  category: string;
  brand: string;
  price_krw: number;
  compare_price_krw: number | null;
  stock: number;
  status: ProductStatus;
  is_featured: boolean;
  thumbnail_url: string;
  images: string[];
}

const EMPTY: FormState = {
  name: '', description: '', category: '', brand: '',
  price_krw: 0, compare_price_krw: null, stock: 0,
  status: 'draft', is_featured: false,
  thumbnail_url: '', images: [],
};

function ProductEditContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get('id') ?? 'new';
  const isNew = id === 'new';
  const { user, loading: authLoading } = useAuth();
  const isAdmin = user?.email === ADMIN_EMAIL;

  const [form, setForm] = useState<FormState>(EMPTY);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2500);
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user || !isAdmin) { router.replace('/'); return; }
  }, [authLoading, user, isAdmin, router]);

  useEffect(() => {
    if (isNew || !isAdmin) return;
    const supabase = getSupabase();
    Promise.all([
      supabase.from('products').select('*').eq('id', id).maybeSingle(),
      supabase.from('shop_product_variants').select('*').eq('product_id', id).order('position'),
    ]).then(([pRes, vRes]) => {
      if (pRes.data) {
        const p = pRes.data as Product;
        setForm({
          name: p.name,
          description: p.description ?? '',
          category: p.category ?? '',
          brand: p.brand ?? '',
          price_krw: p.price_krw,
          compare_price_krw: p.compare_price_krw,
          stock: p.stock,
          status: p.status,
          is_featured: p.is_featured,
          thumbnail_url: p.thumbnail_url ?? p.image_url ?? '',
          images: Array.isArray(p.images) ? p.images : [],
        });
      }
      setVariants((vRes.data ?? []) as ProductVariant[]);
    }).catch(e => console.warn('[admin/edit] load', e))
      .finally(() => setLoading(false));
  }, [id, isNew, isAdmin]);

  const handleImageUpload = async (file: File, target: 'thumbnail' | 'gallery') => {
    if (!user) return;
    setUploading(true);
    try {
      const supabase = getSupabase();
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
        cacheControl: '3600', upsert: false, contentType: file.type,
      });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      const url = data.publicUrl;
      if (target === 'thumbnail') {
        setForm(f => ({ ...f, thumbnail_url: url }));
      } else {
        setForm(f => ({ ...f, images: [...f.images, url] }));
      }
      showToast('업로드 완료');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '업로드 실패';
      showToast(msg, 'warn');
    } finally {
      setUploading(false);
    }
  };

  const removeImage = (idx: number) => {
    setForm(f => ({ ...f, images: f.images.filter((_, i) => i !== idx) }));
  };

  const handleSave = async () => {
    if (!form.name.trim() || form.price_krw < 0) {
      showToast('상품명과 가격을 확인해주세요', 'warn');
      return;
    }
    setSaving(true);
    try {
      const supabase = getSupabase();
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        category: form.category.trim() || null,
        brand: form.brand.trim() || null,
        price_krw: form.price_krw,
        compare_price_krw: form.compare_price_krw,
        stock: form.stock,
        status: form.status,
        is_active: form.status === 'published',
        is_featured: form.is_featured,
        thumbnail_url: form.thumbnail_url || null,
        images: form.images,
        source: 'manual',
      };
      if (isNew) {
        const { data, error } = await supabase.from('products').insert(payload).select().single();
        if (error) throw error;
        showToast('등록 완료');
        router.replace(`/admin/products/edit?id=${(data as { id: string }).id}`);
      } else {
        const { error } = await supabase.from('products').update(payload).eq('id', id);
        if (error) throw error;
        showToast('수정 완료');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : '저장 실패', 'warn');
    } finally {
      setSaving(false);
    }
  };

  // 옵션 (variants) — 상품 ID 가 있어야 (신규 상품은 저장 후 진입)
  const addVariant = async () => {
    if (isNew) { showToast('먼저 상품을 저장해주세요', 'warn'); return; }
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.from('shop_product_variants').insert({
        product_id: id,
        option_name: '사이즈',
        option_value: 'M',
        price_delta_krw: 0,
        stock: 0,
        position: variants.length,
      }).select().single();
      if (error) throw error;
      setVariants(prev => [...prev, data as ProductVariant]);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '옵션 추가 실패', 'warn');
    }
  };

  const updateVariant = async (vid: string, patch: Partial<ProductVariant>) => {
    setVariants(prev => prev.map(v => v.id === vid ? { ...v, ...patch } : v));
    try {
      const supabase = getSupabase();
      await supabase.from('shop_product_variants').update(patch).eq('id', vid);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '저장 실패', 'warn');
    }
  };

  const removeVariant = async (vid: string) => {
    if (!confirm('옵션을 삭제하시겠어요?')) return;
    try {
      const supabase = getSupabase();
      await supabase.from('shop_product_variants').delete().eq('id', vid);
      setVariants(prev => prev.filter(v => v.id !== vid));
    } catch (e) {
      showToast(e instanceof Error ? e.message : '삭제 실패', 'warn');
    }
  };

  if (loading || authLoading || !isAdmin) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto pb-32">
      <div className="flex items-center gap-3 px-4 py-3 sticky top-0 bg-[var(--background)]/95 backdrop-blur z-10">
        <Link href="/admin/products" className="p-1 active:scale-90"><ArrowLeft size={24} /></Link>
        <h1 className="text-xl font-bold flex-1">{isNew ? '상품 등록' : '상품 편집'}</h1>
      </div>

      <div className="px-4 space-y-4">
        {/* 썸네일 */}
        <div className="card p-4">
          <p className="text-sm font-bold mb-2">썸네일 이미지</p>
          {form.thumbnail_url ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={form.thumbnail_url} alt="" className="w-full aspect-square object-cover rounded-xl" />
              <button
                onClick={() => setForm(f => ({ ...f, thumbnail_url: '' }))}
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white"
              >
                <X size={16} className="mx-auto" />
              </button>
            </div>
          ) : (
            <label className="flex items-center justify-center aspect-square rounded-xl border-2 border-dashed border-[var(--card-border)] cursor-pointer">
              <input
                type="file" accept="image/*" className="hidden"
                disabled={uploading}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(f, 'thumbnail'); }}
              />
              <div className="text-center">
                <ImagePlus size={32} className="mx-auto text-[var(--muted)] mb-2" />
                <p className="text-xs text-[var(--muted)]">{uploading ? '업로드 중…' : '클릭해서 업로드'}</p>
              </div>
            </label>
          )}
        </div>

        {/* 기본 정보 */}
        <div className="card p-4 space-y-3">
          <Field label="상품명 *">
            <input
              type="text" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm"
            />
          </Field>
          <Field label="설명">
            <textarea
              rows={4} value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm resize-none"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="카테고리">
              <input
                type="text" value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm"
              />
            </Field>
            <Field label="브랜드">
              <input
                type="text" value={form.brand}
                onChange={e => setForm(f => ({ ...f, brand: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm"
              />
            </Field>
          </div>
        </div>

        {/* 가격/재고 */}
        <div className="card p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="판매가 (원)">
              <input
                type="number" min={0}
                value={form.price_krw}
                onChange={e => setForm(f => ({ ...f, price_krw: parseInt(e.target.value) || 0 }))}
                className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm"
              />
            </Field>
            <Field label="정가 (할인 표시용)">
              <input
                type="number" min={0}
                value={form.compare_price_krw ?? ''}
                onChange={e => setForm(f => ({ ...f, compare_price_krw: e.target.value ? parseInt(e.target.value) : null }))}
                className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm"
              />
            </Field>
          </div>
          <Field label="재고 (옵션 없는 경우)">
            <input
              type="number" min={0}
              value={form.stock}
              onChange={e => setForm(f => ({ ...f, stock: parseInt(e.target.value) || 0 }))}
              className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm"
            />
          </Field>
        </div>

        {/* 옵션 (variants) */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold">옵션 (사이즈/색상 등)</p>
            <button onClick={addVariant} className="text-xs text-emerald-600 font-bold inline-flex items-center gap-1 active:scale-95">
              <Plus size={14} /> 추가
            </button>
          </div>
          {variants.length === 0 ? (
            <p className="text-xs text-[var(--muted)] py-3 text-center">옵션 없음 (단일 상품)</p>
          ) : (
            <div className="space-y-2">
              {variants.map(v => (
                <div key={v.id} className="grid grid-cols-[1fr_1fr_70px_60px_32px] gap-2 items-end">
                  <input
                    type="text" placeholder="옵션명" value={v.option_name ?? ''}
                    onChange={e => updateVariant(v.id, { option_name: e.target.value })}
                    className="px-2 py-1.5 rounded border border-[var(--card-border)] bg-[var(--background)] text-xs"
                  />
                  <input
                    type="text" placeholder="값" value={v.option_value ?? ''}
                    onChange={e => updateVariant(v.id, { option_value: e.target.value })}
                    className="px-2 py-1.5 rounded border border-[var(--card-border)] bg-[var(--background)] text-xs"
                  />
                  <input
                    type="number" placeholder="±가격"
                    value={v.price_delta_krw}
                    onChange={e => updateVariant(v.id, { price_delta_krw: parseInt(e.target.value) || 0 })}
                    className="px-2 py-1.5 rounded border border-[var(--card-border)] bg-[var(--background)] text-xs"
                  />
                  <input
                    type="number" placeholder="재고"
                    value={v.stock}
                    onChange={e => updateVariant(v.id, { stock: parseInt(e.target.value) || 0 })}
                    className="px-2 py-1.5 rounded border border-[var(--card-border)] bg-[var(--background)] text-xs"
                  />
                  <button onClick={() => removeVariant(v.id)} className="text-red-500">
                    <Trash2 size={14} className="mx-auto" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 추가 이미지 */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold">상세 이미지</p>
            <label className="text-xs text-emerald-600 font-bold cursor-pointer">
              <input
                type="file" accept="image/*" className="hidden"
                disabled={uploading}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(f, 'gallery'); }}
              />
              <span className="inline-flex items-center gap-1"><Plus size={14} /> 추가</span>
            </label>
          </div>
          {form.images.length === 0 ? (
            <p className="text-xs text-[var(--muted)] py-3 text-center">{uploading ? '업로드 중…' : '추가 이미지 없음'}</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {form.images.map((url, i) => (
                <div key={i} className="relative aspect-square">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="w-full h-full object-cover rounded-lg" />
                  <button
                    onClick={() => removeImage(i)}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white"
                  >
                    <X size={12} className="mx-auto" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 상태 / 추천 */}
        <div className="card p-4 space-y-3">
          <Field label="상태">
            <select
              value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value as ProductStatus }))}
              className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm"
            >
              <option value="draft">임시저장 (미노출)</option>
              <option value="published">판매중 (노출)</option>
              <option value="archived">비활성 (숨김)</option>
            </select>
          </Field>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.is_featured}
              onChange={e => setForm(f => ({ ...f, is_featured: e.target.checked }))}
              className="w-4 h-4 accent-amber-500"
            />
            <span className="text-sm">추천 상품 (홈 상단에 노출)</span>
          </label>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-[var(--background)] border-t border-[var(--card-border)] safe-area-bottom">
        <div className="max-w-lg mx-auto p-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3.5 rounded-xl bg-emerald-500 text-white font-bold text-base active:scale-95 disabled:opacity-50"
          >
            {saving ? '저장 중…' : isNew ? '상품 등록' : '변경 저장'}
          </button>
        </div>
      </div>

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2500} />}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-[var(--muted)] mb-1">{label}</label>
      {children}
    </div>
  );
}

export default function ProductEditPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
      </div>
    }>
      <ProductEditContent />
    </Suspense>
  );
}
