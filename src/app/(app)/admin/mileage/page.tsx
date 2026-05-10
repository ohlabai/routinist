'use client';

// 관리자 페이지 — 마일리지 보상 amount 인라인 편집.
// hans@openhan.kr 만 접근 가능. 다른 user 접근 시 자동 redirect.

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Power } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import AppToast from '@/components/AppToast';

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

const ADMIN_EMAIL = 'hans@openhan.kr';

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

  // 권한 가드 — hans@openhan.kr 만
  useEffect(() => {
    if (!user) return;
    if (user.email !== ADMIN_EMAIL) {
      router.replace('/dashboard');
    }
  }, [user, router]);

  // iOS 백그라운드 복귀 시 supabase 클라이언트가 stale 토큰으로 쿼리 hang 가능 → 10s race
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
      if (error) {
        setLoadError(error.message);
      } else {
        setConfigs((data ?? []) as RewardConfig[]);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setEdit = (event_type: string, field: 'amount' | 'is_active', value: number | boolean) => {
    setEdits(prev => ({
      ...prev,
      [event_type]: { ...prev[event_type], [field]: value },
    }));
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

      const { error } = await supabase
        .from('mileage_reward_config')
        .update(update)
        .eq('event_type', event_type);
      if (error) throw error;
      setEdits(prev => { const next = { ...prev }; delete next[event_type]; return next; });
      setSavedMsg(`${event_type} 저장 완료`);
      setTimeout(() => setSavedMsg(null), 2500);
      await load();
    } catch (e) {
      setSavedMsg(`저장 실패: ${e instanceof Error ? e.message : e}`);
      setTimeout(() => setSavedMsg(null), 4000);
    } finally {
      setSaving(null);
    }
  };

  if (user && user.email !== ADMIN_EMAIL) return null;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/profile" className="text-[var(--muted)]"><ArrowLeft size={24} /></Link>
        <h1 className="text-xl font-bold text-[var(--foreground)]">마일리지 보상 설정 (관리자)</h1>
      </div>

      <p className="text-sm text-[var(--muted)] mb-4 leading-relaxed">
        보상 금액·활성 여부를 변경하면 즉시 반영됩니다. 변경 이력은 mileage_reward_config_audit 에 자동 기록.
      </p>

      {savedMsg && (
        <AppToast
          text={savedMsg}
          tone={savedMsg.includes('실패') || savedMsg.includes('오류') ? 'warn' : 'ok'}
          position="top"
          onClose={() => setSavedMsg('')}
          durationMs={2500}
        />
      )}

      <div className="card divide-y divide-[var(--card-border)]">
        {loading ? (
          <div className="flex justify-center py-10">
            <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
          </div>
        ) : loadError ? (
          <div className="text-center py-10 px-4">
            <p className="text-sm text-red-500 mb-3">로드 실패: {loadError}</p>
            <button onClick={() => load()} className="px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-bold">
              다시 시도
            </button>
          </div>
        ) : configs.length === 0 ? (
          <p className="text-center text-sm text-[var(--muted)] py-10">설정 데이터가 없습니다.</p>
        ) : configs.map(cfg => {
          const edit = edits[cfg.event_type] ?? {};
          const currentAmount = edit.amount ?? cfg.amount;
          const currentActive = edit.is_active ?? cfg.is_active;
          const isDirty = edit.amount !== undefined || edit.is_active !== undefined;
          const inBoost = cfg.boost_until && new Date(cfg.boost_until) > new Date() && cfg.boost_multiplier > 1;

          return (
            <div key={cfg.event_type} className="p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  <p className="text-base font-bold text-[var(--foreground)]">{cfg.event_type}</p>
                  <p className="text-xs text-[var(--muted)] mt-0.5">{cfg.description}</p>
                  <p className="text-xs text-[var(--muted)] mt-0.5">
                    {RECURRENCE_LABEL[cfg.recurrence]}
                    {cfg.daily_cap ? ` · 일일 ${cfg.daily_cap}회 캡` : ''}
                    {cfg.cooldown_days > 0 ? ` · 쿨다운 ${cfg.cooldown_days}일` : ''}
                  </p>
                  {inBoost && (
                    <p className="text-xs text-orange-600 mt-1 font-bold">
                      🔥 부스트 중 ({cfg.boost_multiplier}배)
                    </p>
                  )}
                </div>
                <button
                  onClick={() => setEdit(cfg.event_type, 'is_active', !currentActive)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                    currentActive
                      ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
                  }`}
                >
                  <Power size={12} />
                  {currentActive ? '활성' : '비활성'}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={currentAmount}
                  min={0}
                  onChange={(e) => setEdit(cfg.event_type, 'amount', parseInt(e.target.value) || 0)}
                  className="flex-1 px-3 py-2 rounded-lg border border-[var(--card-border)] bg-[var(--background)] text-base font-bold text-[var(--foreground)]"
                />
                <span className="text-sm font-bold text-[var(--muted)]">P</span>
                <button
                  onClick={() => save(cfg.event_type)}
                  disabled={!isDirty || saving === cfg.event_type}
                  className="px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-bold flex items-center gap-1 disabled:opacity-40"
                >
                  <Save size={14} />
                  {saving === cfg.event_type ? '...' : '저장'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-[var(--muted)] leading-relaxed">
        💡 글로벌 일일 캡: 한 사용자가 24시간 내 받을 수 있는 모든 보상 합 = 5000P (코드 하드코딩, 변경 시 award_mileage RPC 수정 필요).
      </p>
    </div>
  );
}
