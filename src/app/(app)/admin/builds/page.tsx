'use client';

// 어드민 — Build Dashboard 목록 (build 203 / Phase C).

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Package, CheckCircle, XCircle, Circle, Loader2, RefreshCw, Plus, Pencil, Trash2, X, Save } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { isAdminEmail } from '@/lib/admin-emails';
import { getSupabase } from '@/lib/supabase';
import AppToast from '@/components/AppToast';

interface BuildRow {
  build_number: number;
  marketing_version: string | null;
  title: string;
  released_at: string;
  total_checks: number;
  passed: number;
  failed: number;
  pending: number;
}

interface EditForm {
  build_number: string;
  marketing_version: string;
  title: string;
  summary: string;
  commit_sha: string;
  released_at: string;
}

function todayIsoDate(): string {
  const d = new Date();
  // KST 보정 — released_at 은 DATE (timezone 없음).
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

const EMPTY_FORM: EditForm = {
  build_number: '', marketing_version: '', title: '', summary: '', commit_sha: '',
  released_at: todayIsoDate(),
};

export default function AdminBuildsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const [rows, setRows] = useState<BuildRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditForm | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !isAdmin) { router.replace('/'); return; }
  }, [authLoading, user, isAdmin, router]);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.rpc('admin_list_builds');
      if (error) throw error;
      setRows((data ?? []) as BuildRow[]);
    } catch (e) { console.warn(e); } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const startNew = () => {
    setEditing({ ...EMPTY_FORM });
    setIsNew(true);
  };

  const startEdit = (r: BuildRow, full: { summary?: string | null; commit_sha?: string | null }) => {
    setEditing({
      build_number: String(r.build_number),
      marketing_version: r.marketing_version ?? '',
      title: r.title ?? '',
      summary: full.summary ?? '',
      commit_sha: full.commit_sha ?? '',
      released_at: r.released_at ?? todayIsoDate(),
    });
    setIsNew(false);
  };

  const save = async () => {
    if (!editing) return;
    const buildNum = Number(editing.build_number);
    if (!buildNum || buildNum <= 0) { showToast('빌드 번호를 입력해주세요', 'warn'); return; }
    if (!editing.title.trim()) { showToast('제목을 입력해주세요', 'warn'); return; }
    if (!editing.released_at) { showToast('출시일을 입력해주세요', 'warn'); return; }
    setSaving(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.rpc('admin_upsert_build', {
        p_build_number: buildNum,
        p_title: editing.title.trim(),
        p_released_at: editing.released_at,
        p_marketing_version: editing.marketing_version.trim() || null,
        p_summary: editing.summary.trim() || null,
        p_commit_sha: editing.commit_sha.trim() || null,
      });
      if (error) throw error;
      showToast(isNew ? '빌드 추가됨' : '빌드 수정됨');
      setEditing(null);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '저장 실패', 'warn');
    } finally { setSaving(false); }
  };

  const remove = async (buildNumber: number) => {
    if (!confirm(`build ${buildNumber} 와 모든 체크리스트를 삭제할까요? 되돌릴 수 없어요.`)) return;
    try {
      const supabase = getSupabase();
      const { error } = await supabase.rpc('admin_delete_build', { p_build_number: buildNumber });
      if (error) throw error;
      showToast('빌드 삭제됨');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '삭제 실패', 'warn');
    }
  };

  if (!isAdmin) return null;

  return (
    <div className="bg-[var(--background)] min-h-screen pb-12">
      <header className="sticky top-0 z-30 bg-[var(--background)]/85 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="max-w-4xl mx-auto flex items-center gap-2 px-4 py-3">
          <Link href="/admin" className="w-10 h-10 flex items-center justify-center rounded-full active:bg-[var(--card-border)]/30">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-xl font-extrabold tracking-tight inline-flex items-center gap-1.5">
            <Package size={18} className="text-emerald-500" /> Build Dashboard
          </h1>
          <span className="ml-auto text-xs font-bold text-[var(--muted)]">{rows.length}건</span>
          <button onClick={load} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[var(--card-border)]/30">
            <RefreshCw size={14} />
          </button>
          <button onClick={startNew} className="ml-1 px-3 h-9 rounded-full bg-emerald-500 text-white text-xs font-extrabold inline-flex items-center gap-1 active:scale-95 shadow-md shadow-emerald-500/30">
            <Plus size={14} /> 추가
          </button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 pt-4 space-y-2">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-emerald-500" /></div>
        ) : rows.length === 0 ? (
          <p className="text-center py-16 text-sm text-[var(--muted)]">아직 등록된 빌드가 없어요</p>
        ) : (
          rows.map(r => {
            const pct = r.total_checks > 0 ? Math.round((r.passed / r.total_checks) * 100) : 0;
            return (
              <div key={r.build_number} className="card p-4 flex items-center gap-3 relative hover:bg-emerald-50/40 dark:hover:bg-emerald-950/10 transition">
                <Link href={`/admin/builds/detail?build=${r.build_number}`} className="absolute inset-0 rounded-2xl" aria-label={`build ${r.build_number} detail`} />
                <div className="w-14 text-center flex-shrink-0 relative pointer-events-none">
                  <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest">v{r.marketing_version}</p>
                  <p className="text-2xl font-extrabold tabular-nums text-emerald-600">{r.build_number}</p>
                </div>
                <div className="flex-1 min-w-0 relative pointer-events-none">
                  <p className="text-sm font-extrabold truncate">{r.title}</p>
                  <p className="text-[11px] text-[var(--muted)] mt-0.5">{r.released_at}</p>
                  {r.total_checks > 0 && (
                    <div className="mt-2 flex items-center gap-3 text-[11px]">
                      <span className="inline-flex items-center gap-0.5 text-emerald-600 font-bold">
                        <CheckCircle size={11} /> {r.passed}
                      </span>
                      {r.failed > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-rose-500 font-bold">
                          <XCircle size={11} /> {r.failed}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-0.5 text-[var(--muted)]">
                        <Circle size={11} /> {r.pending}
                      </span>
                      <span className="ml-auto font-extrabold text-[var(--muted)]">{pct}%</span>
                    </div>
                  )}
                </div>
                {r.total_checks > 0 && (
                  <div className="w-14 h-14 flex-shrink-0 relative pointer-events-none">
                    <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                      <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeWidth="3" className="text-[var(--card-border)]/40" />
                      <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeWidth="3"
                        strokeDasharray={`${(pct / 100) * 2 * Math.PI * 16} ${2 * Math.PI * 16}`}
                        className="text-emerald-500" strokeLinecap="round" />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center text-[11px] font-extrabold">{pct}%</div>
                  </div>
                )}
                {/* 수정 / 삭제 — absolute 카드 위, Link 보다 z-index 높게 */}
                <div className="absolute top-2 right-2 flex gap-1 z-10">
                  <button onClick={(e) => { e.stopPropagation(); startEdit(r, {}); }}
                    className="w-7 h-7 rounded-full flex items-center justify-center bg-[var(--background)]/80 backdrop-blur-sm border border-[var(--card-border)]/40 text-[var(--muted)] hover:text-emerald-600 active:scale-90"
                    aria-label="수정">
                    <Pencil size={12} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); remove(r.build_number); }}
                    className="w-7 h-7 rounded-full flex items-center justify-center bg-[var(--background)]/80 backdrop-blur-sm border border-[var(--card-border)]/40 text-[var(--muted)] hover:text-rose-500 active:scale-90"
                    aria-label="삭제">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 빌드 추가/수정 모달 */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-2" onClick={() => !saving && setEditing(null)}>
          <div className="bg-[var(--background)] rounded-3xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-[var(--background)]/95 backdrop-blur-lg border-b border-[var(--card-border)]/30 px-5 py-3 flex items-center gap-2">
              <h2 className="text-base font-extrabold">{isNew ? '빌드 추가' : `빌드 ${editing.build_number} 수정`}</h2>
              <button onClick={() => !saving && setEditing(null)} className="ml-auto w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--card-border)]/30">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-[11px] font-extrabold text-[var(--muted)] uppercase tracking-widest">빌드 번호 *</label>
                <input type="number" inputMode="numeric" value={editing.build_number} disabled={!isNew}
                  onChange={(e) => setEditing({ ...editing, build_number: e.target.value })}
                  className="mt-1 w-full px-3 py-2 rounded-xl bg-[var(--card-bg)] border border-[var(--card-border)] text-sm font-bold tabular-nums focus:outline-none focus:border-emerald-500 disabled:opacity-60" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-extrabold text-[var(--muted)] uppercase tracking-widest">버전</label>
                  <input value={editing.marketing_version} placeholder="1.2.2"
                    onChange={(e) => setEditing({ ...editing, marketing_version: e.target.value })}
                    className="mt-1 w-full px-3 py-2 rounded-xl bg-[var(--card-bg)] border border-[var(--card-border)] text-sm focus:outline-none focus:border-emerald-500" />
                </div>
                <div>
                  <label className="text-[11px] font-extrabold text-[var(--muted)] uppercase tracking-widest">출시일 *</label>
                  <input type="date" value={editing.released_at}
                    onChange={(e) => setEditing({ ...editing, released_at: e.target.value })}
                    className="mt-1 w-full px-3 py-2 rounded-xl bg-[var(--card-bg)] border border-[var(--card-border)] text-sm focus:outline-none focus:border-emerald-500" />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-extrabold text-[var(--muted)] uppercase tracking-widest">제목 *</label>
                <input value={editing.title} placeholder="예: GPS 정확도 fix + 백그라운드 트래커"
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  className="mt-1 w-full px-3 py-2 rounded-xl bg-[var(--card-bg)] border border-[var(--card-border)] text-sm font-bold focus:outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="text-[11px] font-extrabold text-[var(--muted)] uppercase tracking-widest">요약</label>
                <textarea value={editing.summary} rows={4} placeholder="이 빌드의 주요 변경사항 / 사용자 보고 fix..."
                  onChange={(e) => setEditing({ ...editing, summary: e.target.value })}
                  className="mt-1 w-full px-3 py-2 rounded-xl bg-[var(--card-bg)] border border-[var(--card-border)] text-sm leading-relaxed focus:outline-none focus:border-emerald-500 resize-none" />
              </div>
              <div>
                <label className="text-[11px] font-extrabold text-[var(--muted)] uppercase tracking-widest">commit SHA</label>
                <input value={editing.commit_sha} placeholder="41a37b5"
                  onChange={(e) => setEditing({ ...editing, commit_sha: e.target.value })}
                  className="mt-1 w-full px-3 py-2 rounded-xl bg-[var(--card-bg)] border border-[var(--card-border)] text-xs font-mono tabular-nums focus:outline-none focus:border-emerald-500" />
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => !saving && setEditing(null)} disabled={saving}
                  className="flex-1 py-2.5 rounded-xl bg-[var(--card-border)]/40 text-sm font-extrabold active:scale-95">
                  취소
                </button>
                <button onClick={save} disabled={saving}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white text-sm font-extrabold inline-flex items-center justify-center gap-1 active:scale-95 shadow-md shadow-emerald-500/30 disabled:opacity-60">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  저장
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={1800} />}
    </div>
  );
}
