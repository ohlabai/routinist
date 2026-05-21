'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/components/UserDataProvider';
import { setMonthlyGoal, getMonthlyDistance } from '@/lib/routinist-data';

const PRESETS = [30, 50, 100, 150, 200];

export default function GoalsPage() {
  const router = useRouter();
  const { user } = useAuth();
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
      <h2 className="text-xl font-bold text-[var(--foreground)]">{month}월 목표 설정</h2>

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
        <label className="block text-sm font-medium text-[var(--foreground)]">목표 거리 (km)</label>

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
          placeholder="직접 입력"
          className="w-full px-4 py-3 rounded-xl border border-[var(--card-border)] bg-[var(--background)] text-[var(--foreground)] text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />

        <button
          onClick={handleSave}
          disabled={saving || !goalKm}
          className="w-full bg-[var(--accent)] hover:opacity-90 text-white font-semibold py-3.5 rounded-xl transition-all disabled:opacity-50"
        >
          {saved ? '저장됨!' : saving ? '저장 중...' : '목표 저장'}
        </button>
      </div>
    </div>
  );
}
