'use client';

// 어드민 마일리지 정책 — 모던 모바일 UX/UI (에메랄드 그린).
// hans@openhan.kr 만 접근. 보상 금액·활성 여부 인라인 편집.

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Power, Coins, Flame, Info } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import AppToast from '@/components/AppToast';

const ADMIN_EMAIL = 'hans@openhan.kr';

interface RewardConfig {
  event_type: string;
  amount: number;
  description: string;
  is_active: boolean;
  recurrence: 'once' | 'monthly' | 'per_streak' | 'per_milestone';
  cooldown_days: number;
  daily_cap: number | null;
  boost_multiplier: number;
  boost_until: string | null;
  updated_at: string;
}

const RECURRENCE_LABEL: Record<string, string> = {
  once: '1회만',
  monthly: '월 1회',
  per_streak: '연속일 단위',
  per_milestone: '달성 단위',
};

export default function AdminMileagePage() {
  const { user } = useAuth();
  const router = useRouter();
  const [configs, setConfigs] = useState<RewardConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { amount?: number; is_active?: boolean }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    if (user.email !== ADMIN_EMAIL) router.replace('/dashboard');
  }, [user, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const supabase = getSupabase();
      const result = await Promise.race([
        supabase.from('mileage_reward_config').select('*').order('event_type'),
        new Promise<{ data: null; error: { message: string } }>((resolve) =>
          setTimeout(() => resolve({ data: null, error: { message: '10초 timeout — 다시 시도해주세요' } }), 10000)
        ),
      ]);
      const { data, error } = result as { data: RewardConfig[] | null; error: { message: string } | null };
      if (error) setLoadError(error.message);
      else setConfigs((data ?? []) as RewardConfig[]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setEdit = (event_type: string, field: 'amount' | 'is_active', value: number | boolean) => {
    setEdits(prev => ({ ...prev, [event_type]: { ...prev[event_type], [field]: value } }));
  };

  const save = async (event_type: string) => {
    const edit = edits[event_type];
    if (!edit) return;
    setSaving(event_type);
    try {
      const supabase = getSupabase();
      const update: Record<string, unknown> = {};
      if (edit.amount !== undefined) update.amount = edit.amount;
      if (edit.is_active !== undefined) update.is_active = edit.is_active;
      update.updated_at = new Date().toISOString();
      update.updated_by = user?.id;

      const { error } = await supabase.from('mileage_reward_config').update(update).eq('event_type', event_type);
      if (error) throw error;
      setEdits(prev => { const next = { ...prev }; delete next[event_type]; return next; });
      setSavedMsg(`${event_type} 저장 완료`);
      setTimeout(() => setSavedMsg(null), 2500);
      await load();
    } catch (e) {
      setSavedMsg(`저장 실패: ${e instanceof Error ? e.message : e}`);
      setTimeout(() => setSavedMsg(null), 4000);
    } finally { setSaving(null); }
  };

  if (user && user.email !== ADMIN_EMAIL) return null;

  return (
    <div className="max-w-2xl mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-extrabold tracking-tight">마일리지 정책</h1>
        </div>
      </header>

      <div className="px-4 mt-4 mb-3">
        <div className="card p-4 bg-gradient-to-br from-emerald-50/50 to-transparent dark:from-emerald-950/20 border-emerald-200/40 dark:border-emerald-900/30 inline-flex items-start gap-2.5">
          <Info size={14} className="text-emerald-500 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-[var(--muted)] leading-relaxed">
            보상 금액·활성 여부를 변경하면 즉시 반영됩니다.<br />
            변경 이력은 <code className="text-[10px] px-1 py-0.5 rounded bg-[var(--card-border)]/30">mileage_reward_config_audit</code> 에 자동 기록.
          </p>
        </div>
      </div>

      {savedMsg && (
        <AppToast
          text={savedMsg}
          tone={savedMsg.includes('실패') || savedMsg.includes('오류') ? 'warn' : 'ok'}
          position="top"
          onClose={() => setSavedMsg('')}
          durationMs={2500}
        />
      )}

      {loading ? (
        <div className="px-4 space-y-2">
          {[0,1,2,3].map(i => (
            <div key={i} className="card p-4 animate-pulse space-y-2">
              <div className="h-3 w-1/3 bg-[var(--card-border)]/50 rounded" />
              <div className="h-2 w-2/3 bg-[var(--card-border)]/50 rounded" />
              <div className="h-8 w-full bg-[var(--card-border)]/50 rounded" />
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="text-center py-12 px-4">
          <p className="text-sm text-red-500 mb-3">로드 실패: {loadError}</p>
          <button onClick={() => load()} className="px-5 py-2.5 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-sm font-bold active:scale-95">
            다시 시도
          </button>
        </div>
      ) : configs.length === 0 ? (
        <p className="text-center text-sm text-[var(--muted)] py-12">설정 데이터가 없습니다</p>
      ) : (
        <div className="px-4 space-y-2.5">
          {configs.map(cfg => {
            const edit = edits[cfg.event_type] ?? {};
            const currentAmount = edit.amount ?? cfg.amount;
            const currentActive = edit.is_active ?? cfg.is_active;
            const isDirty = edit.amount !== undefined || edit.is_active !== undefined;
            const inBoost = cfg.boost_until && new Date(cfg.boost_until) > new Date() && cfg.boost_multiplier > 1;

            return (
              <div key={cfg.event_type} className={`card p-4 transition ${currentActive ? '' : 'opacity-70'}`}>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-extrabold text-[var(--foreground)] inline-flex items-center gap-1.5">
                      <Coins size={13} className="text-emerald-500 flex-shrink-0" />
                      {cfg.event_type}
                    </p>
                    <p className="text-[11px] text-[var(--muted)] mt-1 ml-5">{cfg.description}</p>
                    <div className="flex items-center gap-1.5 flex-wrap mt-1.5 ml-5">
                      <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30">
                        {RECURRENCE_LABEL[cfg.recurrence]}
                      </span>
                      {cfg.daily_cap && (
                        <span className="text-[10px] font-bold text-[var(--muted)] px-2 py-0.5 rounded-full bg-[var(--card-border)]/40">
                          일 {cfg.daily_cap}회 캡
                        </span>
                      )}
                      {cfg.cooldown_days > 0 && (
                        <span className="text-[10px] font-bold text-[var(--muted)] px-2 py-0.5 rounded-full bg-[var(--card-border)]/40">
                          쿨다운 {cfg.cooldown_days}일
                        </span>
                      )}
                      {inBoost && (
                        <span className="text-[10px] font-extrabold text-orange-600 px-2 py-0.5 rounded-full bg-orange-50 dark:bg-orange-950/30 inline-flex items-center gap-0.5">
                          <Flame size={10} /> 부스트 ×{cfg.boost_multiplier}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => setEdit(cfg.event_type, 'is_active', !currentActive)}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[10px] font-extrabold transition active:scale-95 ${
                      currentActive
                        ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/30'
                        : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                    }`}
                  >
                    <Power size={10} />
                    {currentActive ? '활성' : '비활성'}
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type="number" value={currentAmount} min={0}
                      onChange={(e) => setEdit(cfg.event_type, 'amount', parseInt(e.target.value) || 0)}
                      className="w-full pl-3.5 pr-8 py-2.5 rounded-xl border-2 border-[var(--card-border)] bg-[var(--background)] text-base font-extrabold text-[var(--foreground)] focus:outline-none focus:border-emerald-500"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-extrabold text-emerald-600">P</span>
                  </div>
                  <button
                    onClick={() => save(cfg.event_type)}
                    disabled={!isDirty || saving === cfg.event_type}
                    className="px-4 py-2.5 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-xs font-extrabold flex items-center gap-1 disabled:opacity-40 active:scale-95 shadow-sm shadow-emerald-500/30"
                  >
                    <Save size={13} />
                    {saving === cfg.event_type ? '...' : '저장'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="px-4 mt-5">
        <div className="card p-3.5 inline-flex items-start gap-2 text-[11px] text-[var(--muted)] leading-relaxed">
          <span>💡</span>
          <span>
            글로벌 일일 캡: 한 사용자가 24시간 내 받을 수 있는 모든 보상 합 = <b>5000P</b><br />
            (코드 하드코딩 — 변경 시 award_mileage RPC 수정 필요)
          </span>
        </div>
      </div>
    </div>
  );
}
