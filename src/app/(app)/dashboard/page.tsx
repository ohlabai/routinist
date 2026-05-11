'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/components/UserDataProvider';
import PullToRefresh from '@/components/PullToRefresh';
import {
  getStreak,
  getMaxStreak,
  getMonthlyDistance,
  getWeeklyActivities,
  formatPace,
  formatDuration,
} from '@/lib/routinist-data';
import {
  fetchDistanceByPeriod,
  fetchPersonalBests,
  fetchDayOfWeekStats,
  fetchHourOfDayStats,
  fetchPaceTrend,
  type PeriodDistance,
  type PersonalBest,
  type DayOfWeekStat,
  type HourOfDayStat,
  type PaceTrend,
} from '@/lib/stats-data';
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, Radar, Legend,
} from 'recharts';
import Onboarding from '@/components/Onboarding';
import LazyMount from '@/components/LazyMount';
import AppLogo from '@/components/AppLogo';
import HomeRankingHero from '@/components/home/HomeRankingHero';
import StreakWarningCard from '@/components/home/StreakWarningCard';
import WeeklyRecapCard from '@/components/home/WeeklyRecapCard';
import HomeCalendarCard from '@/components/home/HomeCalendarCard';
import HealthConnectCard from '@/components/home/HealthConnectCard';
import { syncHealthData, isNativeApp } from '@/lib/health-sync';
// SyncStaleBadge 제거 — HealthConnectCard 와 정보 중복 (사용자 신고 build 63)
import WinnerPredictionWidget from '@/components/home/WinnerPredictionWidget';
import TodayLocalTop from '@/components/home/TodayLocalTop';
import RoutinePhotoCarousel from '@/components/home/RoutinePhotoCarousel';
import FriendsLeaderboard from '@/components/home/FriendsLeaderboard';
import OnThisDayCard from '@/components/home/OnThisDayCard';
import LiveRunningIndicator from '@/components/home/LiveRunningIndicator';
import RankNeighbors from '@/components/home/RankNeighbors';
import FreshnessBadge from '@/components/FreshnessBadge';
import AppToast from '@/components/AppToast';
import Link from 'next/link';
import {
  ChevronRight, Flag, MapPin, Zap, Trophy, Flame, Clock, Calendar,
  BarChart3, TrendingUp,
} from 'lucide-react';
import { chartStyle } from '@/lib/chart-theme';
import { toLocalDateStr, todayStr as kstToday } from '@/lib/kst';

type PeriodMode = 'weekly' | 'monthly' | 'quarterly' | 'half' | 'yearly';
type ChartType = 'bar' | 'line';

const PERIOD_OPTIONS: { id: PeriodMode; label: string }[] = [
  { id: 'weekly', label: '주간' },
  { id: 'monthly', label: '월간' },
  { id: 'quarterly', label: '분기' },
  { id: 'half', label: '반기' },
  { id: 'yearly', label: '연간' },
];

