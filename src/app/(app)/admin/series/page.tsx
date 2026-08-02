'use client';

// 어드민 — 챌린지 시리즈 CRUD (build 132)

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Trophy, Save, X } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { isAdminEmail } from '@/lib/admin-emails';
import { getSupabase } from '@/lib/supabase';
import AppToast from '@/components/AppToast';

interface SeriesRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  emoji: string | null;
  is_active: boolean;
  sort_order: number;
}

export default function AdminSeriesPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const [list, setList] = useState<SeriesRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<SeriesRow> | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !isAdmin) { router.replace('/'); return; }
  }, [authLoading, user, isAdmin, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('course_series')
        .select('id, slug, name, description, emoji, is_active, sort_order')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      setList((data ?? []) as SeriesRow[]);
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : '실패', tone: 'warn' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name?.trim() || !editing.slug?.trim()) {
      setToast({ text: '이름과 slug 필수', tone: 'warn' });
      return;
    }
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from('course_series').upsert({
        ...editing,
        is_active: editing.is_active ?? true,
        sort_order: editing.sort_order ?? 0,
      });
      if (error) throw error;
      setToast({ text: '✨ 저장됨', tone: 'ok' });
      setEditing(null);
      await load();
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : '저장 실패', tone: 'warn' });
    }
  };

  if (!isAdmin) return null;

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/85 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <Link href="/admin" className="w-10 h-10 flex items-center justify-center rounded-full active:bg-[var(--card-border)]/30">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-xl font-extrabold tracking-tight inline-flex items-center gap-1.5">
            <Trophy size={18} className="text-amber-500" /> 챌린지 시리즈
          </h1>
          <button
            onClick={() => setEditing({ slug: '', name: '', description: '', emoji: '', is_active: true, sort_order: list.length + 1 })}
            className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-emerald-500 text-white font-bold text-xs active:scale-95"
          >
            <Plus size={12} /> 추가
          </button>
        </div>
      </header>

      <div className="p-4 space-y-2">
        {loading ? (
          [0,1,2].map(i => <div key={i} className="card p-4 h-20 animate-pulse" />)
        ) : list.length === 0 ? (
          <p className="text-center text-sm text-[var(--muted)] py-12">시리즈 없음</p>
        ) : (
          list.map(s => (
            <button
              key={s.id}
              onClick={() => setEditing({ ...s })}
              className="card p-4 w-full text-left active:scale-[0.99]"
            >
              <div className="flex items-center gap-2">
                <span className="text-xl">{s.emoji ?? '🏆'}</span>
                <span className="text-sm font-extrabold flex-1">{s.name}</span>
                {!s.is_active && <span className="text-[12px] font-bold text-rose-500">비활성</span>}
              </div>
              <p className="text-[13px] text-[var(--muted)] mt-0.5 font-mono">{s.slug}</p>
              {s.description && <p className="text-xs text-[var(--muted)] mt-1 line-clamp-2">{s.description}</p>}
            </button>
          ))
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-[80] bg-black/65 flex items-end sm:items-center justify-center sm:p-3" onClick={() => setEditing(null)}>
          <div className="w-full sm:max-w-md bg-[var(--background)] rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-base font-extrabold">{editing.id ? '시리즈 수정' : '시리즈 추가'}</h3>
              <button onClick={() => setEditing(null)} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[var(--card-border)]/40 active:scale-90">
                <X size={18} />
              </button>
            </div>

            <Field label="Slug (영문, 고유)">
              <input value={editing.slug ?? ''} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} className={inputCls} placeholder="korea_heritage" />
            </Field>
            <Field label="이모지">
              <input value={editing.emoji ?? ''} onChange={(e) => setEditing({ ...editing, emoji: e.target.value })} className={inputCls} placeholder="🇰🇷" />
            </Field>
            <Field label="이름">
              <input value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={inputCls} />
            </Field>
            <Field label="설명">
              <textarea value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={3} className={`${inputCls} resize-none`} />
            </Field>
            <Field label="정렬 순서">
              <input type="number" value={editing.sort_order ?? 0} onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })} className={inputCls} />
            </Field>
            <label className="flex items-center gap-2 mt-3 cursor-pointer">
              <input type="checkbox" checked={editing.is_active ?? true} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} />
              <span className="text-sm">활성</span>
            </label>
            <button onClick={handleSave} className="w-full mt-4 py-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-sm active:scale-[0.98] inline-flex items-center justify-center gap-1.5">
              <Save size={14} /> 저장
            </button>
          </div>
        </div>
      )}

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2200} />}
    </div>
  );
}

const inputCls = 'w-full px-3.5 py-2.5 rounded-xl border-2 border-[var(--card-border)] bg-[var(--background)] text-sm focus:outline-none focus:border-emerald-500';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      <label className="block text-xs font-bold text-[var(--muted)] mb-1">{label}</label>
      {children}
    </div>
  );
}
