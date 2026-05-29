'use client';

// 어드민 — Build Detail (build 203 / Phase C).
// 빌드 정보 + 카테고리별 체크리스트. 인터랙티브 체크박스 + strikethrough + 진행률.

import { useEffect, useState, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, Package, CheckCircle, XCircle, Circle, MinusCircle, Loader2, RefreshCw,
  MessageSquare, Save, X,
} from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { isAdminEmail } from '@/lib/admin-emails';
import { getSupabase } from '@/lib/supabase';
import AppToast from '@/components/AppToast';

interface ChecklistItem {
  id: string; category: string; ord: number; title: string;
  detail: string | null; expected: string | null;
  result: 'pending' | 'pass' | 'fail' | 'skip';
  note: string | null;
  checked_by_email: string | null;
  checked_at: string | null;
}

interface BuildDetail {
  release: { build_number: number; marketing_version: string | null; title: string; summary: string | null; released_at: string; commit_sha: string | null } | null;
  checklist: ChecklistItem[];
}

function AdminBuildDetailInner() {
  const searchParams = useSearchParams();
  const buildNumber = Number(searchParams.get('build') ?? 0);
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const [data, setData] = useState<BuildDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteValue, setNoteValue] = useState('');
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
    if (!buildNumber) return;
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data: res, error } = await supabase.rpc('admin_get_build_detail', { p_build_number: buildNumber });
      if (error) throw error;
      setData(res as BuildDetail);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '조회 실패', 'warn');
    } finally { setLoading(false); }
  }, [buildNumber]);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const setResult = async (item: ChecklistItem, next: ChecklistItem['result']) => {
    setBusy(item.id);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.rpc('admin_set_check_result', {
        p_checklist_id: item.id, p_result: next, p_note: item.note,
      });
      if (error) throw error;
      // optimistic update
      setData(d => d ? {
        ...d,
        checklist: d.checklist.map(c => c.id === item.id
          ? { ...c, result: next, checked_at: new Date().toISOString(), checked_by_email: user?.email ?? null }
          : c),
      } : d);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '실패', 'warn');
    } finally { setBusy(null); }
  };

  const saveNote = async (item: ChecklistItem) => {
    setBusy(item.id);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.rpc('admin_set_check_result', {
        p_checklist_id: item.id, p_result: item.result, p_note: noteValue || null,
      });
      if (error) throw error;
      setData(d => d ? {
        ...d,
        checklist: d.checklist.map(c => c.id === item.id ? { ...c, note: noteValue || null } : c),
      } : d);
      setEditingNote(null);
      showToast('메모 저장');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '실패', 'warn');
    } finally { setBusy(null); }
  };

  if (!isAdmin) return null;
  if (loading || !data) {
    return <div className="flex justify-center py-20"><Loader2 size={20} className="animate-spin text-emerald-500" /></div>;
  }

  const release = data.release;
  if (!release) {
    return <div className="text-center py-20 text-sm text-[var(--muted)]">빌드를 찾을 수 없어요</div>;
  }

  // 카테고리 그룹핑
  const groups: Record<string, ChecklistItem[]> = {};
  data.checklist.forEach(c => { (groups[c.category] = groups[c.category] ?? []).push(c); });

  const total = data.checklist.length;
  const pass = data.checklist.filter(c => c.result === 'pass').length;
  const fail = data.checklist.filter(c => c.result === 'fail').length;
  const pct = total > 0 ? Math.round((pass / total) * 100) : 0;

  return (
    <div className="bg-[var(--background)] min-h-screen pb-16">
      <header className="sticky top-0 z-30 bg-[var(--background)]/85 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="max-w-3xl mx-auto flex items-center gap-2 px-4 py-3">
          <Link href="/admin/builds" className="w-10 h-10 flex items-center justify-center rounded-full active:bg-[var(--card-border)]/30">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-xl font-extrabold tracking-tight inline-flex items-center gap-1.5">
            <Package size={18} className="text-emerald-500" /> Build {release.build_number}
          </h1>
          <span className="ml-auto text-[10px] font-bold text-[var(--muted)]">v{release.marketing_version}</span>
          <button onClick={load} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[var(--card-border)]/30">
            <RefreshCw size={14} />
          </button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 pt-4 space-y-4">
        {/* 빌드 메타 */}
        <div className="card p-5 bg-gradient-to-br from-emerald-50/50 via-transparent to-emerald-50/30 dark:from-emerald-950/15">
          <p className="text-lg font-extrabold mb-1">{release.title}</p>
          <p className="text-xs text-[var(--muted)]">{release.released_at}{release.commit_sha ? ` · ${release.commit_sha}` : ''}</p>
          {release.summary && (
            <p className="mt-3 text-xs text-[var(--foreground)] whitespace-pre-wrap leading-relaxed">{release.summary}</p>
          )}
        </div>

        {/* 진행률 */}
        {total > 0 && (
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-2">
              <p className="text-xs font-extrabold uppercase tracking-widest text-[var(--muted)]">진행률</p>
              <span className="ml-auto text-sm font-extrabold tabular-nums">{pass} / {total}</span>
              <span className="text-emerald-600 font-extrabold tabular-nums">{pct}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-[var(--card-border)]/40 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 transition-all" style={{ width: `${pct}%` }} />
            </div>
            {fail > 0 && (
              <p className="text-[11px] text-rose-500 font-bold mt-2 inline-flex items-center gap-1">
                <XCircle size={11} /> {fail}건 실패
              </p>
            )}
          </div>
        )}

        {/* 카테고리별 체크리스트 */}
        {Object.entries(groups).map(([category, items]) => {
          const catPass = items.filter(i => i.result === 'pass').length;
          return (
            <div key={category} className="card p-4">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-extrabold">{category}</h3>
                <span className="text-[10px] text-[var(--muted)] font-bold ml-auto tabular-nums">{catPass} / {items.length}</span>
              </div>
              <ul className="space-y-2">
                {items.map(item => {
                  const checked = item.result === 'pass';
                  const failed = item.result === 'fail';
                  return (
                    <li key={item.id} className={`rounded-xl p-3 border ${
                      failed ? 'bg-rose-50/40 dark:bg-rose-950/15 border-rose-200/40 dark:border-rose-900/30'
                      : checked ? 'bg-emerald-50/40 dark:bg-emerald-950/15 border-emerald-200/40 dark:border-emerald-900/30'
                      : 'bg-[var(--background)] border-[var(--card-border)]/40'
                    }`}>
                      <div className="flex items-start gap-2.5">
                        {/* 결과 토글 (4 상태) */}
                        <div className="flex flex-col gap-1 mt-0.5">
                          <button onClick={() => setResult(item, checked ? 'pending' : 'pass')} disabled={busy === item.id}
                            aria-label="pass"
                            className={`w-6 h-6 rounded-md flex items-center justify-center transition active:scale-90 ${
                              checked ? 'bg-emerald-500 text-white' : 'bg-[var(--card-border)]/30 text-[var(--muted)] hover:bg-emerald-100 dark:hover:bg-emerald-900/30'
                            }`}>
                            <CheckCircle size={14} />
                          </button>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-bold ${checked ? 'line-through text-[var(--muted)]' : ''}`}>{item.title}</p>
                          {item.expected && (
                            <p className={`text-[11px] text-[var(--muted)] mt-0.5 ${checked ? 'line-through' : ''}`}>→ {item.expected}</p>
                          )}
                          {item.checked_by_email && item.checked_at && (
                            <p className="text-[10px] text-[var(--muted)]/70 mt-1">
                              {item.checked_by_email.split('@')[0]} · {new Date(item.checked_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </p>
                          )}
                          {/* 메모 영역 */}
                          {editingNote === item.id ? (
                            <div className="mt-2 flex gap-1.5">
                              <input value={noteValue} onChange={e => setNoteValue(e.target.value)} placeholder="메모"
                                className="flex-1 px-2 py-1 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-xs focus:outline-none focus:border-emerald-500" />
                              <button onClick={() => saveNote(item)} disabled={busy === item.id}
                                className="px-2 py-1 rounded-lg bg-emerald-500 text-white text-[10px] font-extrabold active:scale-95 inline-flex items-center gap-0.5">
                                <Save size={10} /> 저장
                              </button>
                              <button onClick={() => setEditingNote(null)}
                                className="px-2 py-1 rounded-lg bg-[var(--card-border)]/30 text-[10px] font-bold active:scale-95">
                                <X size={10} />
                              </button>
                            </div>
                          ) : item.note ? (
                            <button onClick={() => { setEditingNote(item.id); setNoteValue(item.note ?? ''); }}
                              className="mt-2 text-[11px] text-[var(--foreground)] bg-amber-50 dark:bg-amber-950/20 border border-amber-200/40 dark:border-amber-900/30 px-2 py-1 rounded-lg inline-flex items-center gap-1">
                              <MessageSquare size={10} className="text-amber-500" /> {item.note}
                            </button>
                          ) : (
                            <button onClick={() => { setEditingNote(item.id); setNoteValue(''); }}
                              className="mt-1 text-[10px] text-[var(--muted)] hover:text-emerald-600 inline-flex items-center gap-0.5">
                              <MessageSquare size={9} /> 메모
                            </button>
                          )}
                        </div>

                        {/* fail / skip 버튼 */}
                        <div className="flex flex-col gap-1">
                          <button onClick={() => setResult(item, failed ? 'pending' : 'fail')} disabled={busy === item.id}
                            aria-label="fail"
                            className={`w-6 h-6 rounded-md flex items-center justify-center transition active:scale-90 ${
                              failed ? 'bg-rose-500 text-white' : 'bg-[var(--card-border)]/30 text-[var(--muted)] hover:bg-rose-100 dark:hover:bg-rose-900/30'
                            }`}>
                            <XCircle size={14} />
                          </button>
                          <button onClick={() => setResult(item, item.result === 'skip' ? 'pending' : 'skip')} disabled={busy === item.id}
                            aria-label="skip"
                            className={`w-6 h-6 rounded-md flex items-center justify-center transition active:scale-90 ${
                              item.result === 'skip' ? 'bg-[var(--muted)] text-white' : 'bg-[var(--card-border)]/30 text-[var(--muted)] hover:bg-[var(--card-border)]/60'
                            }`}>
                            <MinusCircle size={14} />
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={1800} />}
    </div>
  );
}

export default function AdminBuildDetailPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 size={20} className="animate-spin text-emerald-500" /></div>}>
      <AdminBuildDetailInner />
    </Suspense>
  );
}
