'use client';

// 내 기록 통계 차트 클러스터 — 홈 UX Phase B (build 327, hans 리뷰).
// 홈에 쌓여 있던 차트 7종 (PB·일별30일·12주·페이스·요일·시간대·기간상세) 을
// dashboard 에서 그대로 이관한 자립 컴포넌트. /stats 페이지가 호스트.
// 데이터 캐시 키는 홈 시절 그대로 (home:stats:*) — PullToRefresh invalidate 연동 유지.

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/components/UserDataProvider';
import { formatPace, formatDuration } from '@/lib/routinist-data';
import {
  fetchDistanceByPeriod,
  fetchPersonalBests,
  fetchPaceTrend,
  type PeriodDistance,
  type PersonalBest,
  type DayOfWeekStat,
  type HourOfDayStat,
  type PaceTrend,
} from '@/lib/stats-data';
import { dataCache, onCacheInvalidated } from '@/lib/data-cache';
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, Radar, Legend,
} from 'recharts';
import LazyMount from '@/components/LazyMount';
import { useI18n } from '@/lib/i18n';
import { ChevronRight, Trophy, Clock, Calendar, BarChart3, TrendingUp } from 'lucide-react';
import { chartStyle } from '@/lib/chart-theme';
import { toLocalDateStr } from '@/lib/kst';
import { useDistanceUnit, toDisplayDistance, unitLabel, paceUnitLabel, formatPaceForUnit } from '@/lib/units';

type PeriodMode = 'weekly' | 'monthly' | 'quarterly' | 'half' | 'yearly';
type ChartType = 'bar' | 'line';

const PERIOD_OPTIONS: { id: PeriodMode; label: string }[] = [
  { id: 'weekly', label: '주간' },
  { id: 'monthly', label: '월간' },
  { id: 'quarterly', label: '분기' },
  { id: 'half', label: '반기' },
  { id: 'yearly', label: '연간' },
];

