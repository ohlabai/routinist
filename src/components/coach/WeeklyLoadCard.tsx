'use client';

// 주간 훈련량 + 부상 위험 게이지 (2026-08-02 hans: 코치 분석 다양화)
// - 최근 6주 주간 km 막대 (이번 주 = 에메랄드 강조, 진행 중)
// - ACWR (급성:만성 부하비 = 이번주 ÷ 최근 4주 평균): 0.8~1.3 적정 존 게이지.
//   스포츠 과학의 표준 부상 예방 지표 — 용어 대신 "훈련 밸런스" 로 풀어씀.

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Gauge } from 'lucide-react';
import { useUserData } from '@/components/UserDataProvider';
import { useI18n } from '@/lib/i18n';
import { chartStyle } from '@/lib/chart-theme';
import { runningOnly } from '@/lib/routinist-data';
import { toLocalDateStr } from '@/lib/kst';

function mondayOf(d: Date): Date {
  const x = new Date(d);
  const dow = (x.getDay() + 6) % 7; // 월=0
  x.setDate(x.getDate() - dow);
  x.setHours(0, 0, 0, 0);
  return x;
}

export default function WeeklyLoadCard() {
  const { activities } = useUserData();
  const { tt, locale } = useI18n();
  const en = locale === 'en';

  const { weeks, acwr } = useMemo(() => {
    const thisMonday = mondayOf(new Date());
    const buckets: { label: string; km: number; current: boolean }[] = [];
    for (let i = 5; i >= 0; i--) {
      const start = new Date(thisMonday);
      start.setDate(start.getDate() - i * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      const s = toLocalDateStr(start);
      const e = toLocalDateStr(end);
      const km = runningOnly(activities)
        .filter(a => a.activity_date >= s && a.activity_date <= e)
        .reduce((sum, a) => sum + Number(a.distance_km), 0);
      buckets.push({
        label: i === 0 ? (en ? 'now' : '이번주') : `${start.getMonth() + 1}/${start.getDate()}`,
        km: Math.round(km * 10) / 10,
        current: i === 0,
      });
    }
    const cur = buckets[5].km;
    const prev4 = buckets.slice(1, 5); // 직전 4주
    const chronic = prev4.reduce((s, w) => s + w.km, 0) / 4;
    return { weeks: buckets, acwr: chronic > 3 ? cur / chronic : null };
  }, [activities, en]);

  if (weeks.every(w => w.km <= 0)) return null;

  // ACWR 해석 (이번 주 진행 중이라 낮게 나오는 게 정상 — 문구로 안내)
  const zone = acwr == null ? null
    : acwr < 0.8 ? { label: en ? 'Room to build' : '여유 있어요', color: '#0EA5E9', desc: en ? 'You can safely add a bit more this week.' : '이번 주 조금 더 달려도 안전한 구간이에요.' }
    : acwr <= 1.3 ? { label: en ? 'Balanced' : '적정 밸런스', color: '#10B981', desc: en ? 'Training load is in the sweet spot — keep it up!' : '훈련량이 이상적인 구간이에요 — 이대로 쭉!' }
    : { label: en ? 'Take it easy' : '과부하 주의', color: '#EAB308', desc: en ? 'This week is much heavier than usual — consider an easy day.' : '평소보다 급하게 늘었어요 — 가벼운 날을 섞어주세요.' };

  const pct = acwr == null ? 0 : Math.min(100, (acwr / 1.8) * 100);

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-1">
        <Gauge size={18} className="text-emerald-500" />
        <h3 className="text-lg font-extrabold text-[var(--foreground)]">{tt('주간 훈련량')}</h3>
      </div>
      <p className="text-sm text-[var(--muted)] mb-3">
        {en ? 'Last 6 weeks — this week highlighted' : '최근 6주 — 이번 주는 진행 중'}
      </p>
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={weeks} margin={{ top: 14, right: 0, left: -14, bottom: 0 }}>
          <CartesianGrid strokeDasharray={chartStyle.gridDash} stroke="var(--card-border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 13, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval={0} />
          <YAxis tick={{ fontSize: 12, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={34} />
          <Tooltip
            contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 14, fontSize: 15 }}
            formatter={(v) => [`${v}km`]}
          />
          <Bar dataKey="km" radius={chartStyle.barRadius} animationDuration={chartStyle.animationDuration}
            label={{ position: 'top', fontSize: 12, fontWeight: 700, fill: 'var(--muted)',
              formatter: (v: unknown) => (typeof v === 'number' && v > 0 ? String(v) : '') }}>
            {weeks.map(w => (
              <Cell key={w.label} fill={w.current ? '#059669' : '#6EE7B7'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {zone && acwr != null && (
        <div className="mt-3 pt-3 border-t border-[var(--card-border)]/50">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-base font-extrabold" style={{ color: zone.color }}>{zone.label}</span>
            <span className="text-sm font-bold tabular-nums text-[var(--muted)]">
              {en ? 'load ratio' : '부하 비율'} {acwr.toFixed(2)}
            </span>
          </div>
          {/* 게이지: 0 ~ 1.8 스케일, 적정존 0.8~1.3 표시 */}
          <div className="relative h-2.5 rounded-full bg-[var(--card-border)]/40 overflow-hidden">
            <div className="absolute inset-y-0 rounded-full bg-emerald-200/70 dark:bg-emerald-800/40"
              style={{ left: `${(0.8 / 1.8) * 100}%`, width: `${((1.3 - 0.8) / 1.8) * 100}%` }} />
            <div className="absolute inset-y-0 w-1.5 rounded-full" style={{ left: `calc(${pct}% - 3px)`, backgroundColor: zone.color }} />
          </div>
          <p className="text-sm text-[var(--muted)] mt-2 leading-relaxed">{zone.desc}</p>
        </div>
      )}
    </div>
  );
}