export default function DashboardPage() {
  const { user, profile } = useAuth();
  const { activities, goals, loading: userDataLoading, refresh, lastUpdated } = useUserData();
  const [showOnboarding, setShowOnboarding] = useState(false);

  // 차트 데이터
  const [monthlyData, setMonthlyData] = useState<PeriodDistance[]>([]);
  const [weeklyData, setWeeklyData] = useState<PeriodDistance[]>([]);
  const [personalBests, setPersonalBests] = useState<PersonalBest | null>(null);
  const [pbScope, setPbScope] = useState<'all' | 'year'>('year');
  const [dayStats, setDayStats] = useState<DayOfWeekStat[]>([]);
  const [hourStats, setHourStats] = useState<HourOfDayStat[]>([]);
  const [paceTrend, setPaceTrend] = useState<PaceTrend[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);

  // 상세 차트 상태
  const [periodMode, setPeriodMode] = useState<PeriodMode>('monthly');
  const [chartType, setChartType] = useState<ChartType>('bar');
  const [detailYear, setDetailYear] = useState(new Date().getFullYear());
  const [detailData, setDetailData] = useState<PeriodDistance[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  // 폰 timezone 기준 YYYY-MM-DD — toISOString().split('T')[0] 은 UTC 라 KST 새벽에 어제로 표시되는 버그
  const todayStr = (() => {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul',
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(now);
    } catch {
      const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      return kst.toISOString().slice(0, 10);
    }
  })();

  useEffect(() => {
    const dismissed = typeof window !== 'undefined' && localStorage.getItem('onboarding_done');
    if (!dismissed && profile && profile.display_name === '러너' && profile.total_runs === 0) {
      setShowOnboarding(true);
    }
  }, [profile]);

  // 차트 데이터 로드
  const loadStats = useCallback(async () => {
    if (!user) return;
    setStatsLoading(true);
    try {
      const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
        Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

      const results = await Promise.allSettled([
        withTimeout(fetchDistanceByPeriod(user.id, 'monthly', year), 5000, []),
        withTimeout(fetchDistanceByPeriod(user.id, 'weekly', year), 5000, []),
        withTimeout(fetchPersonalBests(user.id), 5000, null),
        withTimeout(fetchDayOfWeekStats(user.id), 5000, []),
        withTimeout(fetchHourOfDayStats(user.id), 5000, []),
        withTimeout(fetchPaceTrend(user.id), 5000, []),
      ]);

      const val = <T,>(r: PromiseSettledResult<T>, fallback: T): T =>
        r.status === 'fulfilled' ? r.value : fallback;

      setMonthlyData(val(results[0], []));
      setWeeklyData(val(results[1], []));
      setPersonalBests(val(results[2], null));
      setDayStats(val(results[3], []));
      setHourStats(val(results[4], []));
      setPaceTrend(val(results[5], []));
    } catch (err) {
      console.warn('[Home] 통계 로드 실패:', err);
    } finally {
      setStatsLoading(false);
    }
  }, [user, year]);

  useEffect(() => { loadStats(); }, [loadStats]);

  // 상세 차트 데이터 로드 — 8초 안에 응답 없으면 빈 배열 fallback (무한 로딩 방지)
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
      console.warn('[dashboard] loadDetail 실패', e);
      setDetailData([]);
    } finally {
      setDetailLoading(false);
    }
  }, [user, periodMode, detailYear]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  // ========== 요약 계산 ==========
  const todayActivities = useMemo(
    () => activities.filter(a => a.activity_date === todayStr),
    [activities, todayStr]
  );
  const todaySummary = useMemo(() => {
    const km = todayActivities.reduce((s, a) => s + Number(a.distance_km), 0);
    const dur = todayActivities.reduce((s, a) => s + (a.duration_seconds || 0), 0);
    return {
      km,
      duration: dur,
      paceSec: km > 0 && dur > 0 ? dur / km : null,
    };
  }, [todayActivities]);
  const todayKm = todaySummary.km;
  const todayPaceSec = todaySummary.paceSec;

  // 오늘 안 뛰면 가장 최근 러닝의 페이스 폴백
  const recentPace = useMemo(() => {
    if (todayPaceSec !== null) return null;
    const withPace = activities.find(a => a.pace_avg_sec_per_km && a.pace_avg_sec_per_km > 0);
    if (!withPace) return null;
    return {
      pace: withPace.pace_avg_sec_per_km as number,
      date: withPace.activity_date,
    };
  }, [todayPaceSec, activities]);

  const monthlyDistance = useMemo(() => getMonthlyDistance(activities, year, month), [activities, year, month]);
  const monthlyRunDays = useMemo(() => {
    const daySet = new Set(
      activities
        .filter(a => {
          const d = new Date(a.activity_date);
          return d.getFullYear() === year && d.getMonth() + 1 === month;
        })
        .map(a => a.activity_date)
    );
    return daySet.size;
  }, [activities, year, month]);

  // 목표 — useMemo 로 묶어 매 렌더 재계산 막기
  const goalState = useMemo(() => {
    const currentGoal = goals.find(g => g.year === year && g.month === month);
    const goalKm = currentGoal?.goal_km || 0;
    const goalProgress = goalKm > 0 ? Math.min((monthlyDistance / goalKm) * 100, 100) : 0;
    const daysInMonth = new Date(year, month, 0).getDate();
    const daysRemaining = daysInMonth - now.getDate();
    const goalRemaining = goalKm > 0 ? Math.max(goalKm - monthlyDistance, 0) : 0;
    const dailyNeeded = daysRemaining > 0 && goalRemaining > 0 ? goalRemaining / daysRemaining : 0;
    return { goalKm, goalProgress, daysInMonth, goalRemaining, dailyNeeded };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goals, year, month, monthlyDistance]);
  const { goalKm, goalProgress, goalRemaining, dailyNeeded } = goalState;

  // 미니 캘린더
  const calendarActivities = useMemo(() =>
    activities.filter(a => {
      const d = new Date(a.activity_date);
      return d.getFullYear() === year && d.getMonth() + 1 === month;
    }),
    [activities, year, month]
  );

  // 통산 & 스트릭 — getStreak / getMaxStreak 가 activities 전체를 순회하므로 useMemo 필수
  const totalKm = Number(profile?.total_distance_km ?? 0);
  const totalRuns = profile?.total_runs ?? 0;
  const streakState = useMemo(() => {
    const streak = getStreak(activities);
    const maxStreak = getMaxStreak(activities);
    return {
      streak,
      maxStreak,
      isRecordBreaking: streak > 0 && streak === maxStreak,
      daysToRecord: streak > 0 && streak < maxStreak ? maxStreak - streak : 0,
    };
  }, [activities]);
  const { streak, maxStreak, isRecordBreaking, daysToRecord } = streakState;

  // 월별 (전년 대비 YTD: 같은 월까지만 비교해야 "전년 대비 -676km" 같은 오해가 없음)
  const ytdMonth = new Date().getMonth(); // 0-11
  const yearlyTotal = monthlyData.slice(0, ytdMonth + 1).reduce((s, d) => s + d.distance, 0);
  const yearlyPrevTotal = monthlyData.slice(0, ytdMonth + 1).reduce((s, d) => s + (d.prevDistance || 0), 0);

  // 전년 동기간 비교 (build 63 신규) — 이번 주 / 이번 달 / 분기 / 반기 카드용
  const yoyComparison = useMemo(() => {
    const now = new Date();
    const yearMs = 365 * 24 * 60 * 60 * 1000;
    const dayMs = 24 * 60 * 60 * 1000;

    // 이번 주 (월요일~오늘) vs 작년 동기간
    const startOfThisWeek = new Date(now);
    const dow = (now.getDay() + 6) % 7; // 월=0
    startOfThisWeek.setHours(0, 0, 0, 0);
    startOfThisWeek.setDate(now.getDate() - dow);
    const startOfLastWeek = new Date(startOfThisWeek.getTime() - yearMs);
    const endOfLastWeekRange = new Date(now.getTime() - yearMs);

    // 이번 달 1일 ~ 오늘 vs 작년 같은 기간
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastYearMonth = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    const endOfLastYearMonthRange = new Date(now.getTime() - yearMs);

    // 이번 분기 (현재 분기 시작) ~ 오늘 vs 작년 같은 기간
    const q = Math.floor(now.getMonth() / 3);
    const startOfThisQ = new Date(now.getFullYear(), q * 3, 1);
    const startOfLastYearQ = new Date(now.getFullYear() - 1, q * 3, 1);

    // 이번 반기 (1~6 또는 7~12) ~ 오늘 vs 작년
    const h = now.getMonth() < 6 ? 0 : 1;
    const startOfThisH = new Date(now.getFullYear(), h * 6, 1);
    const startOfLastYearH = new Date(now.getFullYear() - 1, h * 6, 1);

    let weekThis = 0, weekLast = 0;
    let monthThis = 0, monthLast = 0;
    let qThis = 0, qLast = 0;
    let hThis = 0, hLast = 0;

    activities.forEach(a => {
      const t = new Date(a.activity_date).getTime();
      const km = a.distance_km;
      if (t >= startOfThisWeek.getTime()) weekThis += km;
      else if (t >= startOfLastWeek.getTime() && t <= endOfLastWeekRange.getTime() + dayMs) weekLast += km;
      if (t >= startOfThisMonth.getTime()) monthThis += km;
      else if (t >= startOfLastYearMonth.getTime() && t <= endOfLastYearMonthRange.getTime() + dayMs) monthLast += km;
      if (t >= startOfThisQ.getTime()) qThis += km;
      else if (t >= startOfLastYearQ.getTime() && t <= endOfLastYearMonthRange.getTime() + dayMs) qLast += km;
      if (t >= startOfThisH.getTime()) hThis += km;
      else if (t >= startOfLastYearH.getTime() && t <= endOfLastYearMonthRange.getTime() + dayMs) hLast += km;
    });

    return {
      week: { now: weekThis, last: weekLast, diff: weekThis - weekLast },
      month: { now: monthThis, last: monthLast, diff: monthThis - monthLast },
      quarter: { now: qThis, last: qLast, diff: qThis - qLast },
      half: { now: hThis, last: hLast, diff: hThis - hLast },
    };
  }, [activities]);

  // 일별 거리 (최근 30일) — 월별 차트 대신 홈 첫 차트로 사용
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

  // 요일/시간대
  const hourGroups = [
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

  // 상세 차트 계산.
  // 비교 룰 (build 67 fix): 분기/반기/월간일 때 "현 시점까지의 동기간" 만 합산해야 의미 있는 비교.
  // ex) 2026 분기 = Q1+Q2 (현재 분기까지) vs 2025 Q1+Q2.
  // 사용자 신고 build 64 의 "전년 대비 -467km(-35%)" 는 2026 Q1+Q2 vs 2025 전체 (Q1~Q4) 였던 게 원인.
  const ytdSliceCount = (() => {
    const isCurrentYear = detailYear === new Date().getFullYear();
    if (!isCurrentYear) return detailData.length; // 과거 연도는 1년 전체로 비교
    const m = new Date().getMonth(); // 0-11
    if (periodMode === 'monthly') return m + 1;
    if (periodMode === 'quarterly') return Math.floor(m / 3) + 1;
    if (periodMode === 'half') return m < 6 ? 1 : 2;
    if (periodMode === 'weekly') return detailData.length; // weekly 는 이미 최근 12주만
    if (periodMode === 'yearly') return detailData.length; // yearly 는 항목별 자체 prev
    return detailData.length;
  })();
  const detailSliced = periodMode === 'yearly'
    ? detailData.slice(detailData.length - 1) // 연간 → 선택 연도 한 해만 (비교는 prevDistance 가 자체로 포함)
    : detailData.slice(0, ytdSliceCount);
  const detailTotal = (periodMode === 'yearly')
    ? (detailData[detailData.length - 1]?.distance ?? 0)
    : detailSliced.reduce((s, d) => s + d.distance, 0);
  const detailPrevTotal = (periodMode === 'yearly')
    ? (detailData[detailData.length - 1]?.prevDistance ?? 0)
    : detailSliced.reduce((s, d) => s + (d.prevDistance || 0), 0);
  const hasDetailPrev = detailSliced.some((d) => d.prevDistance !== undefined && d.prevDistance > 0)
    || (periodMode === 'yearly' && (detailData[detailData.length - 1]?.prevDistance ?? 0) > 0);

  // 주간/월간/연간/누적 요약
  const weekActivities = getWeeklyActivities(activities);
  const weekKm = weekActivities.reduce((s, a) => s + Number(a.distance_km), 0);
  const weekRuns = weekActivities.length;

  const recentActivities = activities.slice(0, 5);

  const [syncToast, setSyncToast] = useState<string | null>(null);

  // PullToRefresh = 사용자가 "최신 데이터 보고 싶다" 의 명시적 lever.
  // (1) Apple Health sync 트리거 (네이티브 앱에서만, 30s race 가드)
  // (2) DB 캐시 새로고침 — sync 가 새 row 를 넣었다면 즉시 반영, 안 넣었어도 최소 stale 한 거 갱신
  // (3) 결과 toast — "어제 기록 안 들어와요" 신고 진단 가능하게
  // (4) 마일리지 적립 토스트 (사용자 피드백 #12) — sync 후 잔액 증가분 친근하게 알림
  const handleRefresh = useCallback(async () => {
    let toast = '';
    // 적립 비교용 — sync 직전 잔액 스냅샷.
    // React state (profile.mileage_balance) 는 stale 가능 → DB 직접 read 로 정확한 base.
    let balanceBefore = 0;
    if (user) {
      try {
        const { fetchMileageBalance } = await import('@/lib/mileage-data');
        balanceBefore = await fetchMileageBalance(user.id);
      } catch {}
    }
    if (user && isNativeApp()) {
      // Pull-to-refresh = 사용자의 명시적 동기화 의도. lastSync 즉시 갱신 (낙관적).
      // HealthConnectCard 가 CustomEvent 를 listen 해서 라벨 즉시 reflow.
      const optimisticTs = Date.now();
      window.localStorage.setItem('last_health_sync', new Date(optimisticTs).toISOString());
      window.localStorage.setItem(`first_sync_done:${user.id}`, String(optimisticTs));
      window.dispatchEvent(new CustomEvent('routinist:lastSync', { detail: { ts: optimisticTs } }));
      try {
        const r = await Promise.race([
          syncHealthData(user.id),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('pull-refresh sync 30s timeout')), 30000)
          ),
        ]);
        if (r.success) {
          toast = r.synced > 0
            ? `러닝 ${r.synced}건 새로 도착! 🎉`
            : r.meta?.totalFromHealth
              ? `이미 최신이에요! ${r.meta.totalFromHealth}건 챙겨놨어요 ✨`
              : '아직 새로운 기록은 없어요. 한 바퀴 돌아볼까요? 👟';
        } else {
          toast = `동기화 중에 문제가 생겼어요\n${r.message}`;
        }
      } catch (e) {
        toast = `동기화 중에 문제가 생겼어요\n${e instanceof Error ? e.message : '알 수 없음'}`;
      }
    }
    // 신문 모델 (build 58): hero 캐시도 같이 invalidate. UserDataProvider.refresh 만으론 hero 갱신 안 됨.
    // dataCache.invalidate('') 가 빈 prefix 발사 = 모든 listener 가 fresh fetch.
    if (user) {
      const { dataCache } = await import('@/lib/data-cache');
      dataCache.invalidate(`hero:rank:${user.id}`);
      dataCache.invalidate(`hero:neighbors:${user.id}`);
      // localtop 은 region key 라 별도 invalidate
      dataCache.invalidate('home:localtop:');
    }
    await Promise.all([loadStats(), refresh()]);

    // 마일리지 적립 비교 — sync 직전 base 와 sync 후 잔액 모두 DB 직접 read.
    if (user) {
      try {
        const { fetchMileageBalance } = await import('@/lib/mileage-data');
        const balanceAfter = await fetchMileageBalance(user.id);
        const earned = balanceAfter - balanceBefore;
        if (earned > 0) {
          toast = `🎉 ${earned}P 적립! (잔액 ${balanceAfter.toLocaleString()}P)`;
        }
      } catch {}
    }

    if (toast) {
      setSyncToast(toast);
      setTimeout(() => setSyncToast(null), 4000);
    }
  }, [user, loadStats, refresh]);

  if (showOnboarding) {
    return <Onboarding onComplete={() => { setShowOnboarding(false); localStorage.setItem('onboarding_done', '1'); }} />;
  }

  return (
    <PullToRefresh onRefresh={handleRefresh}>
    <div className="max-w-lg mx-auto pb-8 bg-[var(--background)] min-h-screen">
    {/* Sticky Header — 다른 탭과 동일한 [로고 + 타이틀] 좌측 정렬 패턴 */}
    <header className="sticky top-0 z-20 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AppLogo size={28} />
          <h1 className="text-xl font-extrabold tracking-tight">홈</h1>
        </div>
        <Link href="/history" className="text-xs font-bold text-emerald-600 inline-flex items-center gap-0.5 active:scale-95 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30">
          히스토리 <ChevronRight size={12} />
        </Link>
      </div>
    </header>
      {syncToast && (
        <AppToast text={syncToast} tone={syncToast.startsWith('동기화 실패') ? 'warn' : 'ok'} position="top" onClose={() => setSyncToast(null)} durationMs={4000} />
      )}
      {/* 홈 hero 영역 — 카드 간 여백 + 일관 spacing 으로 어수선함 해소 (사용자 피드백 #2).
          이전: 각 컴포넌트 자체 margin 만 의존 → stacking 답답함.
          현재: space-y-2 wrapper + 좌우 padding 통일. */}
      <div className="space-y-2 pt-1">
        {/* HealthKit 연동 카드 — App Store 가이드 2.5.1 (HealthKit UI 명확성) 위해 홈 최상단 (build 62) */}
        <HealthConnectCard />
        {/* 동기부여 카드 — 조건부 (피드백 #14 새 아이디어) */}
        <WeeklyRecapCard activities={activities} />
        <StreakWarningCard activities={activities} streak={getStreak(activities)} />
        {/* ========== 홈 히어로 (경쟁·소셜 중심) ========== */}
        {/* above-the-fold: 즉시 마운트. PullToRefresh 가 sync 트리거 역할. */}
        <HomeRankingHero />
        <LiveRunningIndicator />
      </div>

      {/* below-the-fold: 뷰포트 진입 시 마운트 — 첫 렌더 부담 분산 */}
      <LazyMount minHeight={120} rootMargin="300px"><RankNeighbors /></LazyMount>
      <LazyMount minHeight={200} rootMargin="300px"><WinnerPredictionWidget /></LazyMount>
      <LazyMount minHeight={140} rootMargin="300px"><OnThisDayCard /></LazyMount>
      <LazyMount minHeight={160} rootMargin="300px"><TodayLocalTop /></LazyMount>
      <LazyMount minHeight={180} rootMargin="300px"><FriendsLeaderboard /></LazyMount>

      <div className="p-4 space-y-4">
      {/* ========== 헤더 ==========
          히스토리 링크는 상단 sticky header 의 칩에만 표시 (중복 제거 — 사용자 피드백). */}
      <div className="flex items-center justify-between pt-2">
        <div>
          <h2 className="text-xl font-bold text-[var(--foreground)]">
            {profile?.display_name ?? '러너'}님의 {month}월
          </h2>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xs text-[var(--muted)]">통산 {totalKm.toFixed(0)}km · {totalRuns}회 러닝</p>
            <FreshnessBadge ts={lastUpdated} onRefresh={refresh} />
          </div>
        </div>
      </div>

      {/* 지역 미설정 배너 — region_gu (한국) 또는 country_code (해외) 둘 다 없을 때만. */}
      {profile && !profile.region_gu && !profile.country_code && (
        <Link href="/profile/edit" className="block card p-3 bg-gradient-to-r from-blue-50 to-green-50 dark:from-blue-950/30 dark:to-green-950/30 border-0">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📍</span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-[var(--foreground)]">지역을 설정하면 랭킹에 참여할 수 있어요!</p>
              <p className="text-xs text-[var(--muted)]">프로필에서 시/구/동을 선택해보세요</p>
            </div>
            <ChevronRight size={16} className="text-[var(--accent)]" />
          </div>
        </Link>
      )}

      {/* ========== ① 오늘/이달 4칩 요약 ========== */}
      <div className="card p-5">
        <div className="grid grid-cols-4 gap-3 text-center">
          <div>
            <p className="text-2xl font-extrabold text-[var(--accent)]">{todayKm.toFixed(1)}</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">오늘 km</p>
          </div>
          <div>
            <p className="text-2xl font-extrabold text-[var(--foreground)]">
              {todayPaceSec
                ? formatPace(todayPaceSec)
                : recentPace
                  ? formatPace(recentPace.pace)
                  : '-'}
            </p>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              {todayPaceSec ? '오늘 페이스' : recentPace ? '최근 페이스' : '오늘 페이스'}
            </p>
          </div>
          <div>
            <p className="text-2xl font-extrabold text-green-600">{monthlyDistance.toFixed(1)}</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">이달 km</p>
          </div>
          <div>
            <p className="text-2xl font-extrabold text-lime-600 dark:text-lime-500">{monthlyRunDays}</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">이달 일수</p>
          </div>
        </div>
      </div>

      {/* ========== ② 이달 목표 ========== */}
      <div className={`card p-5 relative overflow-hidden ${goalKm > 0 && goalProgress >= 100 ? 'goal-achieved' : ''}`}>
        {/* 달성 시 shimmer 배경 */}
        {goalKm > 0 && goalProgress >= 100 && (
          <div className="absolute inset-0 achievement-shimmer pointer-events-none" />
        )}
        <div className="relative">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-[var(--foreground)]">내 {month}월 목표</h3>
            <Link href="/goals" className="text-sm text-[var(--accent)] font-semibold flex items-center gap-0.5">
              설정 <ChevronRight size={14} />
            </Link>
          </div>
          {goalKm > 0 ? (
            <>
              {/* 큰 숫자 제거 — 4칩의 '이달 km'과 중복. 진행률에 집중 */}
              <div className="bg-[var(--card-border)] rounded-full h-5 overflow-hidden relative mb-2">
                <div
                  className={`h-full rounded-full transition-all duration-1000 ease-out relative ${
                    goalProgress >= 100
                      ? 'bg-gradient-to-r from-green-400 to-green-500'
                      : 'bg-gradient-to-r from-[var(--accent)] to-blue-400'
                  }`}
                  style={{ width: `${goalProgress}%` }}
                >
                  {goalProgress > 10 && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-base font-bold text-white">
                      {goalProgress.toFixed(0)}%
                    </span>
                  )}
                </div>
                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                  <Flag size={10} className={goalProgress >= 100 ? 'text-green-500' : 'text-[var(--muted)]'} />
                </div>
              </div>
              {goalProgress >= 100 ? (
                <div className="mt-2 flex items-center justify-center gap-1 text-green-600 font-bold">
                  <span className="confetti-emoji">🎉</span>
                  <span className="confetti-emoji">🏆</span>
                  <span className="mx-2 text-base">{goalKm}km 목표 달성!</span>
                  <span className="confetti-emoji">✨</span>
                  <span className="confetti-emoji">🎊</span>
                </div>
              ) : (
                <div className="flex justify-between items-center text-xs text-[var(--muted)]">
                  <span>/ <span className="font-semibold text-[var(--foreground)]">{goalKm}km</span> 목표</span>
                  <span>남은 {goalRemaining.toFixed(1)}km · 하루 {dailyNeeded.toFixed(1)}km</span>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-4 space-y-2">
              <p className="text-3xl">🎯</p>
              <p className="text-sm font-medium text-[var(--foreground)]">아직 이번 달 목표가 없습니다</p>
              <Link href="/goals" className="text-sm text-[var(--accent)] font-semibold inline-block">
                목표 설정하기 →
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* ========== ③ 월 캘린더 — inline 풀 콘텐츠 (build 68). 페이지 이동 없음 ========== */}
      <HomeCalendarCard />

      {/* ========== ④ 일별 거리 추이 (최근 30일) ========== */}
      <LazyMount minHeight={260}>
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-[var(--foreground)]">일별 거리 추이</h3>
          <span className="text-xs text-[var(--muted)]">최근 30일 · 총 {daily30Total.toFixed(1)}km</span>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={dailyData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="homeDailyGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#34D399" />
                <stop offset="100%" stopColor="#10B981" />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray={chartStyle.gridDash} stroke="var(--card-border)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: 'var(--muted)' }}
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
            <Bar dataKey="distance" fill="url(#homeDailyGrad)" radius={chartStyle.barRadius} animationDuration={chartStyle.animationDuration} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      </LazyMount>

      {/* ========== ⑤ 주간 거리 트렌드 ========== */}
      {weeklyData.length > 0 && (
        <LazyMount minHeight={240}>
        <div className="card p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-base font-bold text-[var(--foreground)]">최근 12주 러닝</h3>
            {(() => {
              // 전년 동기 비교 — activities 에서 직접 계산
              const nowMs = Date.now();
              const _12wMs = 12 * 7 * 24 * 60 * 60 * 1000;
              const yearMs = 365 * 24 * 60 * 60 * 1000;
              let thisSum = 0, lastSum = 0;
              activities.forEach(a => {
                const t = new Date(a.activity_date).getTime();
                if (t >= nowMs - _12wMs) thisSum += a.distance_km;
                else if (t >= nowMs - yearMs - _12wMs && t < nowMs - yearMs) lastSum += a.distance_km;
              });
              // 전년 데이터 없어도 표시 (사용자 신고 #10): "전년 동기 첫 기록"
              const diff = thisSum - lastSum;
              if (lastSum < 0.5 && thisSum < 0.5) return null; // 둘 다 0 이면 무의미
              if (lastSum < 0.5) {
                return <span className="text-xs font-semibold text-emerald-600">전년 동기 첫 기록 🎉</span>;
              }
              const sign = diff >= 0 ? '+' : '';
              const color = diff >= 0 ? 'text-emerald-600' : 'text-rose-500';
              return (
                <span className={`text-xs font-semibold ${color}`}>
                  전년 동기 {sign}{diff.toFixed(0)}km
                </span>
              );
            })()}
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={weeklyData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="homeWeeklyGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#A78BFA" />
                  <stop offset="100%" stopColor="#8B5CF6" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray={chartStyle.gridDash} stroke="var(--card-border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'var(--card)', border: '1px solid var(--card-border)', borderRadius: 14, fontSize: 12 }}
                formatter={(value) => [`${value}km`]}
                cursor={{ fill: 'var(--card-border)', opacity: 0.3 }}
              />
              <Bar dataKey="distance" fill="url(#homeWeeklyGrad)" radius={chartStyle.barRadius} animationDuration={chartStyle.animationDuration} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        </LazyMount>
      )}

      {/* ========== ⑥ 페이스 추이 ========== */}
      {paceTrend.some(p => p.avgPace !== null) && (
        <LazyMount minHeight={260}>
        <div className="card p-5">
          <h3 className="text-base font-bold text-[var(--foreground)] mb-3">페이스 추이 (최근 12개월)</h3>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={paceTrend.filter(p => p.avgPace !== null)} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="homePaceGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10B981" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#10B981" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray={chartStyle.gridDash} stroke="var(--card-border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--muted)' }}
                reversed
                domain={['dataMin - 20', 'dataMax + 20']}
                tickFormatter={(v: number) => `${Math.floor(v / 60)}'${String(Math.round(v % 60)).padStart(2, '0')}"`}
                axisLine={false} tickLine={false}
              />
              <Tooltip
                contentStyle={{ background: 'var(--card)', border: '1px solid var(--card-border)', borderRadius: 14, fontSize: 12 }}
                formatter={(value) => [formatPace(Number(value)), '평균 페이스']}
              />
              <Area type="monotone" dataKey="avgPace" stroke="#10B981" strokeWidth={2.5} fill="url(#homePaceGrad)" dot={{ r: 4, fill: '#10B981' }} animationDuration={chartStyle.animationDuration} />
            </AreaChart>
          </ResponsiveContainer>
          <p className="text-xs text-[var(--muted)] mt-2 text-center">아래로 갈수록 빠른 페이스</p>
        </div>
        </LazyMount>
      )}

      {/* ========== ⑦ 개인 베스트 — 누적/올해 탭 ========== */}
      {personalBests && (() => {
        // 올해 PB 는 useUserData 의 activities 에서 클라 사이드 필터링.
        // (별도 RPC 추가 안 하고 이미 가진 데이터 재활용 — fetchPersonalBests 와 동일 로직).
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
              <h3 className="text-base font-semibold text-[var(--foreground)]">개인 베스트</h3>
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
                누적
              </button>
            </div>
          </div>
          {pbScope === 'year' && !yearHasData ? (
            <p className="text-sm text-[var(--muted)] text-center py-6">{year}년 기록이 아직 없어요</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {pb.longestRun && (
                <div className="bg-[var(--card-border)]/30 rounded-xl p-3">
                  <p className="text-xs text-[var(--muted)] mb-1">최장 거리</p>
                  <p className="text-2xl font-extrabold text-[var(--foreground)]">{pb.longestRun.distance_km.toFixed(2)}km</p>
                  <p className="text-xs text-[var(--muted)]">{pb.longestRun.date}</p>
                </div>
              )}
              {pb.fastestPace && (
                <div className="bg-[var(--card-border)]/30 rounded-xl p-3">
                  <p className="text-xs text-[var(--muted)] mb-1">최빠 페이스</p>
                  <p className="text-2xl font-extrabold text-[var(--foreground)]">{formatPace(pb.fastestPace.pace)}/km</p>
                  <p className="text-xs text-[var(--muted)]">{pb.fastestPace.date} ({pb.fastestPace.distance_km.toFixed(1)}km)</p>
                </div>
              )}
              {pb.longestDuration && (
                <div className="bg-[var(--card-border)]/30 rounded-xl p-3">
                  <p className="text-xs text-[var(--muted)] mb-1">최장 시간</p>
                  <p className="text-2xl font-extrabold text-[var(--foreground)]">{formatDuration(pb.longestDuration.duration)}</p>
                  <p className="text-xs text-[var(--muted)]">{pb.longestDuration.date}</p>
                </div>
              )}
              {pb.mostCalories && pb.mostCalories.calories > 0 && (
                <div className="bg-[var(--card-border)]/30 rounded-xl p-3">
                  <p className="text-xs text-[var(--muted)] mb-1">최다 칼로리</p>
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

      {/* ========== ⑧ 요일별 패턴 ========== */}
      {dayStats.length > 0 && dayStats.some(d => d.runCount > 0) && (
        <LazyMount minHeight={360}>
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Calendar size={16} className="text-blue-500" />
            <h3 className="text-base font-semibold text-[var(--foreground)]">요일별 러닝 패턴</h3>
          </div>
          <p className="text-xs text-[var(--muted)] mb-3">
            주로 <span className="font-semibold text-[var(--accent)]">{maxDay.day}요일</span>에 달려요 ({maxDay.runCount}회)
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <RadarChart data={dayStats}>
              <PolarGrid stroke="var(--card-border)" strokeDasharray={chartStyle.gridDash} />
              <PolarAngleAxis dataKey="day" tick={{ fontSize: 13, fill: 'var(--muted)', fontWeight: 600 }} />
              <Radar name="러닝 횟수" dataKey="runCount" stroke="#3B82F6" fill="#3B82F6" fillOpacity={0.2} strokeWidth={2.5} dot={{ r: 4, fill: '#3B82F6' }} animationDuration={chartStyle.animationDuration} />
            </RadarChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-7 gap-1 mt-3 text-center">
            {dayStats.map(d => (
              <div key={d.day}>
                <p className="text-xs text-[var(--muted)]">{d.day}</p>
                <p className="text-base font-bold text-[var(--foreground)]">{d.runCount}</p>
                <p className="text-xs text-[var(--muted)]">{d.avgDistance}km</p>
              </div>
            ))}
          </div>
        </div>
        </LazyMount>
      )}

      {/* ========== ⑨ 시간대별 분포 ========== */}
      {hourStats.some(h => h.runCount > 0) && (
        <LazyMount minHeight={220}>
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={16} className="text-orange-500" />
            <h3 className="text-base font-semibold text-[var(--foreground)]">시간대별 러닝 분포</h3>
          </div>
          <p className="text-xs text-[var(--muted)] mb-3">
            주로 <span className="font-semibold text-[var(--accent)]">{maxHourGroup.label}</span>에 달려요
          </p>
          <div className="space-y-2">
            {hourGroups.map((g, i) => {
              const maxCount = Math.max(...hourGroups.map(g => g.count), 1);
              const barWidth = (g.count / maxCount) * 100;
              const colors = ['#6366F1', '#F59E0B', '#EF4444', '#8B5CF6'];
              return (
                <div key={g.label} className="flex items-center gap-2">
                  <span className="w-24 text-sm text-[var(--foreground)] flex-shrink-0">{g.label}</span>
                  <div className="flex-1 h-5 bg-[var(--card-border)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(barWidth, 2)}%`, backgroundColor: colors[i] }}
                    />
                  </div>
                  <span className="text-sm font-semibold text-[var(--foreground)] w-8 text-right">{g.count}회</span>
                </div>
              );
            })}
          </div>
        </div>
        </LazyMount>
      )}

      {/* ========== ⑩ 연속 달리기 스트릭 (Wordle 스타일 Current/Max) ========== */}
      <LazyMount minHeight={160}>
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Flame size={16} className="text-orange-500" />
          <h3 className="text-base font-semibold text-[var(--foreground)]">연속 달리기 스트릭</h3>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-3xl font-extrabold text-orange-500">{streak}</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">현재 연속일</p>
          </div>
          <div className="border-x border-[var(--card-border)]">
            <p className="text-3xl font-extrabold text-purple-500">{maxStreak}</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">최장 연속일</p>
          </div>
          <div>
            <p className="text-3xl font-extrabold text-[var(--foreground)]">{totalRuns}</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">총 러닝</p>
          </div>
        </div>

        {/* 동기부여 문구 */}
        {isRecordBreaking && maxStreak >= 2 && (
          <p className="text-center text-xs font-bold text-orange-500 mt-3 achievement-shimmer rounded-lg py-1.5">
            🔥 최장 기록 갱신 중!
          </p>
        )}
        {daysToRecord > 0 && daysToRecord <= 3 && (
          <p className="text-center text-xs font-semibold text-[var(--accent)] mt-3">
            역대 최장 기록까지 {daysToRecord}일!
          </p>
        )}
      </div>
      </LazyMount>

      {/* ========== ⑪ 상세 기간별 차트 ========== */}
      <LazyMount minHeight={420}>
      <div className="card p-5">
        <h3 className="text-base font-bold text-[var(--foreground)] mb-3">기간별 상세 통계</h3>

        <div className="flex items-center justify-center gap-4 mb-3">
          <button onClick={() => setDetailYear((y) => y - 1)} className="text-[var(--muted)] text-xl font-bold">&lt;</button>
          <span className="text-lg font-bold text-[var(--foreground)]">{detailYear}</span>
          <button onClick={() => setDetailYear((y) => y + 1)} className="text-[var(--muted)] text-xl font-bold">&gt;</button>
        </div>

        <div className="text-center mb-3">
          <p className="text-3xl font-extrabold text-[var(--accent)]">{detailTotal.toFixed(1)} km</p>
          {hasDetailPrev && detailPrevTotal > 0 && (() => {
            const diff = detailTotal - detailPrevTotal;
            const pct = ((detailTotal / detailPrevTotal - 1) * 100);
            const isUp = diff >= 0;
            const sign = isUp ? '+' : '';
            const color = isUp ? 'text-emerald-600' : 'text-rose-500';
            const periodLabel =
              periodMode === 'monthly' ? '전년 동기간' :
              periodMode === 'quarterly' ? '전년 동기간 (Q' + (Math.floor(new Date().getMonth() / 3) + 1) + '까지)' :
              periodMode === 'half' ? '전년 동기간 (현 반기까지)' :
              periodMode === 'weekly' ? '전년 동기 (12주)' :
              periodMode === 'yearly' ? `전년 동기간 (${new Date().getMonth() + 1}/${new Date().getDate()}까지)` :
              '전년';
            return (
              <p className={`text-sm mt-1 font-semibold ${color}`}>
                {periodLabel} {sign}{diff.toFixed(1)}km ({sign}{pct.toFixed(0)}%)
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
              {opt.label}
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
            <BarChart3 size={14} /> 막대
          </button>
          <button
            onClick={() => setChartType('line')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold ${
              chartType === 'line' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--card-border)]/50 text-[var(--muted)]'
            }`}
          >
            <TrendingUp size={14} /> 선
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
                  <linearGradient id="homeDetailGrad" x1="0" y1="0" x2="0" y2="1">
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
                  <Bar dataKey="prevDistance" name={`${detailYear - 1}년`} fill="#CBD5E1" radius={chartStyle.barRadius} animationDuration={chartStyle.animationDuration} />
                )}
                <Bar dataKey="distance" name={`${detailYear}년`} fill="url(#homeDetailGrad)" radius={chartStyle.barRadius} animationDuration={chartStyle.animationDuration} />
                {hasDetailPrev && <Legend wrapperStyle={{ fontSize: 13 }} />}
              </BarChart>
            ) : (
              <AreaChart data={detailData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="homeDetailAreaGrad" x1="0" y1="0" x2="0" y2="1">
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
                  <Area type="monotone" dataKey="prevDistance" name={`${detailYear - 1}년`} stroke="#94a3b8" strokeWidth={2} fill="none" dot={{ r: 3, fill: '#94a3b8' }} animationDuration={chartStyle.animationDuration} />
                )}
                <Area type="monotone" dataKey="distance" name={`${detailYear}년`} stroke="#3B82F6" strokeWidth={chartStyle.strokeWidth} fill="url(#homeDetailAreaGrad)" dot={{ r: chartStyle.dotRadius, fill: '#3B82F6' }} activeDot={{ r: chartStyle.activeDotRadius, strokeWidth: 2 }} animationDuration={chartStyle.animationDuration} />
                {hasDetailPrev && <Legend wrapperStyle={{ fontSize: 13 }} />}
              </AreaChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
      </LazyMount>

      {/* ========== ⑫ 주간/월간/연간/누적 요약 ========== */}
      <LazyMount minHeight={200}>
      <div className="card p-5">
        <h3 className="text-base font-bold text-[var(--foreground)] mb-4">요약</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[var(--card-border)]/30 rounded-xl p-4">
            <p className="text-xs text-[var(--muted)] mb-1">이번 주</p>
            <p className="text-2xl font-extrabold text-[var(--accent)]">{weekKm.toFixed(1)}<span className="text-sm ml-1">km</span></p>
            <p className="text-xs text-[var(--muted)] mt-1">{weekRuns}회 러닝</p>
            {yoyComparison.week.last > 0.5 && (
              <p className={`text-xs mt-1 ${yoyComparison.week.diff >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                전년 {yoyComparison.week.diff >= 0 ? '+' : ''}{yoyComparison.week.diff.toFixed(0)}km
              </p>
            )}
          </div>
          <div className="bg-[var(--card-border)]/30 rounded-xl p-4">
            <p className="text-xs text-[var(--muted)] mb-1">이번 달</p>
            <p className="text-2xl font-extrabold text-green-600">{monthlyDistance.toFixed(1)}<span className="text-sm ml-1">km</span></p>
            <p className="text-xs text-[var(--muted)] mt-1">{monthlyRunDays}일 · {calendarActivities.length}회</p>
            {yoyComparison.month.last > 0.5 && (
              <p className={`text-xs mt-1 ${yoyComparison.month.diff >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                전년 {yoyComparison.month.diff >= 0 ? '+' : ''}{yoyComparison.month.diff.toFixed(0)}km
              </p>
            )}
          </div>
          <div className="bg-[var(--card-border)]/30 rounded-xl p-4">
            <p className="text-xs text-[var(--muted)] mb-1">올해</p>
            <p className="text-2xl font-extrabold text-purple-600">{yearlyTotal.toFixed(0)}<span className="text-sm ml-1">km</span></p>
            {yearlyPrevTotal > 0 && (
              <p className={`text-xs mt-1 ${yearlyTotal >= yearlyPrevTotal ? 'text-emerald-600' : 'text-rose-500'}`}>
                전년 {yearlyTotal >= yearlyPrevTotal ? '+' : ''}{(yearlyTotal - yearlyPrevTotal).toFixed(0)}km
              </p>
            )}
          </div>
          <div className="bg-[var(--card-border)]/30 rounded-xl p-4">
            <p className="text-xs text-[var(--muted)] mb-1">누적</p>
            <p className="text-2xl font-extrabold text-orange-600">{totalKm.toFixed(0)}<span className="text-sm ml-1">km</span></p>
            <p className="text-xs text-[var(--muted)] mt-1">{totalRuns}회 러닝</p>
          </div>
        </div>
      </div>
      </LazyMount>

      {/* ========== ⑬ 최근 활동 ========== */}
      <LazyMount minHeight={300}>
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-[var(--foreground)]">최근 활동</h3>
          {activities.length > 0 && (
            <Link href="/history" className="text-sm text-[var(--accent)] font-semibold flex items-center gap-0.5">
              전체 기록 <ChevronRight size={14} />
            </Link>
          )}
        </div>
        {userDataLoading ? (
          <div className="flex justify-center py-6">
            <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
          </div>
        ) : recentActivities.length === 0 ? (
          <div className="text-center py-6 space-y-2">
            <p className="text-3xl">👟</p>
            <p className="text-sm font-medium text-[var(--foreground)]">아직 기록이 없습니다</p>
            <Link href="/connect" className="text-sm text-[var(--accent)] font-semibold inline-block">
              건강 앱 연동하기 →
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {recentActivities.map(a => (
              <Link
                key={a.id}
                href={`/activity?id=${a.id}`}
                className="flex items-center gap-3 p-3 rounded-xl hover:bg-[var(--card-border)]/50 transition-colors"
              >
                <div className="w-9 h-9 rounded-lg bg-[var(--accent)]/10 flex items-center justify-center text-[var(--accent)]">
                  {a.source === 'gps' ? <MapPin size={16} /> : <Zap size={16} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--foreground)]">
                    {a.distance_km.toFixed(2)} km
                    {a.duration_seconds && (
                      <span className="text-[var(--muted)] font-normal ml-2 text-sm">
                        {formatDuration(a.duration_seconds)}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {new Date(a.activity_date).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short' })}
                    {a.pace_avg_sec_per_km ? ` · ${formatPace(a.pace_avg_sec_per_km)}/km` : ''}
                  </p>
                </div>
                <ChevronRight size={14} className="text-[var(--muted)]" />
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* ⑬ 최근 활동 닫기 */}
      </LazyMount>

      {statsLoading && monthlyData.length === 0 && (
        <p className="text-center text-xs text-[var(--muted)]">통계 로딩 중...</p>
      )}
      </div>

      {/* ========== 하단 루틴포토 인기 캐러셀 (친구×1.5, 동네×1.3 가중치) ========== */}
      <LazyMount rootMargin="400px" minHeight={220}>
        <RoutinePhotoCarousel />
      </LazyMount>
    </div>
    </PullToRefresh>
  );
}