export default function StatsCharts() {
  const { tt, locale } = useI18n();
  const unit = useDistanceUnit();
  const { user } = useAuth();
  const { activities } = useUserData();

  const [monthlyData, setMonthlyData] = useState<PeriodDistance[]>([]);
  const [weeklyData, setWeeklyData] = useState<PeriodDistance[]>([]);
  const [personalBests, setPersonalBests] = useState<PersonalBest | null>(null);
  const [pbScope, setPbScope] = useState<'all' | 'year'>('year');
  const [dayScope, setDayScope] = useState<'all' | 'year'>('year');
  const [hourScope, setHourScope] = useState<'all' | 'year'>('year');
  const [paceTrend, setPaceTrend] = useState<PaceTrend[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);

  const [periodMode, setPeriodMode] = useState<PeriodMode>('monthly');
  const [chartType, setChartType] = useState<ChartType>('bar');
  const [detailYear, setDetailYear] = useState(new Date().getFullYear());
  const [detailData, setDetailData] = useState<PeriodDistance[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const year = new Date().getFullYear();

  const statsCacheKey = useMemo(() => user ? `home:stats:${user.id}:${year}` : null, [user, year]);

  const loadStats = useCallback(async (opts?: { force?: boolean }) => {
    if (!user || !statsCacheKey) return;
    if (!opts?.force) {
      const cached = dataCache.get<{
        monthly: PeriodDistance[]; weekly: PeriodDistance[]; pb: PersonalBest | null;
        pace: PaceTrend[];
      }>(statsCacheKey);
      if (cached) {
        setMonthlyData(cached.value.monthly);
        setWeeklyData(cached.value.weekly);
        setPersonalBests(cached.value.pb);
        setPaceTrend(cached.value.pace);
        setStatsLoading(false);
        return;
      }
    }
    setStatsLoading(true);
    try {
      const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
        Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
      const essentialP = Promise.allSettled([
        withTimeout(fetchDistanceByPeriod(user.id, 'monthly', year), 2500, []),
        withTimeout(fetchDistanceByPeriod(user.id, 'weekly', year), 2500, []),
      ]);
      const optionalP = Promise.allSettled([
        withTimeout(fetchPersonalBests(user.id), 4000, null),
        withTimeout(fetchPaceTrend(user.id), 4500, []),
      ]);
      const val = <T,>(r: PromiseSettledResult<T>, fallback: T): T =>
        r.status === 'fulfilled' ? r.value : fallback;
      const eRes = await essentialP;
      const monthly = val(eRes[0], [] as PeriodDistance[]);
      const weekly = val(eRes[1], [] as PeriodDistance[]);
      setMonthlyData(monthly);
      setWeeklyData(weekly);
      setStatsLoading(false);
      const oRes = await optionalP;
      const pb = val(oRes[0], null as PersonalBest | null);
      const pace = val(oRes[1], [] as PaceTrend[]);
      setPersonalBests(pb);
      setPaceTrend(pace);
      dataCache.set(statsCacheKey, { monthly, weekly, pb, pace });
    } catch (err) {
      console.warn('[stats] 통계 로드 실패:', err);
      setStatsLoading(false);
    }
  }, [user, year, statsCacheKey]);

  useEffect(() => { loadStats(); }, [loadStats]);

  useEffect(() => {
    if (!statsCacheKey) return;
    return onCacheInvalidated((prefix) => {
      if (statsCacheKey.startsWith(prefix) || prefix === '') {
        void loadStats({ force: true });
      }
    });
  }, [statsCacheKey, loadStats]);

  const loadDetail = useCallback(async () => {
    if (!user) return;
    setDetailLoading(true);
    try {
      const result = await Promise.race([
        fetchDistanceByPeriod(user.id, periodMode, detailYear),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('detail fetch timeout 8s')), 8000)
        ),
      ]);
      setDetailData(result);
    } catch (e) {
      console.warn('[stats] loadDetail 실패', e);
      setDetailData([]);
    } finally {
      setDetailLoading(false);
    }
  }, [user, periodMode, detailYear]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  const dailyData = useMemo(() => {
    const map = new Map<string, number>();
    activities.forEach(a => {
      map.set(a.activity_date, (map.get(a.activity_date) || 0) + Number(a.distance_km));
    });
    const result: { label: string; distance: number; dateStr: string }[] = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = toLocalDateStr(d);
      result.push({
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        distance: Math.round((map.get(key) || 0) * 10) / 10,
        dateStr: key,
      });
    }
    return result;
  }, [activities]);
  const daily30Total = dailyData.reduce((s, d) => s + d.distance, 0);

  const dayStats = useMemo<DayOfWeekStat[]>(() => {
    const days = locale === 'en'
      ? ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
      : ['일','월','화','수','목','금','토'];
    const stats: DayOfWeekStat[] = days.map((day, i) => ({ day, dayIndex: i, runCount: 0, totalDistance: 0, avgDistance: 0 }));
    const filtered = dayScope === 'year'
      ? activities.filter(a => a.activity_date.slice(0, 4) === String(year))
      : activities;
    filtered.forEach(a => {
      const [ay, am, ad] = a.activity_date.split('-').map(Number);
      const di = new Date(ay, am - 1, ad).getDay();
      stats[di].runCount++;
      stats[di].totalDistance += Number(a.distance_km);
    });
    stats.forEach(s => { s.avgDistance = s.runCount > 0 ? Math.round(s.totalDistance / s.runCount * 10) / 10 : 0; });
    return stats;
  }, [activities, dayScope, year, locale]);

  const hourStats = useMemo<HourOfDayStat[]>(() => {
    const hours: HourOfDayStat[] = [];
    for (let h = 0; h < 24; h++) {
      hours.push({ hour: h, label: locale === 'en' ? `${h}h` : `${h}시`, runCount: 0 });
    }
    const filtered = hourScope === 'year'
      ? activities.filter(a => a.started_at && new Date(a.started_at).getFullYear() === year)
      : activities.filter(a => a.started_at);
    filtered.forEach(a => {
      if (!a.started_at) return;
      const hour = new Date(a.started_at).getHours();
      hours[hour].runCount++;
    });
    return hours;
  }, [activities, hourScope, year, locale]);

  const hourGroups = locale === 'en' ? [
    { label: 'Dawn (0–6)', count: hourStats.slice(0, 6).reduce((s, h) => s + h.runCount, 0) },
    { label: 'Morning (6–12)', count: hourStats.slice(6, 12).reduce((s, h) => s + h.runCount, 0) },
    { label: 'Afternoon (12–18)', count: hourStats.slice(12, 18).reduce((s, h) => s + h.runCount, 0) },
    { label: 'Evening (18–24)', count: hourStats.slice(18, 24).reduce((s, h) => s + h.runCount, 0) },
  ] : [
    { label: '새벽 (0~6시)', count: hourStats.slice(0, 6).reduce((s, h) => s + h.runCount, 0) },
    { label: '오전 (6~12시)', count: hourStats.slice(6, 12).reduce((s, h) => s + h.runCount, 0) },
    { label: '오후 (12~18시)', count: hourStats.slice(12, 18).reduce((s, h) => s + h.runCount, 0) },
    { label: '저녁 (18~24시)', count: hourStats.slice(18, 24).reduce((s, h) => s + h.runCount, 0) },
  ];
  const maxHourGroup = hourGroups.reduce((m, g) => g.count > m.count ? g : m, hourGroups[0]);
  const maxDay = dayStats.reduce(
    (m, d) => d.runCount > m.runCount ? d : m,
    dayStats[0] || { day: '-', runCount: 0, avgDistance: 0 }
  );

  const ytdSliceCount = (() => {
    const isCurrentYear = detailYear === new Date().getFullYear();
    if (!isCurrentYear) return detailData.length;
    const m = new Date().getMonth();
    if (periodMode === 'monthly') return m + 1;
    if (periodMode === 'quarterly') return Math.floor(m / 3) + 1;
    if (periodMode === 'half') return m < 6 ? 1 : 2;
    if (periodMode === 'weekly') return detailData.length;
    if (periodMode === 'yearly') return detailData.length;
    return detailData.length;
  })();
  const detailSliced = periodMode === 'yearly'
    ? detailData.slice(detailData.length - 1)
    : detailData.slice(0, ytdSliceCount);
  const detailLast = detailSliced.length > 0 ? detailSliced[detailSliced.length - 1] : null;
  const detailTotal = detailLast?.distance ?? 0;
  const detailPrevTotal = detailLast?.prevDistance ?? 0;
  const hasDetailPrev = (detailLast?.prevDistance ?? 0) > 0;

  return (
    <div className="space-y-4">
      {/* 개인 베스트 — 올해/누적 탭 */}
      {personalBests && (() => {
        const yearStart = `${year}-01-01`;
        const yearEnd = `${year}-12-31`;
        const ya = activities.filter(a => a.activity_date >= yearStart && a.activity_date <= yearEnd);
        const yearPB: PersonalBest = { longestRun: null, fastestPace: null, longestDuration: null, mostCalories: null };
        for (const a of ya) {
          const km = Number(a.distance_km);
          if (!yearPB.longestRun || km > yearPB.longestRun.distance_km) yearPB.longestRun = { distance_km: km, date: a.activity_date };
          if (a.pace_avg_sec_per_km && km >= 1 && (!yearPB.fastestPace || a.pace_avg_sec_per_km < yearPB.fastestPace.pace)) {
            yearPB.fastestPace = { pace: a.pace_avg_sec_per_km, date: a.activity_date, distance_km: km };
          }
          if (a.duration_seconds && (!yearPB.longestDuration || a.duration_seconds > yearPB.longestDuration.duration)) {
            yearPB.longestDuration = { duration: a.duration_seconds, date: a.activity_date };
          }
          if (a.calories && (!yearPB.mostCalories || a.calories > yearPB.mostCalories.calories)) {
            yearPB.mostCalories = { calories: a.calories, date: a.activity_date };
          }
        }
        const pb = pbScope === 'all' ? personalBests : yearPB;
        const yearHasData = ya.length > 0;
        return (
        <LazyMount minHeight={280}>
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Trophy size={16} className="text-yellow-500" />
              <h3 className="text-lg font-bold text-[var(--foreground)]">{tt('개인 베스트')}</h3>
            </div>
            <div className="flex items-center gap-1 bg-[var(--card-border)]/30 rounded-lg p-0.5">
              <button
                onClick={() => setPbScope('year')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${pbScope === 'year' ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted)]'}`}
              >
                {year}
              </button>
              <button
                onClick={() => setPbScope('all')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${pbScope === 'all' ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted)]'}`}
              >
                {tt('누적')}
              </button>
            </div>
          </div>
          {pbScope === 'year' && !yearHasData ? (
            <p className="text-sm text-[var(--muted)] text-center py-6">{locale === 'en' ? `No records for ${year} yet` : `${year}년 기록이 아직 없어요`}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {pb.longestRun && (
                <div className="bg-[var(--card-border)]/30 rounded-xl p-3">
                  <p className="text-sm text-[var(--muted)] mb-1">{tt('최장 거리')}</p>
                  <p className="text-2xl font-extrabold text-[var(--foreground)]">{toDisplayDistance(pb.longestRun.distance_km, unit).toFixed(2)}{unitLabel(unit)}</p>
                  <p className="text-xs text-[var(--muted)]">{pb.longestRun.date}</p>
                </div>
              )}
              {pb.fastestPace && (
                <div className="bg-[var(--card-border)]/30 rounded-xl p-3">
                  <p className="text-sm text-[var(--muted)] mb-1">{tt('최빠 페이스')}</p>
                  <p className="text-2xl font-extrabold text-[var(--foreground)]">{formatPaceForUnit(pb.fastestPace.pace, unit)}{paceUnitLabel(unit)}</p>
                  <p className="text-xs text-[var(--muted)]">{pb.fastestPace.date} ({toDisplayDistance(pb.fastestPace.distance_km, unit).toFixed(1)}{unitLabel(unit)})</p>
                </div>
              )}
              {pb.longestDuration && (
                <div className="bg-[var(--card-border)]/30 rounded-xl p-3">
                  <p className="text-sm text-[var(--muted)] mb-1">{tt('최장 시간')}</p>
                  <p className="text-2xl font-extrabold text-[var(--foreground)]">{formatDuration(pb.longestDuration.duration)}</p>
                  <p className="text-xs text-[var(--muted)]">{pb.longestDuration.date}</p>
                </div>
              )}
              {pb.mostCalories && pb.mostCalories.calories > 0 && (
                <div className="bg-[var(--card-border)]/30 rounded-xl p-3">
                  <p className="text-sm text-[var(--muted)] mb-1">{tt('최다 칼로리')}</p>
                  <p className="text-2xl font-extrabold text-[var(--foreground)]">{pb.mostCalories.calories}kcal</p>
                  <p className="text-xs text-[var(--muted)]">{pb.mostCalories.date}</p>
                </div>
              )}
            </div>
          )}
        </div>
        </LazyMount>
        );
      })()}

      {/* 일별 거리 추이 (최근 30일) */}
      <LazyMount minHeight={260}>
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-[var(--foreground)]">{tt('일별 거리 추이')}</h3>
          <span className="text-sm text-[var(--muted)]">{locale === 'en' ? `Last 30 days · ${daily30Total.toFixed(1)}km total` : `최근 30일 · 총 ${daily30Total.toFixed(1)}km`}</span>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={dailyData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="statsDailyGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#34D399" />
                <stop offset="100%" stopColor="#10B981" />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray={chartStyle.gridDash} stroke="var(--card-border)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12, fill: 'var(--muted)' }}
              axisLine={false}
              tickLine={false}
              interval={4}
            />
            <YAxis tick={{ fontSize: chartStyle.tickFontSize, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: 'var(--card)', border: '1px solid var(--card-border)', borderRadius: 14, fontSize: 13 }}
              formatter={(value) => [`${value}km`]}
              cursor={{ fill: 'var(--card-border)', opacity: 0.3 }}
            />
            <Bar dataKey="distance" fill="url(#statsDailyGrad)" radius={chartStyle.barRadius} animationDuration={chartStyle.animationDuration} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      </LazyMount>

      {/* 최근 12주 러닝 */}
      {weeklyData.length > 0 && (
        <LazyMount minHeight={240}>
        <div className="card p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-lg font-bold text-[var(--foreground)]">{tt('최근 12주 러닝')}</h3>
            {(() => {
              const nowMs = Date.now();
              const _12wMs = 12 * 7 * 24 * 60 * 60 * 1000;
              const yearMs = 365 * 24 * 60 * 60 * 1000;
              let thisSum = 0, lastSum = 0;
              activities.forEach(a => {
                const [ay, am, ad] = a.activity_date.split('-').map(Number);
                const t = new Date(ay, am - 1, ad).getTime(); // 로컬 자정 (UTC 파싱 금지)
                if (t >= nowMs - _12wMs) thisSum += a.distance_km;
                else if (t >= nowMs - yearMs - _12wMs && t < nowMs - yearMs) lastSum += a.distance_km;
              });
              const diff = thisSum - lastSum;
              if (lastSum < 0.5 && thisSum < 0.5) return null;
              if (lastSum < 0.5) {
                return <span className="text-xs font-semibold text-emerald-600">{tt('전년 동기 첫 기록 🎉')}</span>;
              }
              const sign = diff >= 0 ? '+' : '';
              const color = diff >= 0 ? 'text-emerald-600' : 'text-rose-500';
              return (
                <span className={`text-xs font-semibold ${color}`}>
                  {locale === 'en' ? `vs last year ${sign}${diff.toFixed(0)}km` : `전년 동기 ${sign}${diff.toFixed(0)}km`}
                </span>
              );
            })()}
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={weeklyData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="statsWeeklyGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#A78BFA" />
                  <stop offset="100%" stopColor="#8B5CF6" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray={chartStyle.gridDash} stroke="var(--card-border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'var(--card)', border: '1px solid var(--card-border)', borderRadius: 14, fontSize: 12 }}
                formatter={(value) => [`${value}km`]}
                cursor={{ fill: 'var(--card-border)', opacity: 0.3 }}
              />
              <Bar dataKey="distance" fill="url(#statsWeeklyGrad)" radius={chartStyle.barRadius} animationDuration={chartStyle.animationDuration} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        </LazyMount>
      )}

      {/* 페이스 추이 (최근 12개월) */}
      {paceTrend.some(p => p.avgPace !== null) && (
        <LazyMount minHeight={260}>
        <div className="card p-5">
          <h3 className="text-lg font-bold text-[var(--foreground)] mb-3">{tt('페이스 추이 (최근 12개월)')}</h3>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={paceTrend.filter(p => p.avgPace !== null)} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="statsPaceGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10B981" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#10B981" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray={chartStyle.gridDash} stroke="var(--card-border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 12, fill: 'var(--muted)' }}
                reversed
                domain={['dataMin - 20', 'dataMax + 20']}
                tickFormatter={(v: number) => `${Math.floor(v / 60)}'${String(Math.round(v % 60)).padStart(2, '0')}"`}
                axisLine={false} tickLine={false}
              />
              <Tooltip
                contentStyle={{ background: 'var(--card)', border: '1px solid var(--card-border)', borderRadius: 14, fontSize: 12 }}
                formatter={(value) => [formatPace(Number(value)), tt('평균 페이스')]}
              />
              <Area type="monotone" dataKey="avgPace" stroke="#10B981" strokeWidth={2.5} fill="url(#statsPaceGrad)" dot={{ r: 4, fill: '#10B981' }} animationDuration={chartStyle.animationDuration} />
            </AreaChart>
          </ResponsiveContainer>
          <p className="text-sm text-[var(--muted)] mt-2 text-center">{tt('위로 갈수록 빠른 페이스')}</p>
        </div>
        </LazyMount>
      )}

      {/* 요일별 패턴 — 올해/누적 토글 */}
      {dayStats.length > 0 && dayStats.some(d => d.runCount > 0) && (
        <LazyMount minHeight={360}>
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Calendar size={16} className="text-blue-500" />
              <h3 className="text-lg font-bold text-[var(--foreground)]">{tt('요일별 러닝 패턴')}</h3>
            </div>
            <div className="flex items-center gap-1 bg-[var(--card-border)]/30 rounded-lg p-0.5">
              <button
                onClick={() => setDayScope('year')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${dayScope === 'year' ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted)]'}`}
              >{year}</button>
              <button
                onClick={() => setDayScope('all')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${dayScope === 'all' ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted)]'}`}
              >{tt('누적')}</button>
            </div>
          </div>
          <p className="text-sm text-[var(--muted)] mb-3">
            {locale === 'en' ? (
              <>You mostly run on <span className="font-semibold text-[var(--accent)]">{maxDay.day}</span> ({maxDay.runCount} runs)</>
            ) : (
              <>주로 <span className="font-semibold text-[var(--accent)]">{maxDay.day}요일</span>에 달려요 ({maxDay.runCount}회)</>
            )}
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <RadarChart data={dayStats}>
              <PolarGrid stroke="var(--card-border)" strokeDasharray={chartStyle.gridDash} />
              <PolarAngleAxis dataKey="day" tick={{ fontSize: 13, fill: 'var(--muted)', fontWeight: 600 }} />
              <Radar name={tt('러닝 횟수')} dataKey="runCount" stroke="#3B82F6" fill="#3B82F6" fillOpacity={0.2} strokeWidth={2.5} dot={{ r: 4, fill: '#3B82F6' }} animationDuration={chartStyle.animationDuration} />
            </RadarChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-7 gap-1 mt-3 text-center">
            {dayStats.map(d => (
              <div key={d.day}>
                <p className="text-xs text-[var(--muted)]">{d.day}</p>
                <p className="text-lg font-extrabold text-[var(--foreground)]">{d.runCount}</p>
                <p className="text-xs text-[var(--muted)]">{d.avgDistance}km</p>
              </div>
            ))}
          </div>
        </div>
        </LazyMount>
      )}

      {/* 시간대별 분포 — 올해/누적 토글 */}
      {hourStats.some(h => h.runCount > 0) && (
        <LazyMount minHeight={220}>
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-orange-500" />
              <h3 className="text-lg font-bold text-[var(--foreground)]">{tt('시간대별 러닝 분포')}</h3>
            </div>
            <div className="flex items-center gap-1 bg-[var(--card-border)]/30 rounded-lg p-0.5">
              <button
                onClick={() => setHourScope('year')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${hourScope === 'year' ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted)]'}`}
              >{year}</button>
              <button
                onClick={() => setHourScope('all')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${hourScope === 'all' ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted)]'}`}
              >{tt('누적')}</button>
            </div>
          </div>
          <p className="text-sm text-[var(--muted)] mb-3">
            {locale === 'en' ? (
              <>You mostly run in the <span className="font-semibold text-[var(--accent)]">{maxHourGroup.label}</span></>
            ) : (
              <>주로 <span className="font-semibold text-[var(--accent)]">{maxHourGroup.label}</span>에 달려요</>
            )}
          </p>
          <div className="space-y-2">
            {hourGroups.map((g, i) => {
              const maxCount = Math.max(...hourGroups.map(g => g.count), 1);
              const barWidth = (g.count / maxCount) * 100;
              const colors = ['#6366F1', '#F59E0B', '#EF4444', '#8B5CF6'];
              return (
                <div key={g.label} className="flex items-center gap-2">
                  <span className="w-28 text-base font-medium text-[var(--foreground)] flex-shrink-0">{g.label}</span>
                  <div className="flex-1 h-5 bg-[var(--card-border)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(barWidth, 2)}%`, backgroundColor: colors[i] }}
                    />
                  </div>
                  <span className="text-base font-bold text-[var(--foreground)] w-10 text-right tabular-nums">{locale === 'en' ? g.count : `${g.count}회`}</span>
                </div>
              );
            })}
          </div>
        </div>
        </LazyMount>
      )}

      {/* 기간별 상세 통계 (+ 히스토리 링크) */}
      <LazyMount minHeight={420}>
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-[var(--foreground)]">{tt('기간별 상세 통계')}</h3>
          <Link href="/history" className="text-xs font-bold text-emerald-600 inline-flex items-center gap-0.5 active:scale-95 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30">
            {tt('히스토리')} <ChevronRight size={12} />
          </Link>
        </div>

        <div className="flex items-center justify-center gap-4 mb-3">
          <button onClick={() => setDetailYear((y) => y - 1)} className="text-[var(--muted)] text-xl font-bold">&lt;</button>
          <span className="text-lg font-bold text-[var(--foreground)]">{detailYear}</span>
          <button onClick={() => setDetailYear((y) => y + 1)} className="text-[var(--muted)] text-xl font-bold">&gt;</button>
        </div>

        <div className="text-center mb-3">
          <p className="text-4xl font-extrabold tracking-tight text-[var(--accent)]">{toDisplayDistance(detailTotal, unit).toFixed(1)} {unitLabel(unit)}</p>
          {hasDetailPrev && detailPrevTotal > 0 && (() => {
            const diff = detailTotal - detailPrevTotal;
            const pct = ((detailTotal / detailPrevTotal - 1) * 100);
            const isUp = diff >= 0;
            const sign = isUp ? '+' : '';
            const color = isUp ? 'text-emerald-600' : 'text-rose-500';
            const periodLabel = locale === 'en' ? (
              periodMode === 'monthly' ? 'vs same period last year' :
              periodMode === 'quarterly' ? `vs last year (through Q${Math.floor(new Date().getMonth() / 3) + 1})` :
              periodMode === 'half' ? 'vs last year (through current half)' :
              periodMode === 'weekly' ? 'vs last year (12 weeks)' :
              periodMode === 'yearly' ? `vs last year (through ${new Date().getMonth() + 1}/${new Date().getDate()})` :
              'vs last year'
            ) : (
              periodMode === 'monthly' ? '전년 동기간' :
              periodMode === 'quarterly' ? '전년 동기간 (Q' + (Math.floor(new Date().getMonth() / 3) + 1) + '까지)' :
              periodMode === 'half' ? '전년 동기간 (현 반기까지)' :
              periodMode === 'weekly' ? '전년 동기 (12주)' :
              periodMode === 'yearly' ? `전년 동기간 (${new Date().getMonth() + 1}/${new Date().getDate()}까지)` :
              '전년'
            );
            return (
              <p className={`text-sm mt-1 font-semibold ${color}`}>
                {periodLabel} {sign}{toDisplayDistance(diff, unit).toFixed(1)}{unitLabel(unit)} ({sign}{pct.toFixed(0)}%)
              </p>
            );
          })()}
        </div>

        <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setPeriodMode(opt.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${
                periodMode === opt.id ? 'bg-[var(--accent)] text-white' : 'bg-[var(--card-border)]/50 text-[var(--muted)]'
              }`}
            >
              {tt(opt.label)}
            </button>
          ))}
        </div>

        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setChartType('bar')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold ${
              chartType === 'bar' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--card-border)]/50 text-[var(--muted)]'
            }`}
          >
            <BarChart3 size={14} /> {tt('막대')}
          </button>
          <button
            onClick={() => setChartType('line')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold ${
              chartType === 'line' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--card-border)]/50 text-[var(--muted)]'
            }`}
          >
            <TrendingUp size={14} /> {tt('선')}
          </button>
        </div>

        {detailLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            {chartType === 'bar' ? (
              <BarChart data={detailData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="statsDetailGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#60A5FA" />
                    <stop offset="100%" stopColor="#3B82F6" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray={chartStyle.gridDash} stroke="var(--card-border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: chartStyle.tickFontSize, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: chartStyle.tickFontSize, fill: 'var(--muted)' }} unit="km" axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: 'var(--card)', border: '1px solid var(--card-border)', borderRadius: 14, fontSize: 13 }}
                  formatter={(value) => [`${value}km`]}
                  cursor={{ fill: 'var(--card-border)', opacity: 0.3 }}
                />
                {hasDetailPrev && (
                  <Bar dataKey="prevDistance" name={locale === 'en' ? String(detailYear - 1) : `${detailYear - 1}년`} fill="#CBD5E1" radius={chartStyle.barRadius} animationDuration={chartStyle.animationDuration} />
                )}
                <Bar dataKey="distance" name={locale === 'en' ? String(detailYear) : `${detailYear}년`} fill="url(#statsDetailGrad)" radius={chartStyle.barRadius} animationDuration={chartStyle.animationDuration} />
                {hasDetailPrev && <Legend wrapperStyle={{ fontSize: 13 }} />}
              </BarChart>
            ) : (
              <AreaChart data={detailData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="statsDetailAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#3B82F6" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray={chartStyle.gridDash} stroke="var(--card-border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: chartStyle.tickFontSize, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: chartStyle.tickFontSize, fill: 'var(--muted)' }} unit="km" axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: 'var(--card)', border: '1px solid var(--card-border)', borderRadius: 14, fontSize: 13 }}
                  formatter={(value) => [`${value}km`]}
                />
                {hasDetailPrev && (
                  <Area type="monotone" dataKey="prevDistance" name={locale === 'en' ? String(detailYear - 1) : `${detailYear - 1}년`} stroke="#94a3b8" strokeWidth={2} fill="none" dot={{ r: 3, fill: '#94a3b8' }} animationDuration={chartStyle.animationDuration} />
                )}
                <Area type="monotone" dataKey="distance" name={locale === 'en' ? String(detailYear) : `${detailYear}년`} stroke="#3B82F6" strokeWidth={chartStyle.strokeWidth} fill="url(#statsDetailAreaGrad)" dot={{ r: chartStyle.dotRadius, fill: '#3B82F6' }} activeDot={{ r: chartStyle.activeDotRadius, strokeWidth: 2 }} animationDuration={chartStyle.animationDuration} />
                {hasDetailPrev && <Legend wrapperStyle={{ fontSize: 13 }} />}
              </AreaChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
      </LazyMount>

      {statsLoading && monthlyData.length === 0 && (
        <p className="text-center text-xs text-[var(--muted)]">{tt('통계 로딩 중...')}</p>
      )}
    </div>
  );
}
