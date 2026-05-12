'use client';

// 어드민 — 가상 코스 등록/수정 (build 106).

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Globe, Save, X } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { isAdminEmail } from '@/lib/admin-emails';
import { adminListAllCourses, adminUpsertCourse, type VirtualCourse, type CourseUpsert } from '@/lib/world-data';
import AppToast from '@/components/AppToast';

export default function AdminCoursesPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const [list, setList] = useState<VirtualCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CourseUpsert | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !isAdmin) { router.replace('/'); return; }
  }, [authLoading, user, isAdmin, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await adminListAllCourses();
      setList(all);
    } catch (e) {
      console.warn('[admin/courses] fail', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name.trim() || editing.distance_km <= 0) {
      setToast({ text: '이름과 거리를 확인해주세요', tone: 'warn' });
      return;
    }
    try {
      await adminUpsertCourse({
        ...editing,
        name: editing.name.trim(),
        distance_km: Number(editing.distance_km),
      });
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
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <Link href="/admin" className="w-10 h-10 flex items-center justify-center rounded-full active:bg-[var(--card-border)]/30">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-xl font-extrabold tracking-tight inline-flex items-center gap-1.5">
            <Globe size={18} className="text-emerald-500" /> 가상 코스
          </h1>
          <button
            onClick={() => setEditing({ name: '', distance_km: 0, country: '', description: '', is_active: true, sort_order: list.length + 1 })}
            className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-emerald-500 text-white font-bold text-xs active:scale-95"
          >
            <Plus size={12} /> 추가
          </button>
        </div>
      </header>

      <div className="p-4 space-y-2">
        {loading ? (
          [0, 1, 2].map(i => <div key={i} className="card p-4 h-20 animate-pulse" />)
        ) : (
          list.map(c => (
            <button
              key={c.id}
              onClick={() => setEditing({
                id: c.id,
                name: c.name,
                distance_km: c.distance_km,
                country: c.country ?? '',
                description: c.description ?? '',
                hero_image_url: c.hero_image_url ?? '',
                is_active: c.is_active ?? true,
                sort_order: c.sort_order ?? 0,
              })}
              className="card p-4 w-full text-left active:scale-[0.99]"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-extrabold flex-1">{c.name}</span>
                {!c.is_active && <span className="text-[10px] font-bold text-rose-500">비활성</span>}
              </div>
              <p className="text-xs text-[var(--muted)] mt-0.5">{c.country ?? '—'} · {c.distance_km.toFixed(1)}km</p>
            </button>
          ))
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-[80] bg-black/65 flex items-end sm:items-center justify-center p-3" onClick={() => setEditing(null)}>
          <div className="w-full max-w-md bg-[var(--background)] rounded-3xl p-5 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-base font-extrabold">{editing.id ? '코스 수정' : '코스 추가'}</h3>
              <button onClick={() => setEditing(null)} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--card-border)]/40 active:scale-90">
                <X size={16} />
              </button>
            </div>
            <Field label="이름">
              <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={fieldCls} />
            </Field>
            <Field label="거리 (km)">
              <input type="number" step="0.1" value={editing.distance_km} onChange={(e) => setEditing({ ...editing, distance_km: Number(e.target.value) })} className={fieldCls} />
            </Field>
            <Field label="국가 (이모지+이름)">
              <input value={editing.country ?? ''} onChange={(e) => setEditing({ ...editing, country: e.target.value })} className={fieldCls} placeholder="🇰🇷 한국" />
            </Field>
            <Field label="설명">
              <textarea value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={3} className={`${fieldCls} resize-none`} />
            </Field>
            <Field label="hero 이미지 URL (선택)">
              <input value={editing.hero_image_url ?? ''} onChange={(e) => setEditing({ ...editing, hero_image_url: e.target.value })} className={fieldCls} placeholder="https://..." />
            </Field>
            <Field label="정렬 순서">
              <input type="number" value={editing.sort_order ?? 0} onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })} className={fieldCls} />
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

const fieldCls = 'w-full px-3.5 py-2.5 rounded-xl border-2 border-[var(--card-border)] bg-[var(--background)] text-sm focus:outline-none focus:border-emerald-500';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      <label className="block text-xs font-bold text-[var(--muted)] mb-1">{label}</label>
      {children}
    </div>
  );
}
