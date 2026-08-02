'use client';

// 홈 시각화 클러스터 (2026-08-01~02 hans)
// 순서 확정 (hans): ① 최근 30일 → ② 페이스 추이 → ③ 거리×페이스 → ④ 요일 패턴 → ⑤ 시간대별 분포
// 전부 서버 조회 없이 activities 로컬 계산. 제목 탭 = /stats 딥링크.
// 폼 원칙: 추이=막대/선, 분포=버블, 주기=레이더, 구성비=도넛.

import { useMemo } from 'react';
import Link from 'next/link';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
  AreaChart, Area, ScatterChart, Scatter, ZAxis,
  PieChart, Pie, Cell,
} from 'recharts';
import { useUserData } from '@/components/UserDataProvider';
import { useI18n } from '@/lib/i18n';
import { toLocalDateStr } from '@/lib/kst';
import { chartStyle } from '@/lib/chart-theme';
import { runningOnly } from '@/lib/routinist-data';

// 시간대 5분할 (2026-08-02 hans): 새벽·오전·오후·저녁·밤. 색 = 하루 하늘 은유
// (여명 teal → 해 amber → 한낮 sky → 노을 red → 밤 indigo). 인접쌍 CVD ΔE 14+ 검증 완료.
const HOUR_COLORS = ['#14B8A6', '#F59E0B', '#0EA5E9', '#EF4444', '#6366F1'];

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

  // ② 페이스 추이 — 최근 12개월 월별 가중평균 (총시간/총거리)
  const paceTrend = useMemo(() => {
    const agg = new Map<string, { sec: number; km: number }>();
    runningOnly(activities).forEach(a => {
      if (!a.duration_seconds || !a.distance_km || Number(a.distance_km) < 0.3) return;
      const ym = a.activity_date.slice(0, 7);
      const cur = agg.get(ym) ?? { sec: 0, km: 0 };
      cur.sec += a.duration_seconds;
      cur.km += Number(a.distance_km);
      agg.set(ym, cur);
    });
    const months = [...agg.keys()].sort().slice(-12);
    return months
      .map(ym => {
        const { sec, km } = agg.get(ym)!;
        return { month: en ? ym.slice(2) : `${Number(ym.slice(5))}월`, pace: km > 0 ? Math.round(sec / km) : 0 };
      })
      .filter(m => m.pace > 0);
  }, [activities, en]);

  // ③ 거리 × 페이스 버블 — 최근 6개월 (버블 크기 = 시간)
  const bubble = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 180);
    const cutStr = toLocalDateStr(cutoff);
    return runningOnly(activities)
      .filter(a => a.pace_avg_sec_per_km && a.pace_avg_sec_per_km > 0 && Number(a.distance_km) >= 1 && a.activity_date >= cutStr)
      .map(a => ({
        km: Number(Number(a.distance_km).toFixed(2)),
        pace: a.pace_avg_sec_per_km as number,
        durMin: Math.round((a.duration_seconds ?? 0) / 60),
      }));
  }, [activities]);

  // ④ 요일별 러닝 횟수 (최근 1년)
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

  // ⑤ 시간대별 러닝 분포 (최근 1년, started_at 있는 활동)
  const hourGroups = useMemo(() => {
    const groups = en
      ? [
          { label: 'Dawn', sub: '0–6', count: 0 },
          { label: 'Morning', sub: '6–12', count: 0 },
          { label: 'Afternoon', sub: '12–18', count: 0 },
          { label: 'Evening', sub: '18–21', count: 0 },
          { label: 'Night', sub: '21–24', count: 0 },
        ]
      : [
          { label: '새벽', sub: '0~6시', count: 0 },
          { label: '오전', sub: '6~12시', count: 0 },
          { label: '오후', sub: '12~18시', count: 0 },
          { label: '저녁', sub: '18~21시', count: 0 },
          { label: '밤', sub: '21~24시', count: 0 },
        ];
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    const cutoffStr = toLocalDateStr(cutoff);
    runningOnly(activities).forEach(a => {
      if (!a.started_at || a.activity_date < cutoffStr) return;
      const h = new Date(a.started_at).getHours();
      groups[h < 6 ? 0 : h < 12 ? 1 : h < 18 ? 2 : h < 21 ? 3 : 4].count++;
    });
    return groups;
  }, [activities, en]);
  const hourTotal = hourGroups.reduce((s, g) => s + g.count, 0);
  const maxHourGroup = hourGroups.reduce((m, g) => (g.count > m.count ? g : m), hourGroups[0]);

  if (daily30Total <= 0 && !maxDay) return null; // 데이터 없으면 통째로 생략 (신규 유저)

  const fmtPace = (v: number) => `${Math.floor(v / 60)}'${String(Math.round(v % 60)).padStart(2, '0')}"`;
  const tooltipStyle = {
    background: 'var(--card-bg)',
    border: '1px solid var(--card-border)',
    borderRadius: 14,
    fontSize: 16,
  };

  const CardTitle = ({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) => (
    <div className="flex items-baseline justify-between mb-3">
      <Link href="/stats" className="flex items-center gap-1">
        <h3 className="text-2xl font-extrabold tracking-tight text-[var(--foreground)]">{children}</h3>
        <span className="text-sm font-bold text-[var(--muted)]">›</span>
      </Link>
      {right}
    </div>
  );

  return (
    <>
      {/* ① 최근 30일 — 시간 흐름 위 양 = 막대 */}
      {daily30Total > 0 && (
        <div className="mx-4 card p-5">
          <CardTitle right={
            <p className="text-xl font-extrabold tabular-nums text-[var(--accent)]">
              {daily30Total.toFixed(1)}<span className="text-lg font-bold text-[var(--muted)]"> km</span>
            </p>
          }>{tt('최근 30일')}</CardTitle>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={daily} margin={{ top: 4, right: 0, left: -14, bottom: 0 }}>
              <defs>
                <linearGradient id="homeDailyGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34D399" />
                  <stop offset="100%" stopColor="#10B981" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray={chartStyle.gridDash} stroke="var(--card-border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 14, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval={6} />
              <YAxis tick={{ fontSize: 14, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={36} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v}km`]} cursor={{ fill: 'var(--card-border)', opacity: 0.3 }} />
              <Bar dataKey="distance" fill="url(#homeDailyGrad)" radius={chartStyle.barRadius} animationDuration={chartStyle.animationDuration} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ② 페이스 추이 — 최근 12개월 */}
      {paceTrend.length >= 3 && (
        <div className="mx-4 card p-5">
          <CardTitle right={<p className="text-base font-semibold text-[var(--muted)]">{en ? 'higher = faster' : '위로 갈수록 빠름'}</p>}>
            {tt('페이스 추이')}
          </CardTitle>
          <ResponsiveContainer width="100%" height={170}>
            <AreaChart data={paceTrend} margin={{ top: 4, right: 4, left: -6, bottom: 0 }}>
              <defs>
                <linearGradient id="homePaceGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10B981" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#10B981" stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray={chartStyle.gridDash} stroke="var(--card-border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 14, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
              <YAxis
                reversed
                domain={['dataMin - 15', 'dataMax + 15']}
                tickFormatter={fmtPace}
                tick={{ fontSize: 14, fill: 'var(--muted)' }}
                axisLine={false} tickLine={false} width={54}
              />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmtPace(Number(v)), tt('평균 페이스')]} />
              <Area type="monotone" dataKey="pace" stroke="#10B981" strokeWidth={2.5} fill="url(#homePaceGrad)" dot={{ r: 4, fill: '#10B981' }} animationDuration={chartStyle.animationDuration} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ③ 거리 × 페이스 — 분포 = 버블 */}
      {bubble.length >= 5 && (
        <div className="mx-4 card p-5">
          <CardTitle right={<p className="text-base font-semibold text-[var(--muted)]">{en ? 'last 6 months' : '최근 6개월'}</p>}>
            {tt('거리 × 페이스')}
          </CardTitle>
          <ResponsiveContainer width="100%" height={190}>
            <ScatterChart margin={{ top: 8, right: 8, left: -6, bottom: 0 }}>
              <CartesianGrid strokeDasharray={chartStyle.gridDash} stroke="var(--card-border)" />
              <XAxis type="number" dataKey="km" unit="km" domain={['dataMin - 0.5', 'dataMax + 0.5']} tick={{ fontSize: 14, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
              <YAxis type="number" dataKey="pace" reversed domain={['dataMin - 15', 'dataMax + 15']} tickFormatter={fmtPace} tick={{ fontSize: 14, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={54} />
              <ZAxis type="number" dataKey="durMin" range={[50, 320]} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value, name) => {
                  if (name === 'pace') return [fmtPace(Number(value)), tt('페이스')];
                  if (name === 'km') return [`${value}km`, tt('거리')];
                  return [`${value}${en ? 'min' : '분'}`, tt('시간')];
                }}
              />
              <Scatter data={bubble} fill="#10B981" fillOpacity={0.55} animationDuration={chartStyle.animationDuration} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ④ 요일 패턴 — 주기 = 7각형 레이더 */}
      {maxDay && (
        <div className="mx-4 card p-5">
          <CardTitle right={
            <p className="text-lg font-semibold text-[var(--muted)]">
              {en
                ? <>mostly <span className="text-[var(--accent)] font-extrabold">{maxDay.day}</span></>
                : <>주로 <span className="text-[var(--accent)] font-extrabold">{maxDay.day}요일</span></>}
            </p>
          }>{tt('요일 패턴')}</CardTitle>
          <ResponsiveContainer width="100%" height={250}>
            <RadarChart data={byDay} margin={{ top: 10, right: 24, bottom: 10, left: 24 }}>
              <PolarGrid stroke="var(--card-border)" strokeDasharray={chartStyle.gridDash} />
              <PolarAngleAxis dataKey="day" tick={{ fontSize: 17, fill: 'var(--foreground)', fontWeight: 700 }} />
              <Radar
                name={tt('러닝 횟수')}
                dataKey="count"
                stroke="#10B981"
                fill="#10B981"
                fillOpacity={0.22}
                strokeWidth={2.5}
                dot={{ r: 4, fill: '#10B981' }}
                animationDuration={chartStyle.animationDuration}
              />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [en ? `${v} runs` : `${v}회`]} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ⑤ 시간대별 러닝 분포 — 구성비 = 도넛 (hans: /stats 에서 홈으로) */}
      {hourTotal > 0 && (
        <div className="mx-4 card p-5">
          <CardTitle right={
            <p className="text-lg font-semibold text-[var(--muted)]">
              {en
                ? <>mostly <span className="text-[var(--accent)] font-extrabold">{maxHourGroup.label}</span></>
                : <>주로 <span className="text-[var(--accent)] font-extrabold">{maxHourGroup.label}</span></>}
            </p>
          }>{tt('시간대별 분포')}</CardTitle>
          {/* 2026-08-02 hans: 좁은 옆 범례에서 라벨이 "오…"로 잘려 오전/오후 구분 불가
              → 도넛 위·범례 아래 세로 스택 (풀폭 행이라 라벨+시간대+횟수+% 전부 표시) */}
          <div className="flex flex-col items-center gap-3">
            <div className="relative w-44 h-44 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={hourGroups.map((g, i) => ({ ...g, fill: HOUR_COLORS[i] })).filter(g => g.count > 0)}
                    dataKey="count"
                    nameKey="label"
                    innerRadius={54}
                    outerRadius={80}
                    paddingAngle={3}
                    strokeWidth={0}
                    animationDuration={chartStyle.animationDuration}
                  >
                    {hourGroups.map((g, i) => ({ ...g, fill: HOUR_COLORS[i] })).filter(g => g.count > 0).map(g => (
                      <Cell key={g.label} fill={g.fill} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => [en ? `${v} runs` : `${v}회`]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <p className="text-2xl font-extrabold text-[var(--foreground)]">{maxHourGroup.label}</p>
                <p className="text-base font-semibold text-[var(--muted)]">{en ? `${hourTotal} runs` : `총 ${hourTotal}회`}</p>
              </div>
            </div>
            <div className="w-full space-y-2">
              {hourGroups.map((g, i) => (
                <div key={g.label} className={`flex items-center gap-2.5 ${g.count === 0 ? 'opacity-45' : ''}`}>
                  <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: HOUR_COLORS[i] }} />
                  <span className="text-lg font-medium text-[var(--foreground)]">{g.label}</span>
                  <span className="flex-1 text-sm text-[var(--muted)]">{g.sub}</span>
                  <span className="text-lg font-extrabold tabular-nums text-[var(--foreground)]">
                    {en ? g.count : `${g.count}회`}
                  </span>
                  <span className="w-11 text-right text-base tabular-nums text-[var(--muted)]">
                    {hourTotal > 0 ? `${Math.round((g.count / hourTotal) * 100)}%` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
