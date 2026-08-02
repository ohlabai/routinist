'use client';

// 내 순위 시계열 (build 100, Phase 3 후속) — 주/월/년 × scope 5종 시계열 그래프.
// fetch_my_rank_history RPC 사용. recharts LineChart (rank 역순) + BarChart (km).
// Y축은 reversed — 1위가 위.

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { TrendingUp, BarChart3 } from 'lucide-react';
import { useI18n, formatRank } from '@/lib/i18n';

type PeriodType = 'weekly' | 'monthly' | 'yearly';
type Scope = 'nation' | 'region' | 'decade' | 'starter' | 'gender';
type Mode = 'rank' | 'km';

interface RankPoint {
  period_idx: number;
  period_start: string;
  period_end: string;
  period_label: string;
  rank_position: number;
  total_in_scope: number;
  my_km: number;
}

const PERIOD_OPTIONS: { id: PeriodType; label: string; periods: number }[] = [
  { id: 'weekly', label: '주간 (12주)', periods: 12 },
  { id: 'monthly', label: '월간 (12개월)', periods: 12 },
  { id: 'yearly', label: '연간 (5년)', periods: 5 },
];

const SCOPE_OPTIONS: { id: Scope; label: string }[] = [
  { id: 'nation', label: '전국' },
  { id: 'region', label: '내 지역' },
  { id: 'decade', label: '내 또래' },
  { id: 'starter', label: '동기' },
  { id: 'gender', label: '같은 성별' },
];

