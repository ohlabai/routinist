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
import Onboarding from '@/components/Onboarding';
import LazyMount from '@/components/LazyMount';
import { useI18n } from '@/lib/i18n';
import AppLogo from '@/components/AppLogo';
import HomeRankingHero from '@/components/home/HomeRankingHero';
import SeasonRecapCard from '@/components/home/SeasonRecapCard';
import StreakWarningCard from '@/components/home/StreakWarningCard';
import WeeklyRecapCard from '@/components/home/WeeklyRecapCard';
import HomeCalendarCard from '@/components/home/HomeCalendarCard';
import HealthConnectCard from '@/components/home/HealthConnectCard';
import { syncHealthData, isNativeApp } from '@/lib/health-sync';
import WinnerPredictionWidget from '@/components/home/WinnerPredictionWidget';
import TodayLocalTop from '@/components/home/TodayLocalTop';
// RoutinePhotoCarousel 제거 — 소셜 탭 포토 갤러리와 중복 (build 100)
import FriendsLeaderboard from '@/components/home/FriendsLeaderboard';
import OnThisDayCard from '@/components/home/OnThisDayCard';
import LiveRunningIndicator from '@/components/home/LiveRunningIndicator';
import RankNeighbors from '@/components/home/RankNeighbors';
import HomeMapPreview from '@/components/home/HomeMapPreview';
import HomeChallengeCard from '@/components/home/HomeChallengeCard';
import HomeWorldMarathonCard from '@/components/home/HomeWorldMarathonCard';
import CourseCompletionModal from '@/components/world/CourseCompletionModal';
import HomeOnboardingCard from '@/components/home/HomeOnboardingCard';
import PullDownOnboardingHint from '@/components/home/PullDownOnboardingHint';
import MonthEndRecapCard from '@/components/home/MonthEndRecapCard';
import RunOfTheDayCard from '@/components/home/RunOfTheDayCard';
import MonthlyRivalCard from '@/components/home/MonthlyRivalCard';
import HomeFriendStories from '@/components/home/HomeFriendStories';
import FreshnessBadge from '@/components/FreshnessBadge';
import AppToast from '@/components/AppToast';
import Link from 'next/link';
import {
  ChevronRight, Flag, MapPin, Zap, Trophy, Flame, Clock, Calendar,
  BarChart3, TrendingUp,
} from 'lucide-react';
import { chartStyle } from '@/lib/chart-theme';
import { toLocalDateStr } from '@/lib/kst';

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
  const { t, tt, locale } = useI18n();
  const { user, profile } = useAuth();
  const { activities, goals, loading: userDataLoading, refresh, lastUpdated } = useUserData();
  const [showOnboarding, setShowOnboarding] = useState(false);

  // 차트 데이터
  const [monthlyData, setMonthlyData] = useState<PeriodDistance[]>([]);
  const [weeklyData, setWeeklyData] = useState<PeriodDistance[]>([]);
  const [personalBests, setPersonalBests] = useState<PersonalBest | null>(null);
  const [pbScope, setPbScope] = useState<'all' | 'year'>('year');
  // build 152: 요일별/시간대별 — 2026/누적 토글. dayStats/hourStats 는 activities 에서 derive (useMemo 아래).
  const [dayScope, setDayScope] = useState<'all' | 'year'>('year');
  const [hourScope, setHourScope] = useState<'all' | 'year'>('year');
  const [paceTrend, setPaceTrend] = useState<PaceTrend[]>([]);
  // build 140: statsLoading 초기값을 false → 캐시 hit 시 첫 paint skeleton 회피.
  // 캐시 miss + force=true 시에만 true (effect 내부에서 setStatsLoading(true)).
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
  // build 207: month 라벨 — 영문 모드는 영문 월명, 한국어는 "5월"
  const MONTH_NAMES_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthLabel = locale === 'en' ? MONTH_NAMES_EN[month - 1] : `${month}월`;
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

  // build 155: 지역 자동 등록 알림 — health-sync 가 자동으로 채운 직후 1회 표시.
  const [regionAutoNotice, setRegionAutoNotice] = useState<{ display: string; country_code: string } | null>(null);
  useEffect(() => {
    if (!user) return;
    import('@/lib/profile-region-auto').then(m => {
      const n = m.consumeRegionAutoNotice();
      if (n) setRegionAutoNotice(n);
    }).catch(() => {});
  }, [user]);

  // build 140: 통계 6개 RPC bundle 을 dataCache 에 저장 → 다음 진입 시 즉시 paint.
  // UserDataProvider 와 동일한 신문 모델. 사용자 PullToRefresh 시에만 force fetch.
  // essential(메인 hero 3개) + optional(차트 3개) 차등 timeout — 느린 RPC 가 빠른 RPC 표시 안 막음.
  const statsCacheKey = useMemo(() => user ? `home:stats:${user.id}:${year}` : null, [user, year]);

  const loadStats = useCallback(async (opts?: { force?: boolean }) => {
    if (!user || !statsCacheKey) return;

    // 1. 캐시 우선 — 즉시 paint, fetch skip.
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

      // build 142: essential 더 좁힘 — monthly/weekly 2개 (timeout 2.5s) 만 hero 차트 필수.
      // build 152: dayStats/hourStats 는 activities 기반 useMemo 로 이동 → RPC 제거 (토글 시 즉시 derive).
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
      setStatsLoading(false);  // essential 도착 시점에 hero 영역 unlock

      const oRes = await optionalP;
      const pb = val(oRes[0], null as PersonalBest | null);
      const pace = val(oRes[1], [] as PaceTrend[]);
      setPersonalBests(pb);
      setPaceTrend(pace);

      dataCache.set(statsCacheKey, { monthly, weekly, pb, pace });
    } catch (err) {
      console.warn('[Home] 통계 로드 실패:', err);
      setStatsLoading(false);
    }
  }, [user, year, statsCacheKey]);

  useEffect(() => { loadStats(); }, [loadStats]);

  // 캐시 invalidate 이벤트 (PullToRefresh 등) → fresh fetch.
  useEffect(() => {
    if (!statsCacheKey) return;
    return onCacheInvalidated((prefix) => {
      if (statsCacheKey.startsWith(prefix) || prefix === '') {
        void loadStats({ force: true });
      }
    });
  }, [statsCacheKey, loadStats]);

  // 상세 차트 — 8초 안에 응답 없으면 빈 배열 fallback
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

  // Achievement 자동 체크 (build 129) — dashboard 진입 시 1회
  useEffect(() => {
    if (!user) return;
    import('@/lib/achievements-data').then(m => m.checkAndAwardAchievements()).catch(() => { /* silent */ });
  }, [user]);

  // build 259: 마일리지 잔액 — 홈 헤더 chip 표시.
  // /profile 의 fetchMileageBalance 와 동일 함수. 사용자가 앱 들어오자마자 잔액 보임 + 적립 동기 강화.
  const [mileageBalance, setMileageBalance] = useState<number | null>(null);
  useEffect(() => {
    if (!user) return;
    import('@/lib/mileage-data').then(m => m.fetchMileageBalance(user.id)).then(setMileageBalance).catch(() => {});
  }, [user]);

  // build 143: secondary 위젯 (챌린지·스토리·실시간) 300ms defer — 첫 paint 부담 감소.
  // hero 영역(랭킹·캘린더·미니맵) 은 즉시 mount.
  const [secondaryMounted, setSecondaryMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSecondaryMounted(true), 300);
    return () => clearTimeout(t);
  }, []);

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

  // build 156: profile.this_month_* 캐시 우선 (activities 도착 전 즉시 표시).
  //  - cache 의 updated_at month 가 현재 month 와 일치할 때만 사용 (stale 방어)
  //  - activities 도착 후엔 정확한 값으로 자동 overwrite
  const profileMonthCacheValid = (() => {
    const u = profile?.this_month_updated_at;
    if (!u) return false;
    const d = new Date(u);
    return d.getFullYear() === year && d.getMonth() + 1 === month;
  })();
  const monthlyDistance = useMemo(() => {
    if (activities.length === 0 && profileMonthCacheValid && profile?.this_month_distance_km !== undefined) {
      return Number(profile.this_month_distance_km);
    }
    return getMonthlyDistance(activities, year, month);
  }, [activities, year, month, profileMonthCacheValid, profile?.this_month_distance_km]);
  const monthlyRunDays = useMemo(() => {
    if (activities.length === 0 && profileMonthCacheValid && profile?.this_month_runs !== undefined) {
      return Number(profile.this_month_runs);
    }
    const daySet = new Set(
      activities
        .filter(a => {
          const d = new Date(a.activity_date);
          return d.getFullYear() === year && d.getMonth() + 1 === month;
        })
        .map(a => a.activity_date)
    );
    return daySet.size;
  }, [activities, year, month, profileMonthCacheValid, profile?.this_month_runs]);

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

  const calendarActivities = useMemo(() =>
    activities.filter(a => {
      const d = new Date(a.activity_date);
      return d.getFullYear() === year && d.getMonth() + 1 === month;
    }),
    [activities, year, month]
  );

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

  const ytdMonth = new Date().getMonth();
  const yearlyTotal = monthlyData.slice(0, ytdMonth + 1).reduce((s, d) => s + d.distance, 0);
  const yearlyPrevTotal = monthlyData.slice(0, ytdMonth + 1).reduce((s, d) => s + (d.prevDistance || 0), 0);

  const yoyComparison = useMemo(() => {
    const now = new Date();
    const yearMs = 365 * 24 * 60 * 60 * 1000;
    const dayMs = 24 * 60 * 60 * 1000;

    const startOfThisWeek = new Date(now);
    const dow = (now.getDay() + 6) % 7;
    startOfThisWeek.setHours(0, 0, 0, 0);
    startOfThisWeek.setDate(now.getDate() - dow);
    const startOfLastWeek = new Date(startOfThisWeek.getTime() - yearMs);
    const endOfLastWeekRange = new Date(now.getTime() - yearMs);

    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastYearMonth = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    const endOfLastYearMonthRange = new Date(now.getTime() - yearMs);

    const q = Math.floor(now.getMonth() / 3);
    const startOfThisQ = new Date(now.getFullYear(), q * 3, 1);
    const startOfLastYearQ = new Date(now.getFullYear() - 1, q * 3, 1);

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

  // build 152: dayStats/hourStats 를 activities 기반 useMemo 로 derive — 토글 변경 시 즉시 갱신.
  // 이전엔 fetchDayOfWeekStats RPC 호출 + 1000건 제한이라 누적 정확도 떨어짐.
  const dayStats = useMemo<DayOfWeekStat[]>(() => {
    const days = locale === 'en'
      ? ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
      : ['일','월','화','수','목','금','토'];
    const stats: DayOfWeekStat[] = days.map((day, i) => ({ day, dayIndex: i, runCount: 0, totalDistance: 0, avgDistance: 0 }));
    const filtered = dayScope === 'year'
      ? activities.filter(a => new Date(a.activity_date).getFullYear() === year)
      : activities;
    filtered.forEach(a => {
      const di = new Date(a.activity_date).getDay();
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

  // 비교 룰 (build 67 fix): 분기/반기/월간 — "현 시점까지의 동기간" 만 합산
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
  // build 152: 큰 숫자 표시는 "현재 기간만" — 주간이면 이번 주, 월간이면 이번 달, 분기/반기/연간도 동일.
  // 이전엔 월간일 때 1월~현재월 누적(=연간) 이 표시되어 사용자 혼란.
  const detailLast = detailSliced.length > 0 ? detailSliced[detailSliced.length - 1] : null;
  const detailTotal = detailLast?.distance ?? 0;
  const detailPrevTotal = detailLast?.prevDistance ?? 0;
  const hasDetailPrev = (detailLast?.prevDistance ?? 0) > 0;

  const weekActivities = getWeeklyActivities(activities);
  const weekKm = weekActivities.reduce((s, a) => s + Number(a.distance_km), 0);
  const weekRuns = weekActivities.length;

  const recentActivities = activities.slice(0, 5);

  const [syncToast, setSyncToast] = useState<string | null>(null);

  const handleRefresh = useCallback(async () => {
    let toast = '';
    let balanceBefore = 0;
    if (user) {
      try {
        const { fetchMileageBalance } = await import('@/lib/mileage-data');
        balanceBefore = await fetchMileageBalance(user.id);
      } catch {}
    }
    if (user && isNativeApp()) {
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
    if (user) {
      const { dataCache } = await import('@/lib/data-cache');
      dataCache.invalidate(`hero:rank:${user.id}`);
      dataCache.invalidate(`hero:neighbors:${user.id}`);
      dataCache.invalidate('home:localtop:');
      // build 140: 통계 6개 RPC bundle 도 같이 invalidate (PullToRefresh 시 fresh fetch).
      dataCache.invalidate(`home:stats:${user.id}:`);
    }
    // 친구 추월 + 1위 등극 + 새 PB 푸시 enqueue (build 100) — fire-and-forget, RPC 내부 디바운스
    if (user) {
      try {
        const { getSupabase } = await import('@/lib/supabase');
        const sb = getSupabase();
        await Promise.all([
          sb.rpc('enqueue_friend_overtake_pushes', { my_user_id: user.id }),
          sb.rpc('enqueue_my_milestone_pushes', { my_user_id: user.id }),
        ]);
      } catch {}
    }
    await Promise.all([loadStats({ force: true }), refresh()]);

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
    <CourseCompletionModal />
    <div className="max-w-lg mx-auto pb-8 bg-[var(--background)] min-h-screen">
    {/* Sticky Header — build 208 #6-2: 좌 Home 로고/타이틀, 우 컴팩트 START 칩 고정. */}
    <header className="sticky top-0 z-20 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
      <div className="px-4 py-3 flex items-center gap-2">
        <AppLogo size={28} />
        <h1 className="text-xl font-extrabold tracking-tight">{t('home.title')}</h1>
        <Link
          href="/track"
          className="ml-auto inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-base shadow-md shadow-emerald-500/30 active:scale-95 transition"
          aria-label={tt('달리기 시작하기')}
        >
          <MapPin size={18} />
          <span className="leading-none">{locale === 'en' ? 'Start Run' : '달리기 시작'}</span>
        </Link>
      </div>
    </header>
      {syncToast && (
        <AppToast text={syncToast} tone={syncToast.startsWith('동기화 실패') ? 'warn' : 'ok'} position="top" onClose={() => setSyncToast(null)} durationMs={4000} />
      )}

      {/* ========== ① HealthKit + 개인 통계 + 경쟁/소셜 묶음 ==========
          순서 (build 100 재배치):
          1 HealthKit → 2 주간Recap → 3 스트릭경고 → 4 이름헤더 → 5 4칩 → 6 이달목표
          → 7 랭킹Hero (활성화 hero) → 8 LiveRunning → 9 캘린더 → 10 지역배너
          → 11 Friends → 12 Predict → 13 LocalTop → 14 Neighbors → 15 OnThisDay */}
      <div className="space-y-3 pt-1">
        {/* build 169 #7: PTR 온보딩 힌트가 최상단 자리. (이전엔 HealthConnect 배너가 가장 위에 있어
            첫 진입 시 시각적 노이즈가 컸음 — 사용자 신고). HealthKit 진입점은 시작 가이드 안에 통합. */}
        <PullDownOnboardingHint />

        {/* 1.5 신규 가입자 onboarding 가이드 (build 100) — 가입 7일 이내 + 5회 미만일 때만 노출.
            App Store 2.5.1 요건 충족: 안에 "Apple Health 연동" 진입 항목 포함. */}
        <HomeOnboardingCard />

        {/* 2 주간 리캡 + 3 스트릭 경고 (둘 다 조건부, 자체 padding 없어 wrap) */}
        <div className="mx-4 space-y-3">
          <WeeklyRecapCard activities={activities} />
          <StreakWarningCard activities={activities} streak={getStreak(activities)} />
        </div>

        {/* build 167 #10: 월말 정산 카드 (조건부 — 월말 3일 + 다음달 첫 7일) */}
        <MonthEndRecapCard activities={activities} />

        {/* build 167 #11: Run of the Day — 어제 활동 중 자동 선정. 데이터 있을 때만 표시 */}
        <RunOfTheDayCard />

        {/* build 280: 이달의 라이벌 — Duolingo Leagues 식 1:1 랜덤 매칭.
            모르는 사용자 매칭이 친한 사람보다 동기 부여 효과 큼 (anonymous accountability). */}
        <MonthlyRivalCard />

        {/* 4 {이름}님의 N월 헤더 */}
        <div className="mx-4 flex items-center justify-between pt-1">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-[var(--foreground)]">
              {t('home.userMonthTitle')
                .replace('{name}', profile?.display_name ?? t('profile.runner'))
                .replace('{month}', monthLabel)}
            </h2>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-xs text-[var(--muted)]">
                {t('home.totalSummary')
                  .replace('{km}', totalKm.toFixed(0))
                  .replace('{runs}', String(totalRuns))}
              </p>
              <FreshnessBadge ts={lastUpdated} onRefresh={refresh} />
            </div>
          </div>
          {/* build 259: 마일리지 잔액 chip — 홈에서 즉시 보임. 클릭 시 /mileage */}
          {mileageBalance !== null && (
            <Link
              href="/mileage"
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-br from-emerald-50 to-emerald-100/60 dark:from-emerald-950/40 dark:to-emerald-900/30 border border-emerald-200/60 dark:border-emerald-800/40 active:scale-95 transition"
            >
              <span className="text-[15px] leading-none">🪙</span>
              <span className="text-sm font-extrabold text-emerald-800 dark:text-emerald-200 tabular-nums">
                {mileageBalance.toLocaleString()}
              </span>
              <span className="text-xs font-bold text-emerald-700/70 dark:text-emerald-300/70">P</span>
            </Link>
          )}
        </div>

        {/* 5 오늘/이달 stats. build 154: activities 로딩 중엔 "0.0" 대신 dim 점 표시.
            build 260: 4-column → 2×2 grid 로 재구성. 한 칸만 text-2xl 로 작아져 어색했던 문제 해결.
            모든 셀 text-3xl 통일, 셀 너비 2배 → 페이스 "48'50" 자릿수 안전. 좌우 대칭 정돈.
            행 사이 구분선 (divide-y) 으로 시각적 그루핑 (오늘 vs 이달). */}
        <div className="mx-4 card p-5">
          <div className="grid grid-cols-2 gap-x-6 divide-y divide-[var(--card-border)]/40 text-center tabular-nums">
            <div className="pb-4 min-w-0">
              {userDataLoading && activities.length === 0 ? (
                <p className="text-3xl font-extrabold text-[var(--accent)] opacity-30">···</p>
              ) : (
                <p className="text-3xl font-extrabold text-[var(--accent)]">{todayKm.toFixed(1)}</p>
              )}
              <p className="text-sm font-medium text-[var(--muted)] mt-1">{t('home.todayKm')}</p>
            </div>
            <div className="pb-4 min-w-0">
              {userDataLoading && activities.length === 0 ? (
                <p className="text-3xl font-extrabold text-[var(--foreground)] opacity-30">···</p>
              ) : (
                <p className="text-3xl font-extrabold text-[var(--foreground)]">
                  {todayPaceSec ? formatPace(todayPaceSec) : recentPace ? formatPace(recentPace.pace) : '-'}
                </p>
              )}
              <p className="text-sm font-medium text-[var(--muted)] mt-1">
                {todayPaceSec ? t('home.todayPace') : recentPace ? t('home.recentPace') : t('home.todayPace')}
              </p>
            </div>
            <div className="pt-4 min-w-0">
              {userDataLoading && activities.length === 0 && !profileMonthCacheValid ? (
                <p className="text-3xl font-extrabold text-green-600 opacity-30">···</p>
              ) : (
                <p className="text-3xl font-extrabold text-green-600">{monthlyDistance.toFixed(1)}</p>
              )}
              <p className="text-sm font-medium text-[var(--muted)] mt-1">{t('home.monthKm')}</p>
            </div>
            <div className="pt-4 min-w-0">
              {userDataLoading && activities.length === 0 && !profileMonthCacheValid ? (
                <p className="text-3xl font-extrabold text-lime-600 dark:text-lime-500 opacity-30">···</p>
              ) : (
                <p className="text-3xl font-extrabold text-lime-600 dark:text-lime-500">{monthlyRunDays}</p>
              )}
              <p className="text-sm font-medium text-[var(--muted)] mt-1">{t('home.monthDays')}</p>
            </div>
          </div>
        </div>

        {/* 6 달리기 시작 — build 208 #6-2: sticky header 우상단 START 칩으로 이동. 기존 큰 카드 제거. */}

        {/* 6.1 이달 목표 */}
        <div className={`mx-4 card p-5 relative overflow-hidden ${goalKm > 0 && goalProgress >= 100 ? 'goal-achieved' : ''}`}>
          {goalKm > 0 && goalProgress >= 100 && (
            <div className="absolute inset-0 achievement-shimmer pointer-events-none" />
          )}
          <div className="relative">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-[var(--foreground)]">{t('home.monthGoal').replace('{month}', monthLabel)}</h3>
              <Link href="/goals" className="text-sm text-[var(--accent)] font-semibold flex items-center gap-0.5">
                {t('home.set')} <ChevronRight size={14} />
              </Link>
            </div>
            {goalKm > 0 ? (
              <>
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
                    <span className="mx-2 text-base">{t('home.goalAchieved').replace('{km}', String(goalKm))}</span>
                    <span className="confetti-emoji">✨</span>
                    <span className="confetti-emoji">🎊</span>
                  </div>
                ) : (
                  <div className="flex justify-between items-center text-xs text-[var(--muted)]">
                    <span dangerouslySetInnerHTML={{
                      __html: t('home.goalLabel').replace('{km}', `<span class='font-semibold text-[var(--foreground)]'>${goalKm}km</span>`)
                    }} />
                    <span>{t('home.goalRemaining').replace('{remain}', goalRemaining.toFixed(1)).replace('{daily}', dailyNeeded.toFixed(1))}</span>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-4 space-y-2">
                <p className="text-3xl">🎯</p>
                <p className="text-sm font-medium text-[var(--foreground)]">{t('home.monthGoalEmpty')}</p>
                <Link href="/goals" className="text-sm text-[var(--accent)] font-semibold inline-block">
                  {t('home.monthGoalSet')}
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* 6.5 이번 주 도전 (build 100) — build 143: 300ms defer (secondary) */}
        {secondaryMounted && <HomeChallengeCard />}
        {secondaryMounted && <HomeWorldMarathonCard />}

        {/* 6.7 친구 활동 스토리 — build 143: 300ms defer (secondary) */}
        {secondaryMounted && <HomeFriendStories />}

        {/* build 207 #15: SharePeriodEntry 제거 — HomeCalendarCard 안 "공유카드 만들기"로 통합.
            오늘/이번 주/이번 달 3옵션을 시트로 선택. */}

        {/* 6.97 시즌 결산 (build 199 / Phase 3) — 분기말 ±7일에만 노출 */}
        <SeasonRecapCard />

        {/* 7 랭킹 Hero — 활성화 핵심 (eager) */}
        <HomeRankingHero />

        {/* 8 실시간 러닝 — build 143: 300ms defer (secondary) */}
        {secondaryMounted && <LiveRunningIndicator />}

        {/* 9 월 캘린더 */}
        <div className="mx-4"><HomeCalendarCard /></div>

        {/* 9.5 미니맵 — build 137: LazyMount 제거 (사용자 피드백: "지도 안 보임"). 즉시 마운트.
            SVG polyline 자체는 가볍고 fetchRoutesForUser 는 LIMIT 7 로 빠름. */}
        <HomeMapPreview />

        {/* 10 지역 미설정 배너 (조건부) */}
        {profile && !profile.region_gu && !profile.country_code && (
          <Link href="/profile/edit" className="mx-4 block card p-3 bg-gradient-to-r from-blue-50 to-green-50 dark:from-blue-950/30 dark:to-green-950/30 border-0">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📍</span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-[var(--foreground)]">{t('home.regionNotSet')}</p>
                <p className="text-xs text-[var(--muted)]">{t('home.regionNotSetSub')}</p>
              </div>
              <ChevronRight size={16} className="text-[var(--accent)]" />
            </div>
          </Link>
        )}

        {/* 11~15 below-the-fold 소셜 묶음 */}
        <LazyMount minHeight={180} rootMargin="300px"><FriendsLeaderboard /></LazyMount>
        <LazyMount minHeight={200} rootMargin="300px"><WinnerPredictionWidget /></LazyMount>
        <LazyMount minHeight={160} rootMargin="300px"><TodayLocalTop /></LazyMount>
        <LazyMount minHeight={120} rootMargin="300px"><RankNeighbors /></LazyMount>
        <LazyMount minHeight={140} rootMargin="300px"><OnThisDayCard /></LazyMount>
      </div>

      {/* ========== ② 통계 차트 묶음 ==========
          16 스트릭 → 17 PB → 18 일별30일 → 19 12주 → 20 페이스 → 21 요일 → 22 시간대
          → 23 기간별 상세 (+히스토리 링크) → 24 요약 4칩 → 25 최근 활동 */}
      <div className="p-4 space-y-4">

      {/* 16 연속 달리기 스트릭 */}
      <LazyMount minHeight={160}>
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Flame size={16} className="text-orange-500" />
          <h3 className="text-base font-semibold text-[var(--foreground)]">{tt('연속 달리기 스트릭')}</h3>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-3xl font-extrabold text-orange-500">{streak}</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">{tt('현재 연속일')}</p>
          </div>
          <div className="border-x border-[var(--card-border)]">
            <p className="text-3xl font-extrabold text-purple-500">{maxStreak}</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">{tt('최장 연속일')}</p>
          </div>
          <div>
            <p className="text-3xl font-extrabold text-[var(--foreground)]">{totalRuns}</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">{tt('총 러닝')}</p>
          </div>
        </div>
        {isRecordBreaking && maxStreak >= 2 && (
          <p className="text-center text-xs font-bold text-orange-500 mt-3 achievement-shimmer rounded-lg py-1.5">
            {tt('🔥 최장 기록 갱신 중!')}
          </p>
        )}
        {daysToRecord > 0 && daysToRecord <= 3 && (
          <p className="text-center text-xs font-semibold text-[var(--accent)] mt-3">
            {locale === 'en' ? `${daysToRecord} day${daysToRecord === 1 ? '' : 's'} to your all-time record!` : `역대 최장 기록까지 ${daysToRecord}일!`}
          </p>
        )}
      </div>
      </LazyMount>

      {/* 17 개인 베스트 — 올해/누적 탭 */}
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
              <h3 className="text-base font-semibold text-[var(--foreground)]">{tt('개인 베스트')}</h3>
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
                  <p className="text-xs text-[var(--muted)] mb-1">{tt('최장 거리')}</p>
                  <p className="text-2xl font-extrabold text-[var(--foreground)]">{pb.longestRun.distance_km.toFixed(2)}km</p>
                  <p className="text-xs text-[var(--muted)]">{pb.longestRun.date}</p>
                </div>
              )}
              {pb.fastestPace && (
                <div className="bg-[var(--card-border)]/30 rounded-xl p-3">
                  <p className="text-xs text-[var(--muted)] mb-1">{tt('최빠 페이스')}</p>
                  <p className="text-2xl font-extrabold text-[var(--foreground)]">{formatPace(pb.fastestPace.pace)}/km</p>
                  <p className="text-xs text-[var(--muted)]">{pb.fastestPace.date} ({pb.fastestPace.distance_km.toFixed(1)}km)</p>
                </div>
              )}
              {pb.longestDuration && (
                <div className="bg-[var(--card-border)]/30 rounded-xl p-3">
                  <p className="text-xs text-[var(--muted)] mb-1">{tt('최장 시간')}</p>
                  <p className="text-2xl font-extrabold text-[var(--foreground)]">{formatDuration(pb.longestDuration.duration)}</p>
                  <p className="text-xs text-[var(--muted)]">{pb.longestDuration.date}</p>
                </div>
              )}
              {pb.mostCalories && pb.mostCalories.calories > 0 && (
                <div className="bg-[var(--card-border)]/30 rounded-xl p-3">
                  <p className="text-xs text-[var(--muted)] mb-1">{tt('최다 칼로리')}</p>
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

      {/* 18 일별 거리 추이 (최근 30일) */}
      <LazyMount minHeight={260}>
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-[var(--foreground)]">{tt('일별 거리 추이')}</h3>
          <span className="text-xs text-[var(--muted)]">{locale === 'en' ? `Last 30 days · ${daily30Total.toFixed(1)}km total` : `최근 30일 · 총 ${daily30Total.toFixed(1)}km`}</span>
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

      {/* 19 최근 12주 러닝 */}
      {weeklyData.length > 0 && (
        <LazyMount minHeight={240}>
        <div className="card p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-base font-bold text-[var(--foreground)]">{tt('최근 12주 러닝')}</h3>
            {(() => {
              const nowMs = Date.now();
              const _12wMs = 12 * 7 * 24 * 60 * 60 * 1000;
              const yearMs = 365 * 24 * 60 * 60 * 1000;
              let thisSum = 0, lastSum = 0;
              activities.forEach(a => {
                const t = new Date(a.activity_date).getTime();
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

      {/* 20 페이스 추이 (최근 12개월) */}
      {paceTrend.some(p => p.avgPace !== null) && (
        <LazyMount minHeight={260}>
        <div className="card p-5">
          <h3 className="text-base font-bold text-[var(--foreground)] mb-3">{tt('페이스 추이 (최근 12개월)')}</h3>
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
                formatter={(value) => [formatPace(Number(value)), tt('평균 페이스')]}
              />
              <Area type="monotone" dataKey="avgPace" stroke="#10B981" strokeWidth={2.5} fill="url(#homePaceGrad)" dot={{ r: 4, fill: '#10B981' }} animationDuration={chartStyle.animationDuration} />
            </AreaChart>
          </ResponsiveContainer>
          <p className="text-xs text-[var(--muted)] mt-2 text-center">{tt('위로 갈수록 빠른 페이스')}</p>
        </div>
        </LazyMount>
      )}

      {/* 21 요일별 패턴 — build 152: 2026/누적 토글 추가 */}
      {dayStats.length > 0 && dayStats.some(d => d.runCount > 0) && (
        <LazyMount minHeight={360}>
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Calendar size={16} className="text-blue-500" />
              <h3 className="text-base font-semibold text-[var(--foreground)]">{tt('요일별 러닝 패턴')}</h3>
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
          <p className="text-xs text-[var(--muted)] mb-3">
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
                <p className="text-base font-bold text-[var(--foreground)]">{d.runCount}</p>
                <p className="text-xs text-[var(--muted)]">{d.avgDistance}km</p>
              </div>
            ))}
          </div>
        </div>
        </LazyMount>
      )}

      {/* 22 시간대별 분포 — build 152: 2026/누적 토글 추가 */}
      {hourStats.some(h => h.runCount > 0) && (
        <LazyMount minHeight={220}>
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-orange-500" />
              <h3 className="text-base font-semibold text-[var(--foreground)]">{tt('시간대별 러닝 분포')}</h3>
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
          <p className="text-xs text-[var(--muted)] mb-3">
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
                  <span className="w-24 text-sm text-[var(--foreground)] flex-shrink-0">{g.label}</span>
                  <div className="flex-1 h-5 bg-[var(--card-border)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(barWidth, 2)}%`, backgroundColor: colors[i] }}
                    />
                  </div>
                  <span className="text-sm font-semibold text-[var(--foreground)] w-8 text-right">{locale === 'en' ? g.count : `${g.count}회`}</span>
                </div>
              );
            })}
          </div>
        </div>
        </LazyMount>
      )}

      {/* 23 기간별 상세 통계 (+ 히스토리 링크 — 기존 sticky 헤더에서 이동) */}
      <LazyMount minHeight={420}>
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold text-[var(--foreground)]">{tt('기간별 상세 통계')}</h3>
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
          <p className="text-3xl font-extrabold text-[var(--accent)]">{detailTotal.toFixed(1)} km</p>
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
                  <Bar dataKey="prevDistance" name={locale === 'en' ? String(detailYear - 1) : `${detailYear - 1}년`} fill="#CBD5E1" radius={chartStyle.barRadius} animationDuration={chartStyle.animationDuration} />
                )}
                <Bar dataKey="distance" name={locale === 'en' ? String(detailYear) : `${detailYear}년`} fill="url(#homeDetailGrad)" radius={chartStyle.barRadius} animationDuration={chartStyle.animationDuration} />
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
                  <Area type="monotone" dataKey="prevDistance" name={locale === 'en' ? String(detailYear - 1) : `${detailYear - 1}년`} stroke="#94a3b8" strokeWidth={2} fill="none" dot={{ r: 3, fill: '#94a3b8' }} animationDuration={chartStyle.animationDuration} />
                )}
                <Area type="monotone" dataKey="distance" name={locale === 'en' ? String(detailYear) : `${detailYear}년`} stroke="#3B82F6" strokeWidth={chartStyle.strokeWidth} fill="url(#homeDetailAreaGrad)" dot={{ r: chartStyle.dotRadius, fill: '#3B82F6' }} activeDot={{ r: chartStyle.activeDotRadius, strokeWidth: 2 }} animationDuration={chartStyle.animationDuration} />
                {hasDetailPrev && <Legend wrapperStyle={{ fontSize: 13 }} />}
              </AreaChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
      </LazyMount>

      {/* 24 요약 4칩 — 이번 주/이번 달/올해/누적 */}
      <LazyMount minHeight={200}>
      <div className="card p-5">
        <h3 className="text-base font-bold text-[var(--foreground)] mb-4">{t('home.summaryTitle')}</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[var(--card-border)]/30 rounded-xl p-4">
            <p className="text-xs text-[var(--muted)] mb-1">{t('home.summaryWeek')}</p>
            <p className="text-2xl font-extrabold text-[var(--accent)]">{weekKm.toFixed(1)}<span className="text-sm ml-1">km</span></p>
            <p className="text-xs text-[var(--muted)] mt-1">{t('home.summaryRuns').replace('{n}', String(weekRuns))}</p>
            {yoyComparison.week.last > 0.5 && (
              <p className={`text-xs mt-1 ${yoyComparison.week.diff >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                {t('home.yoyLast').replace('{sign}', yoyComparison.week.diff >= 0 ? '+' : '').replace('{km}', yoyComparison.week.diff.toFixed(0))}
              </p>
            )}
          </div>
          <div className="bg-[var(--card-border)]/30 rounded-xl p-4">
            <p className="text-xs text-[var(--muted)] mb-1">{t('home.summaryMonth')}</p>
            <p className="text-2xl font-extrabold text-green-600">{monthlyDistance.toFixed(1)}<span className="text-sm ml-1">km</span></p>
            <p className="text-xs text-[var(--muted)] mt-1">{t('home.summaryMonthDays').replace('{days}', String(monthlyRunDays)).replace('{runs}', String(calendarActivities.length))}</p>
            {yoyComparison.month.last > 0.5 && (
              <p className={`text-xs mt-1 ${yoyComparison.month.diff >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                {t('home.yoyLast').replace('{sign}', yoyComparison.month.diff >= 0 ? '+' : '').replace('{km}', yoyComparison.month.diff.toFixed(0))}
              </p>
            )}
          </div>
          <div className="bg-[var(--card-border)]/30 rounded-xl p-4">
            <p className="text-xs text-[var(--muted)] mb-1">{t('home.summaryYear')}</p>
            <p className="text-2xl font-extrabold text-purple-600">{yearlyTotal.toFixed(0)}<span className="text-sm ml-1">km</span></p>
            {yearlyPrevTotal > 0 && (
              <p className={`text-xs mt-1 ${yearlyTotal >= yearlyPrevTotal ? 'text-emerald-600' : 'text-rose-500'}`}>
                {t('home.yoyLast').replace('{sign}', yearlyTotal >= yearlyPrevTotal ? '+' : '').replace('{km}', (yearlyTotal - yearlyPrevTotal).toFixed(0))}
              </p>
            )}
          </div>
          <div className="bg-[var(--card-border)]/30 rounded-xl p-4">
            <p className="text-xs text-[var(--muted)] mb-1">{t('home.summaryAllTime')}</p>
            <p className="text-2xl font-extrabold text-orange-600">{totalKm.toFixed(0)}<span className="text-sm ml-1">km</span></p>
            <p className="text-xs text-[var(--muted)] mt-1">{t('home.summaryRuns').replace('{n}', String(totalRuns))}</p>
          </div>
        </div>
      </div>
      </LazyMount>

      {/* 25 최근 활동 */}
      <LazyMount minHeight={300}>
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-[var(--foreground)]">{t('home.recentActivity')}</h3>
          {activities.length > 0 && (
            <Link href="/history" className="text-sm text-[var(--accent)] font-semibold flex items-center gap-0.5">
              {t('home.viewAllHistory')} <ChevronRight size={14} />
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
            <p className="text-sm font-medium text-[var(--foreground)]">{t('home.noActivityYet')}</p>
            <Link href="/connect" className="text-sm text-[var(--accent)] font-semibold inline-block">
              {t('home.connectHealthCta')}
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
                    {new Date(a.activity_date).toLocaleDateString(locale === 'en' ? 'en-US' : 'ko-KR', { month: 'short', day: 'numeric', weekday: 'short' })}
                    {a.pace_avg_sec_per_km ? ` · ${formatPace(a.pace_avg_sec_per_km)}/km` : ''}
                  </p>
                </div>
                <ChevronRight size={14} className="text-[var(--muted)]" />
              </Link>
            ))}
          </div>
        )}
      </div>
      </LazyMount>

      {statsLoading && monthlyData.length === 0 && (
        <p className="text-center text-xs text-[var(--muted)]">{tt('통계 로딩 중...')}</p>
      )}
      </div>

      {/* 러닝사진 카루셀 제거 — 소셜 탭 포토 갤러리(인스타 스타일)와 중복 (build 100). */}

      {/* build 155: 지역 자동 등록 안내 모달 — health-sync 가 GPS 로 채운 직후 1회만 */}
      {regionAutoNotice && (
        <div
          className="fixed inset-0 z-[80] bg-black/55 flex items-center justify-center p-4 animate-[fadeIn_0.2s_ease-out]"
          onClick={() => setRegionAutoNotice(null)}
        >
          <div className="w-full max-w-sm bg-[var(--background)] rounded-3xl p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-center space-y-3">
              <div className="mx-auto w-16 h-16 rounded-full bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center text-3xl">📍</div>
              <h3 className="text-lg font-extrabold text-[var(--foreground)]">{tt('지역을 자동 등록했어요')}</h3>
              <p className="text-sm text-[var(--muted)] leading-relaxed">
                {locale === 'en' ? 'Region estimated from your run GPS.' : '러닝 GPS 정보로 추정한 지역이에요.'}
                <br />
                <span className="text-emerald-600 dark:text-emerald-400 font-bold">{regionAutoNotice.display}</span>
              </p>
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                {locale === 'en' ? (
                  <>If it&apos;s incorrect, you can edit it in <Link href="/profile/edit" className="text-emerald-600 underline font-semibold" onClick={() => setRegionAutoNotice(null)}>{tt('내 정보')}</Link>.</>
                ) : (
                  <>정확하지 않다면 <Link href="/profile/edit" className="text-emerald-600 underline font-semibold" onClick={() => setRegionAutoNotice(null)}>{tt('내 정보')}</Link> 에서 직접 수정할 수 있어요.</>
                )}
              </p>
            </div>
            <button
              onClick={() => setRegionAutoNotice(null)}
              className="mt-5 w-full py-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-sm active:scale-[0.98]"
            >
              {tt('확인')}
            </button>
          </div>
        </div>
      )}
    </div>
    </PullToRefresh>
  );
}
