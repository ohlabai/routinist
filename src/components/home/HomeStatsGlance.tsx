'use client';

// 홈 시각화 2종 (2026-08-01 hans: "그래프 다시 보여주고 보강, 텍스트 줄이고 글씨 크게")
// Phase B 에서 /stats 로 전부 이관했더니 홈에서 추이가 안 보인다는 피드백 —
// 서버 조회 없이 activities 로컬 계산 가능한 ① 최근 30일 일별 추이 ② 요일 패턴만 홈에 복원.
// 깊은 분석 (PB·12주·페이스·시간대·기간비교) 은 계속 /stats.
// 원칙: 텍스트 최소 (제목 + 인사이트 한 줄), 큰 틱 글씨, 단일 emerald 색상 (크기=강조).

import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { useUserData } from '@/components/UserDataProvider';
import { useI18n } from '@/lib/i18n';
import { toLocalDateStr } from '@/lib/kst';
import { chartStyle } from '@/lib/chart-theme';
import { runningOnly } from '@/lib/routinist-data';

export default function HomeStatsGlance() {
  const { activities } = useUserData();
  const { tt, locale } = useI18n();
  const en = locale === 'en';

  // ① 최근 30일 일별 거리
  const daily = useMemo(() => {
    const map = new Map<string, number>();
    runningOnly(activities).forEach(a => {
      map.set(a.activity_date, (map.get(a.activity_date) || 0) + Number(a.distance_km));
    });
    const out: { label: string; distance: number }[] = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      out.push({
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        distance: Math.round((map.get(toLocalDateStr(d)) || 0) * 10) / 10,
      });
    }
    return out;
  }, [activities]);
  const daily30Total = daily.reduce((s, d) => s + d.distance, 0);

  // ② 요일별 러닝 횟수 (최근 1년)
  const byDay = useMemo(() => {
    const names = en ? ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'] : ['일','월','화','수','목','금','토'];
    const counts = names.map(day => ({ day, count: 0 }));
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    const cutoffStr = toLocalDateStr(cutoff);
    runningOnly(activities).forEach(a => {
      if (a.activity_date < cutoffStr) return;
      const [y, m, d] = a.activity_date.split('-').map(Number);
      counts[new Date(y, m - 1, d).getDay()].count++;
    });
    return counts;
  }, [activities, en]);
  const maxDayCount = Math.max(...byDay.map(d => d.count));
  const maxDay = byDay.find(d => d.count === maxDayCount && maxDayCount > 0);

  if (daily30Total <= 0 && !maxDay) return null; // 데이터 없으면 통째로 생략 (신규 유저)

  const tooltipStyle = {
    background: 'var(--card-bg)',
    border: '1px solid var(--card-border)',
    borderRadius: 14,
    fontSize: 14,
  };

  return (
    <>
      {/* 최근 30일 추이 */}
      {daily30Total > 0 && (
        <div className="mx-4 card p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-lg font-bold text-[var(--foreground)]">{tt('최근 30일')}</h3>
            <p className="text-base font-extrabold tabular-nums text-[var(--accent)]">
              {daily30Total.toFixed(1)}<span className="text-sm font-bold text-[var(--muted)]"> km</span>
            </p>
          </div>
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={daily} margin={{ top: 4, right: 0, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="homeDailyGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34D399" />
                  <stop offset="100%" stopColor="#10B981" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray={chartStyle.gridDash} stroke="var(--card-border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval={6} />
              <YAxis tick={{ fontSize: 12, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={34} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v}km`]} cursor={{ fill: 'var(--card-border)', opacity: 0.3 }} />
              <Bar dataKey="distance" fill="url(#homeDailyGrad)" radius={chartStyle.barRadius} animationDuration={chartStyle.animationDuration} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 요일 패턴 */}
      {maxDay && (
        <div className="mx-4 card p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-lg font-bold text-[var(--foreground)]">{tt('요일 패턴')}</h3>
            <p className="text-sm font-semibold text-[var(--muted)]">
              {en
                ? <>mostly <span className="text-[var(--accent)] font-extrabold">{maxDay.day}</span></>
                : <>주로 <span className="text-[var(--accent)] font-extrabold">{maxDay.day}요일</span></>}
            </p>
          </div>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={byDay} margin={{ top: 16, right: 0, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray={chartStyle.gridDash} stroke="var(--card-border)" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 13, fill: 'var(--muted)', fontWeight: 600 }} axisLine={false} tickLine={false} interval={0} />
              <YAxis tick={{ fontSize: 12, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [en ? `${v} runs` : `${v}회`]} cursor={{ fill: 'var(--card-border)', opacity: 0.3 }} />
              <Bar
                dataKey="count"
                radius={chartStyle.barRadius}
                animationDuration={chartStyle.animationDuration}
                label={{
                  position: 'top', fontSize: 12, fontWeight: 700, fill: 'var(--muted)',
                  formatter: (v: unknown) => (typeof v === 'number' && v > 0 && v === maxDayCount ? String(v) : ''),
                }}
              >
                {byDay.map((d) => (
                  <Cell key={d.day} fill={d.count === maxDayCount ? '#059669' : '#6EE7B7'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </>
  );
}