export default function RankingTimeline() {
  const { user } = useAuth();
  const { tt, locale } = useI18n();
  const [period, setPeriod] = useState<PeriodType>('weekly');
  const [scope, setScope] = useState<Scope>('nation');
  const [mode, setMode] = useState<Mode>('rank');
  const [data, setData] = useState<RankPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const supabase = getSupabase();
        const periods = PERIOD_OPTIONS.find(p => p.id === period)?.periods ?? 12;
        const { data: rows, error } = await supabase.rpc('fetch_my_rank_history', {
          target_user_id: user.id,
          scope_type: scope,
          period_type: period,
          periods,
        });
        if (cancelled) return;
        if (error) {
          console.warn('[RankingTimeline] RPC 실패', error);
          setData([]);
        } else {
          // period_idx 0 = 가장 최근 → DESC. 그래프는 시간순 ASC 정렬.
          const sorted = ((rows ?? []) as RankPoint[]).sort((a, b) => b.period_idx - a.period_idx);
          setData(sorted);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, period, scope]);

  const hasData = data.some(d => d.rank_position > 0);
  // rank 0 (기록 없음) → null 처리 — recharts 가 끊김으로 표시
  const chartData = data.map(d => ({
    ...d,
    rank_position: d.rank_position > 0 ? d.rank_position : null,
    my_km: Number(d.my_km),
  }));
  const maxRank = Math.max(...data.map(d => d.rank_position || 0), 1);
  const yDomainMax = Math.max(maxRank, 10);

  if (loading) {
    return <div className="card p-5 h-[320px] animate-pulse" />;
  }

  if (!hasData) {
    return (
      <div className="card p-5 text-center">
        <TrendingUp size={28} className="mx-auto text-[var(--muted)] opacity-40 mb-2" />
        <p className="text-sm font-semibold text-[var(--foreground)]">{tt('아직 시계열 데이터가 부족해요')}</p>
        <p className="text-xs text-[var(--muted)] mt-1">{tt('몇 주만 더 달리면 그래프가 채워져요')}</p>
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-bold text-[var(--foreground)] inline-flex items-center gap-1.5">
          <TrendingUp size={16} className="text-emerald-500" />
          {tt('내 순위 시계열')}
        </h3>
        {/* mode 토글 — rank / km */}
        <div className="inline-flex bg-[var(--card-border)]/30 rounded-lg p-0.5">
          <button
            onClick={() => setMode('rank')}
            className={`px-2.5 py-1 rounded-md text-[13px] font-bold inline-flex items-center gap-1 ${
              mode === 'rank' ? 'bg-emerald-500 text-white shadow-sm' : 'text-[var(--muted)]'
            }`}
          >
            <TrendingUp size={11} /> {tt('순위')}
          </button>
          <button
            onClick={() => setMode('km')}
            className={`px-2.5 py-1 rounded-md text-[13px] font-bold inline-flex items-center gap-1 ${
              mode === 'km' ? 'bg-emerald-500 text-white shadow-sm' : 'text-[var(--muted)]'
            }`}
          >
            <BarChart3 size={11} /> km
          </button>
        </div>
      </div>

      {/* period 토글 */}
      <div className="flex gap-1.5 mb-2 overflow-x-auto scrollbar-hide pb-1">
        {PERIOD_OPTIONS.map(p => (
          <button
            key={p.id}
            onClick={() => setPeriod(p.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap flex-shrink-0 ${
              period === p.id ? 'bg-emerald-500 text-white' : 'bg-[var(--card-border)]/30 text-[var(--muted)]'
            }`}
          >
            {tt(p.label)}
          </button>
        ))}
      </div>

      {/* scope 토글 */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto scrollbar-hide pb-1">
        {SCOPE_OPTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => setScope(s.id)}
            className={`px-2.5 py-1 rounded-full text-[12px] font-bold whitespace-nowrap flex-shrink-0 ${
              scope === s.id ? 'bg-[var(--foreground)] text-[var(--background)]' : 'bg-[var(--card-border)]/20 text-[var(--muted)]'
            }`}
          >
            {tt(s.label)}
          </button>
        ))}
      </div>

      {mode === 'rank' ? (
        <>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" vertical={false} />
              <XAxis dataKey="period_label" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 10, fill: 'var(--muted)' }}
                reversed
                domain={[1, yDomainMax]}
                allowDecimals={false}
                axisLine={false} tickLine={false}
              />
              <Tooltip
                contentStyle={{ background: 'var(--card)', border: '1px solid var(--card-border)', borderRadius: 14, fontSize: 12 }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(value: any, _name: any, props: any) => {
                  const rankLabel = tt('순위');
                  if (value == null) return ['—', rankLabel];
                  const total = (props?.payload as RankPoint | undefined)?.total_in_scope ?? 0;
                  return [`${formatRank(Number(value), locale)} / ${total.toLocaleString()}`, rankLabel];
                }}
              />
              <Line
                type="monotone"
                dataKey="rank_position"
                stroke="#10b981"
                strokeWidth={3}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                dot={(props: any) => {
                  const r: number | null | undefined = props?.payload?.rank_position;
                  const cx = props?.cx ?? 0;
                  const cy = props?.cy ?? 0;
                  const key = props?.key ?? `${cx}-${cy}`;
                  if (r == null) {
                    return <circle key={key} cx={cx} cy={cy} r={0} fill="transparent" />;
                  }
                  const color = r === 1 ? '#f59e0b' : r <= 3 ? '#fb923c' : r <= 10 ? '#10b981' : '#94a3b8';
                  const size = r === 1 ? 6 : 4;
                  return <circle key={key} cx={cx} cy={cy} r={size} fill={color} stroke="white" strokeWidth={1.5} />;
                }}
                activeDot={{ r: 7, strokeWidth: 2 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
          <p className="text-[12px] text-[var(--muted)] mt-2 text-center">{tt('위로 갈수록 좋은 순위 · 1위가 최상단')}</p>
        </>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="kmBarGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34D399" />
                  <stop offset="100%" stopColor="#10B981" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" vertical={false} />
              <XAxis dataKey="period_label" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 10, fill: 'var(--muted)' }}
                unit="km"
                axisLine={false} tickLine={false}
              />
              <Tooltip
                contentStyle={{ background: 'var(--card)', border: '1px solid var(--card-border)', borderRadius: 14, fontSize: 12 }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(value: any) => [`${Number(value).toFixed(1)}km`, tt('거리')]}
                cursor={{ fill: 'var(--card-border)', opacity: 0.3 }}
              />
              <Bar dataKey="my_km" fill="url(#kmBarGrad)" radius={[6, 6, 0, 0]} animationDuration={600} />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[12px] text-[var(--muted)] mt-2 text-center">{tt('기간별 내 거리 합계')}</p>
        </>
      )}
    </div>
  );
}
