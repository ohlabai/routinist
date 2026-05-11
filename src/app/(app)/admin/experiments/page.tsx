'use client';

// A/B 실험 — 모던 모바일 UX/UI (에메랄드 그린).

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Plus, Beaker, Play, Pause, Square, BarChart2,
} from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import AppToast from '@/components/AppToast';

import { isAdminEmail } from '@/lib/admin-emails';

interface Experiment {
  id: string; name: string; description: string | null;
  variants: string[]; status: 'draft' | 'running' | 'paused' | 'completed';
  traffic_pct: number; primary_metric: string | null;
  start_at: string | null; end_at: string | null; created_at: string;
}
interface Result {
  variant: string; user_count: number; event_count: number;
  conversion_rate: number; total_value: number;
}

export default function ExperimentsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [results, setResults] = useState<Record<string, Result[]>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newVariants, setNewVariants] = useState('control,A,B');
  const [newDescription, setNewDescription] = useState('');
  const [newMetric, setNewMetric] = useState('');
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
      const { data, error } = await supabase.from('experiments').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      setExperiments((data ?? []) as Experiment[]);
      for (const exp of (data ?? []) as Experiment[]) {
        if (exp.status === 'running' || exp.status === 'completed') {
          supabase.rpc('experiment_results', { p_name: exp.name }).then(({ data: r }) => {
            setResults(prev => ({ ...prev, [exp.name]: (r ?? []) as Result[] }));
          });
        }
      }
    } catch (e) {
      console.warn('[experiments] load fail', e);
    } finally { setLoading(false); }
  }, [isAdmin]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!newName.trim()) { showToast('실험 이름이 필요해요', 'warn'); return; }
    const variants = newVariants.split(',').map(v => v.trim()).filter(Boolean);
    if (variants.length < 2) { showToast('최소 2개의 variant 가 필요해요', 'warn'); return; }
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from('experiments').insert({
        name: newName.trim(), description: newDescription.trim() || null,
        variants, primary_metric: newMetric.trim() || null,
        status: 'draft', traffic_pct: 100,
      });
      if (error) throw error;
      showToast('실험 등록 완료');
      setCreating(false);
      setNewName(''); setNewVariants('control,A,B'); setNewDescription(''); setNewMetric('');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '실패', 'warn');
    }
  };

  const handleStatus = async (id: string, status: Experiment['status']) => {
    try {
      const supabase = getSupabase();
      const patch: Record<string, unknown> = { status };
      if (status === 'running') patch.start_at = new Date().toISOString();
      if (status === 'completed') patch.end_at = new Date().toISOString();
      const { error } = await supabase.from('experiments').update(patch).eq('id', id);
      if (error) throw error;
      showToast(`상태: ${status}`);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '실패', 'warn');
    }
  };

  if (authLoading || !isAdmin || loading) {
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
          <h1 className="text-xl font-extrabold tracking-tight flex-1">A/B 실험</h1>
          <button
            onClick={() => setCreating(c => !c)}
            className="text-xs font-bold text-emerald-600 inline-flex items-center gap-1 active:scale-95 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30"
          >
            <Plus size={14} /> 신규
          </button>
        </div>
      </header>

      {creating && (
        <div className="px-4 mt-4">
          <div className="card p-5 space-y-3 border-2 border-emerald-200 dark:border-emerald-900/40">
            <p className="text-sm font-extrabold inline-flex items-center gap-1.5">
              <Beaker size={14} className="text-emerald-500" /> 신규 실험
            </p>
            <input
              type="text" placeholder="실험 이름 (예: shop_cta_text)"
              value={newName} onChange={e => setNewName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--background)] border-2 border-[var(--card-border)] text-sm font-medium focus:outline-none focus:border-emerald-500"
            />
            <input
              type="text" placeholder="variants (쉼표 구분, 예: control,A,B)"
              value={newVariants} onChange={e => setNewVariants(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--background)] border-2 border-[var(--card-border)] text-sm font-medium focus:outline-none focus:border-emerald-500"
            />
            <input
              type="text" placeholder="primary metric (예: order_paid)"
              value={newMetric} onChange={e => setNewMetric(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--background)] border-2 border-[var(--card-border)] text-sm font-medium focus:outline-none focus:border-emerald-500"
            />
            <textarea
              rows={2} placeholder="설명 (선택)"
              value={newDescription} onChange={e => setNewDescription(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--background)] border-2 border-[var(--card-border)] text-sm font-medium resize-none focus:outline-none focus:border-emerald-500"
            />
            <div className="flex gap-2 pt-1">
              <button onClick={() => setCreating(false)} className="flex-1 py-2.5 rounded-2xl border border-[var(--card-border)] text-sm font-bold text-[var(--muted)] active:scale-[0.98]">취소</button>
              <button onClick={handleCreate} className="flex-1 py-2.5 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-sm font-extrabold active:scale-[0.98] shadow-md shadow-emerald-500/25">등록</button>
            </div>
          </div>
        </div>
      )}

      {experiments.length === 0 ? (
        <div className="text-center py-20 px-6">
          <div className="w-20 h-20 rounded-full bg-emerald-50 dark:bg-emerald-950/30 mx-auto mb-4 flex items-center justify-center">
            <Beaker size={36} className="text-emerald-500" />
          </div>
          <p className="text-base font-bold mb-1">등록된 실험이 없어요</p>
          <p className="text-xs text-[var(--muted)]">신규 버튼으로 첫 실험을 시작해보세요</p>
        </div>
      ) : (
        <div className="px-4 pt-4 space-y-3">
          {experiments.map(exp => {
            const expResults = results[exp.name] ?? [];
            const statusBadge = {
              running: 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30',
              paused: 'bg-amber-500 text-white',
              completed: 'bg-blue-500 text-white',
              draft: 'bg-zinc-400 text-white',
            }[exp.status];
            const statusText = exp.status === 'running' ? '진행 중' : exp.status === 'paused' ? '일시중지' : exp.status === 'completed' ? '종료' : '초안';

            return (
              <div key={exp.id} className="card p-4">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold">{exp.name}</p>
                    {exp.description && <p className="text-[11px] text-[var(--muted)] mt-0.5">{exp.description}</p>}
                  </div>
                  <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full flex-shrink-0 ${statusBadge}`}>
                    {statusText}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap mb-3">
                  {(exp.variants ?? []).map(v => (
                    <span key={v} className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30">{v}</span>
                  ))}
                  <span className="text-[10px] text-[var(--muted)] font-medium">· traffic {exp.traffic_pct}%</span>
                  {exp.primary_metric && (
                    <span className="text-[10px] text-[var(--muted)] font-medium">· {exp.primary_metric}</span>
                  )}
                </div>

                {expResults.length > 0 && (
                  <div className="bg-emerald-50/40 dark:bg-emerald-950/15 rounded-2xl p-3 mb-3">
                    <p className="text-[11px] font-extrabold mb-2 inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                      <BarChart2 size={11} /> 결과
                    </p>
                    <table className="w-full text-[11px]">
                      <thead className="text-[var(--muted)] font-bold">
                        <tr>
                          <th className="text-left pb-1">variant</th>
                          <th className="text-right pb-1">사용자</th>
                          <th className="text-right pb-1">전환</th>
                          <th className="text-right pb-1">전환율</th>
                          <th className="text-right pb-1">매출</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expResults.map(r => (
                          <tr key={r.variant} className="border-t border-emerald-200/30 dark:border-emerald-900/20">
                            <td className="py-1 font-extrabold">{r.variant}</td>
                            <td className="text-right">{r.user_count}</td>
                            <td className="text-right">{r.event_count}</td>
                            <td className="text-right font-extrabold text-emerald-600">{r.conversion_rate}%</td>
                            <td className="text-right">{r.total_value > 0 ? `${(r.total_value/1000).toFixed(0)}K` : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="flex gap-1.5">
                  {exp.status === 'draft' && (
                    <button
                      onClick={() => handleStatus(exp.id, 'running')}
                      className="flex-1 py-2 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-xs font-extrabold inline-flex items-center justify-center gap-1 active:scale-95 shadow-sm shadow-emerald-500/30"
                    >
                      <Play size={12} /> 시작
                    </button>
                  )}
                  {exp.status === 'running' && (
                    <>
                      <button
                        onClick={() => handleStatus(exp.id, 'paused')}
                        className="flex-1 py-2 rounded-xl bg-amber-500 text-white text-xs font-extrabold inline-flex items-center justify-center gap-1 active:scale-95"
                      >
                        <Pause size={12} /> 일시중지
                      </button>
                      <button
                        onClick={() => handleStatus(exp.id, 'completed')}
                        className="flex-1 py-2 rounded-xl bg-blue-500 text-white text-xs font-extrabold inline-flex items-center justify-center gap-1 active:scale-95"
                      >
                        <Square size={12} /> 종료
                      </button>
                    </>
                  )}
                  {exp.status === 'paused' && (
                    <button
                      onClick={() => handleStatus(exp.id, 'running')}
                      className="flex-1 py-2 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-xs font-extrabold active:scale-95"
                    >
                      재시작
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2500} />}
    </div>
  );
}
