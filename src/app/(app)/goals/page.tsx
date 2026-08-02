'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/components/UserDataProvider';
import { useI18n } from '@/lib/i18n';
import { setMonthlyGoal, getMonthlyDistance } from '@/lib/routinist-data';
import AppToast from '@/components/AppToast';

const PRESETS = [30, 50, 100, 150, 200];
// 습관 형성: 주간 러닝 횟수 목표 (주 1~7회). 초보 추천 = 3회 (연구 기반 습관 형성 최소 빈도).
const WEEKLY_RECOMMENDED = 3;

export default function GoalsPage() {
  const router = useRouter();
  const { user, profile, refreshProfile } = useAuth();
  const { tt, locale } = useI18n();
  const { activities, goals, refresh } = useUserData();

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const currentGoal = goals.find(g => g.year === year && g.month === month);
  const [goalKm, setGoalKm] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const monthlyDistance = getMonthlyDistance(activities, year, month);
  const progress = currentGoal && currentGoal.goal_km > 0
    ? Math.min((monthlyDistance / currentGoal.goal_km) * 100, 100)
    : 0;

  useEffect(() => {
    if (currentGoal) {
      setGoalKm(String(currentGoal.goal_km));
    }
  }, [currentGoal]);

  // ---- 주간 러닝 횟수 목표 (습관 형성) ----
  // 칩 탭 = 즉시 저장 (optimistic), 선택된 칩 재탭 = 해제 (미설정 허용).
  const [weeklyGoal, setWeeklyGoal] = useState<number | null>(null);
  const [weeklySaving, setWeeklySaving] = useState(false);
  const [weeklyToast, setWeeklyToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  useEffect(() => {
    setWeeklyGoal(profile?.weekly_run_goal ?? null);
  }, [profile?.weekly_run_goal]);

  const handleWeeklyGoal = async (n: number) => {
    if (!user || weeklySaving) return;
    const prev = weeklyGoal;
    const next = weeklyGoal === n ? null : n; // 재탭 = 해제
    setWeeklySaving(true);
    setWeeklyGoal(next); // optimistic
    try {
      const { getSupabase } = await import('@/lib/supabase');
      const { error } = await getSupabase()
        .from('profiles')
        .update({ weekly_run_goal: next, updated_at: new Date().toISOString() })
        .eq('id', user.id);
      if (error) throw error;
      refreshProfile().catch(() => {}); // 홈 도트 줄이 profile 을 읽음 — 실패해도 저장은 완료
      setWeeklyToast({
        text: next !== null
          ? (locale === 'en' ? `Weekly goal set — ${next} runs a week!` : `주 ${next}회 목표 설정 완료!`)
          : tt('주간 횟수 목표를 해제했어요'),
        tone: 'ok',
      });
    } catch (e) {
      console.warn('[goals] weekly_run_goal 저장 실패 (컬럼 미배포 가능)', e);
      setWeeklyGoal(prev); // rollback
      setWeeklyToast({ text: tt('저장하지 못했어요. 잠시 후 다시 시도해주세요'), tone: 'warn' });
    } finally {
      setWeeklySaving(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    const km = parseFloat(goalKm);
    if (isNaN(km) || km <= 0) return;

    setSaving(true);
    try {
      await setMonthlyGoal(user.id, year, month, km);
      await refresh();
      setSaved(true);
      // build 165 #1: 목표 저장 → 홈 이동 (사용자 신고: 설정 후 홈에서 결과 보고 싶어함).
      setTimeout(() => router.push('/dashboard'), 700);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 max-w-lg mx-auto space-y-6 pb-8">
      <h2 className="text-xl font-bold text-[var(--foreground)]">
        {locale === 'en'
          ? `${new Date(year, month - 1).toLocaleDateString('en-US', { month: 'long' })} Goal`
          : `${month}월 목표 설정`}
      </h2>

      {/* 현재 진행률 */}
      {currentGoal && currentGoal.goal_km > 0 && (
        <div className="card p-6 text-center">
          <div className="relative w-32 h-32 mx-auto mb-4">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--card-border)" strokeWidth="3" />
              <circle
                cx="18" cy="18" r="15.5" fill="none"
                stroke="var(--accent)" strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${progress * 0.975} 97.5`}
                className="transition-all duration-500"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-extrabold text-[var(--foreground)]">{progress.toFixed(0)}%</span>
            </div>
          </div>
          <p className="text-xs text-[var(--muted)]">
            {monthlyDistance.toFixed(1)}km / {currentGoal.goal_km}km
          </p>
        </div>
      )}

      {/* 목표 입력 */}
      <div className="card p-5 space-y-4">
        <label className="block text-sm font-medium text-[var(--foreground)]">{tt('목표 거리 (km)')}</label>

        {/* 프리셋 */}
        <div className="flex gap-2 flex-wrap">
          {PRESETS.map(km => (
            <button
              key={km}
              onClick={() => setGoalKm(String(km))}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                goalKm === String(km)
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--card-border)] text-[var(--foreground)]'
              }`}
            >
              {km}km
            </button>
          ))}
        </div>

        {/* 직접 입력 */}
        <input
          type="number"
          step="1"
          min="1"
          value={goalKm}
          onChange={(e) => setGoalKm(e.target.value)}
          placeholder={tt('직접 입력')}
          className="w-full px-4 py-3 rounded-xl border border-[var(--card-border)] bg-[var(--background)] text-[var(--foreground)] text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />

      </div>

      {/* 주간 러닝 횟수 (습관 형성) — 거리 목표와 별개. 탭 즉시 저장, 재탭 해제. */}
      <div className="card p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-[var(--foreground)]">{tt('주간 러닝 횟수')}</label>
          <p className="text-xs text-[var(--muted)] mt-1">
            {tt('거리보다 꾸준함! 일주일에 몇 번 달릴지 정해보세요')}
          </p>
        </div>

        <div className="grid grid-cols-7 gap-1.5">
          {[1, 2, 3, 4, 5, 6, 7].map(n => (
            <button
              key={n}
              onClick={() => handleWeeklyGoal(n)}
              disabled={weeklySaving}
              className={`relative py-2.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-60 ${
                weeklyGoal === n
                  ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-500/30'
                  : 'bg-[var(--card-border)] text-[var(--foreground)]'
              }`}
            >
              {n}
              {n === WEEKLY_RECOMMENDED && (
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 px-1.5 py-px rounded-full bg-amber-400 text-[11px] font-extrabold text-amber-950 whitespace-nowrap">
                  {tt('추천')}
                </span>
              )}
            </button>
          ))}
        </div>

        <p className="text-xs text-[var(--muted)]">
          {weeklyGoal !== null
            ? (locale === 'en'
                ? `Goal: ${weeklyGoal} run${weeklyGoal === 1 ? '' : 's'} a week — the Weekly Goal card on Home tracks your week, and hitting it grows your weekly streak. Tap again to clear.`
                : `주 ${weeklyGoal}회 목표 — 홈 '주간 목표' 카드에서 요일별로 채워지고, 채운 주가 이어지면 주간 연속 기록이 쌓여요. 다시 누르면 해제돼요`)
            : tt('처음이라면 주 3회부터 — 습관이 되는 가장 부담 없는 횟수예요')}
        </p>
      </div>

      {/* 2026-07-11 피드백: 저장 버튼을 맨 아래로 — 두 카드 다 보고 마지막에 저장하는 흐름.
          (주간 횟수는 탭 즉시 저장이라 이 버튼은 거리 목표만 저장) */}
      <button
        onClick={handleSave}
        disabled={saving || !goalKm}
        className="w-full bg-[var(--accent)] hover:opacity-90 text-white font-semibold py-3.5 rounded-xl transition-all disabled:opacity-50"
      >
        {saved ? tt('저장됨!') : saving ? tt('저장 중...') : tt('목표 저장')}
      </button>

      {weeklyToast && (
        <AppToast
          text={weeklyToast.text}
          tone={weeklyToast.tone}
          position="top"
          onClose={() => setWeeklyToast(null)}
          durationMs={2500}
        />
      )}
    </div>
  );
}
