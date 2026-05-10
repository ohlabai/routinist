'use client';

// A/B 실험 어드민 — 목록 + 결과 + 상태 변경 + 신규 등록.

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Beaker, Play, Pause, Square, BarChart2 } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import AppToast from '@/components/AppToast';

const ADMIN_EMAIL = 'hans@openhan.kr';

interface Experiment {
  id: string;
  name: string;
  description: string | null;
  variants: string[];
  status: 'draft' | 'running' | 'paused' | 'completed';
  traffic_pct: number;
  primary_metric: string | null;
  start_at: string | null;
  end_at: string | null;
  created_at: string;
}

interface Result {
  variant: string;
  user_count: number;
  event_count: number;
  conversion_rate: number;
  total_value: number;
}

export default function ExperimentsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = user?.email === ADMIN_EMAIL;

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
      const { data, error } = await supabase
        .from('experiments')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setExperiments((data ?? []) as Experiment[]);

      // running 실험만 결과 자동 로드
      for (const exp of (data ?? []) as Experiment[]) {
        if (exp.status === 'running' || exp.status === 'completed') {
          supabase.rpc('experiment_results', { p_name: exp.name }).then(({ data: r }) => {
            setResults(prev => ({ ...prev, [exp.name]: (r ?? []) as Result[] }));
          });
        }
      }
    } catch (e) {
      console.warn('[experiments] load fail', e);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!newName.trim()) {
      showToast('실험 이름이 필요해요', 'warn');
      return;
    }
    const variants = newVariants.split(',').map(v => v.trim()).filter(Boolean);
    if (variants.length < 2) {
      showToast('최소 2개의 variant 가 필요해요', 'warn');
      return;
    }
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from('experiments').insert({
        name: newName.trim(),
        description: newDescription.trim() || null,
        variants,
        primary_metric: newMetric.trim() || null,
        status: 'draft',
        traffic_pct: 100,
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
        <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto pb-12">
      <div className="flex items-center gap-3 px-4 py-3 sticky top-0 bg-[var(--background)]/95 backdrop-blur z-10">
        <button onClick={() => router.back()} className="p-1 active:scale-90"><ArrowLeft size={24} /></button>
        <h1 className="text-xl font-bold flex-1">A/B 실험</h1>
        <button
          onClick={() => setCreating(c => !c)}
          className="text-sm text-emerald-600 font-bold inline-flex items-center gap-1"
        >
          <Plus size={16} /> 신규
        </button>
      </div>

      {creating && (
        <div className="px-4 mb-3">
          <div className="card p-4 space-y-2">
            <p className="text-sm font-bold mb-2">신규 실험</p>
            <input
              type="text" placeholder="실험 이름 (예: shop_cta_text)"
              value={newName} onChange={e => setNewName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm"
            />
            <input
              type="text" placeholder="variants (쉼표 구분)"
              value={newVariants} onChange={e => setNewVariants(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm"
            />
            <input
              type="text" placeholder="primary metric (예: order_paid)"
              value={newMetric} onChange={e => setNewMetric(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm"
            />
            <textarea
              rows={2} placeholder="설명 (선택)"
              value={newDescription} onChange={e => setNewDescription(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm resize-none"
            />
            <div className="flex gap-2 mt-2">
              <button onClick={() => setCreating(false)} className="flex-1 py-2 rounded-lg border border-[var(--card-border)] text-sm">취소</button>
              <button onClick={handleCreate} className="flex-1 py-2 rounded-lg bg-emerald-500 text-white text-sm font-bold">등록</button>
            </div>
          </div>
        </div>
      )}

      {experiments.length === 0 ? (
        <div className="text-center py-16">
          <Beaker size={40} className="mx-auto mb-3 text-[var(--muted)]" />
          <p className="text-sm text-[var(--muted)]">등록된 실험이 없어요</p>
        </div>
      ) : (
        <div className="px-4 space-y-3">
          {experiments.map(exp => {
            const expResults = results[exp.name] ?? [];
            return (
              <div key={exp.id} className="card p-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-bold">{exp.name}</p>
                  <span className={`text-xs font-bold ${
                    exp.status === 'running' ? 'text-emerald-600' :
                    exp.status === 'paused' ? 'text-amber-500' :
                    exp.status === 'completed' ? 'text-blue-500' :
                    'text-[var(--muted)]'
                  }`}>
                    {exp.status === 'running' ? '진행 중' : exp.status === 'paused' ? '일시중지' : exp.status === 'completed' ? '종료' : '초안'}
                  </span>
                </div>
                {exp.description && <p className="text-xs text-[var(--muted)] mb-2">{exp.description}</p>}
                <p className="text-xs text-[var(--muted)] mb-3">
                  variants: {(exp.variants ?? []).join(', ')} · traffic: {exp.traffic_pct}%
                  {exp.primary_metric && ` · metric: ${exp.primary_metric}`}
                </p>

                {expResults.length > 0 && (
                  <div className="bg-[var(--background)] rounded-lg p-3 mb-3">
                    <p className="text-xs font-bold mb-2 inline-flex items-center gap-1"><BarChart2 size={12} /> 결과</p>
                    <table className="w-full text-xs">
                      <thead className="text-[var(--muted)]">
                        <tr>
                          <th className="text-left">variant</th>
                          <th className="text-right">사용자</th>
                          <th className="text-right">전환</th>
                          <th className="text-right">전환율</th>
                          <th className="text-right">매출</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expResults.map(r => (
                          <tr key={r.variant}>
                            <td className="py-1 font-semibold">{r.variant}</td>
                            <td className="text-right">{r.user_count}</td>
                            <td className="text-right">{r.event_count}</td>
                            <td className="text-right font-bold text-emerald-600">{r.conversion_rate}%</td>
                            <td className="text-right">{r.total_value > 0 ? `${r.total_value.toLocaleString()}` : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="flex gap-1">
                  {exp.status === 'draft' && (
                    <button
                      onClick={() => handleStatus(exp.id, 'running')}
                      className="flex-1 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-bold inline-flex items-center justify-center gap-1"
                    >
                      <Play size={12} /> 시작
                    </button>
                  )}
                  {exp.status === 'running' && (
                    <>
                      <button
                        onClick={() => handleStatus(exp.id, 'paused')}
                        className="flex-1 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-bold inline-flex items-center justify-center gap-1"
                      >
                        <Pause size={12} /> 일시중지
                      </button>
                      <button
                        onClick={() => handleStatus(exp.id, 'completed')}
                        className="flex-1 py-1.5 rounded-lg bg-blue-500 text-white text-xs font-bold inline-flex items-center justify-center gap-1"
                      >
                        <Square size={12} /> 종료
                      </button>
                    </>
                  )}
                  {exp.status === 'paused' && (
                    <button
                      onClick={() => handleStatus(exp.id, 'running')}
                      className="flex-1 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-bold"
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
