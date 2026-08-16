'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/components/UserDataProvider';
import PullToRefresh from '@/components/PullToRefresh';
import {
  getWeeklyStreak,
  getMaxWeeklyStreak,
  getThisWeekRunDays,
  getMonthlyDistance,
  runningOnly,
  formatDuration,
} from '@/lib/routinist-data';
import Onboarding from '@/components/Onboarding';
import LazyMount from '@/components/LazyMount';
import { useI18n, ttl, getCurrentLocale } from '@/lib/i18n';
import AppLogo from '@/components/AppLogo';
import NotificationBell from '@/components/NotificationBell';
import HomeRankingHero from '@/components/home/HomeRankingHero';
import SeasonRecapCard from '@/components/home/SeasonRecapCard';
import StreakWarningCard from '@/components/home/StreakWarningCard';
import HomeCalendarCard, { SHARE_PICKER_EVENT } from '@/components/home/HomeCalendarCard';
import { syncHealthData, isNativeApp } from '@/lib/health-sync';
import WinnerPredictionWidget from '@/components/home/WinnerPredictionWidget';
// RoutinePhotoCarousel 제거 — 소셜 탭 포토 갤러리와 중복 (build 100)
import OnThisDayCard from '@/components/home/OnThisDayCard';
import LiveRunningIndicator from '@/components/home/LiveRunningIndicator';
import HomeMapPreview from '@/components/home/HomeMapPreview';
import HomeChallengeCard from '@/components/home/HomeChallengeCard';
import WeeklyGoalCard from '@/components/home/WeeklyGoalCard';
import HomeWorldMarathonCard from '@/components/home/HomeWorldMarathonCard';
import CourseCompletionModal from '@/components/world/CourseCompletionModal';
import HomeOnboardingCard from '@/components/home/HomeOnboardingCard';
import PullDownOnboardingHint from '@/components/home/PullDownOnboardingHint';
import MonthEndRecapCard from '@/components/home/MonthEndRecapCard';
import RunOfTheDayCard from '@/components/home/RunOfTheDayCard';
import MonthlyRivalCard from '@/components/home/MonthlyRivalCard';
import BadgeCelebration from '@/components/home/BadgeCelebration';
import HomeFriendStories from '@/components/home/HomeFriendStories';
import HomeStatsGlance from '@/components/home/HomeStatsGlance';
import CompetitionHub from '@/components/home/CompetitionHub';
import FreshnessBadge from '@/components/FreshnessBadge';
import AppToast from '@/components/AppToast';
import Link from 'next/link';
import {
  ChevronRight, MapPin, Zap,
  BarChart3, Share2,
} from 'lucide-react';
import { useDistanceUnit, toDisplayDistance, unitLabel, paceUnitLabel, formatPaceForUnit } from '@/lib/units';


// 홈 그룹 라벨 — v5 (2026-08-02 hans): 일·주·월 구분 라벨 자체를 제거 ("빼도 될 거 같애").
// v4 미니멀 캡스 라벨도 삭제 — 카드 순서(오늘→주→월→함께→기록)가 곧 구분.

export default function DashboardPage() {
  const { t, tt, locale } = useI18n();
  const unit = useDistanceUnit(); // build 290: 표시 단위 (km/mi). 랭킹/목표/월드런/차트 데이터는 km 유지
  const { user, profile } = useAuth();
  const { activities, goals, loading: userDataLoading, refresh, lastUpdated } = useUserData();
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Phase B: 차트 상태·로더는 StatsCharts(/stats) 로 이관

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
    // build 298: 키에 user.id 포함 — 기기 전역 플래그면 지인 폰에서 써 본 뒤 가입하는
    // 신규 유저가 온보딩(닉네임·목표·지역)을 통째로 스킵함 (PullDownOnboardingHint 와 동일 패턴).
    // 기존 유저는 display_name/total_runs 게이트에서 걸러지므로 키 마이그레이션 불필요.
    const dismissed = typeof window !== 'undefined' && user
      && localStorage.getItem(`onboarding_done:${user.id}`);
    // 2026-08-09: display_name 휴리스틱 → onboarded_at 플래그. 구 게이트는 OAuth name 이
    // display_name 에 들어가는 Google 가입자(실측 61%)를 통째로 건너뛰었다.
    if (!dismissed && profile && !profile.onboarded_at) {
      setShowOnboarding(true);
    }
  }, [profile, user]);

  // build 155: 지역 자동 등록 알림 — health-sync 가 자동으로 채운 직후 1회 표시.
  const [regionAutoNotice, setRegionAutoNotice] = useState<{ display: string; country_code: string } | null>(null);
  useEffect(() => {
    if (!user) return;
    import('@/lib/profile-region-auto').then(m => {
      const n = m.consumeRegionAutoNotice();
      if (n) setRegionAutoNotice(n);
    }).catch(() => {});
  }, [user]);

  // Phase B: loadStats/loadDetail → StatsCharts(/stats) 이관. 캐시 invalidate 는 refreshAll 이 계속 수행.

  // Achievement 자동 체크 (build 129) — dashboard 진입 시 1회.
  // 습관 형성: 반환값의 newly_awarded===true (SQL fix 후 진짜 신규만) 배지는 축하 모달 큐로.
  // localStorage `badge_celebrated:{code}` 로 기기당 1회만 — 모달 남발 방지.
  const [badgeQueue, setBadgeQueue] = useState<string[]>([]);
  useEffect(() => {
    if (!user) return;
    import('@/lib/achievements-data').then(async m => {
      const results = await m.checkAndAwardAchievements();
      const fresh = results
        .filter(r => r.newly_awarded && m.ACHIEVEMENTS[r.code])
        .map(r => r.code)
        .filter(code => !localStorage.getItem(`badge_celebrated:${code}`));
      if (fresh.length > 0) setBadgeQueue(fresh);
    }).catch(() => { /* silent */ });
  }, [user]);

  // 스트릭 보호권 (습관 형성) — 보유 수 + 최근 60일 사용일.
  // get_my_streak_freezes 호출이 lazy 충전도 겸함. RPC 미배포/실패 시 빈 Set → 기존 스트릭 동작 그대로.
  const [freezes, setFreezes] = useState<{ count: number; uses: Set<string> }>({ count: 0, uses: new Set() });
  const loadFreezes = useCallback(async () => {
    if (!user) return;
    try {
      const { fetchStreakFreezes } = await import('@/lib/streak-freeze');
      setFreezes(await fetchStreakFreezes());
    } catch { /* silent — 기본값 유지 */ }
  }, [user]);
  useEffect(() => { void loadFreezes(); }, [loadFreezes]);

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
  // build 291: 거리 지표는 러닝만 (걷기 opt-in 유저 산책 km 제외 — 사용자 신고)
  const todayActivities = useMemo(
    () => runningOnly(activities).filter(a => a.activity_date === todayStr),
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
    // activity_date 'YYYY-MM-DD' 는 문자열 prefix 비교 (UTC 파싱 시 서쪽 timezone 하루 밀림)
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const daySet = new Set(
      runningOnly(activities)
        .filter(a => a.activity_date.slice(0, 7) === ym)
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

  // Phase A: calendarActivities 제거 — 요약 4칩 삭제로 미사용

  const totalKm = Number(profile?.total_distance_km ?? 0);
  const totalRuns = profile?.total_runs ?? 0;
  // 습관 코어 C1 (2026-07-11): 일 단위 → 주 단위 스트릭 전환.
  // 유저 전원이 주 2~4회 러너라 일 스트릭은 62명 중 2명만 보유 — 주 단위가 실제 습관 단위.
  // 보호권 사용일이 포함된 주는 달성 취급 (freezes.uses 빈 Set 이면 순수 러닝 기준).
  const weeklyRunGoal = profile?.weekly_run_goal ?? null;
  const streakState = useMemo(() => {
    const streak = getWeeklyStreak(activities, weeklyRunGoal, freezes.uses);
    const maxStreak = getMaxWeeklyStreak(activities, weeklyRunGoal, freezes.uses);
    const thisWeekRunDays = getThisWeekRunDays(activities);
    return {
      streak,
      maxStreak,
      thisWeekRunDays,
      isRecordBreaking: streak > 0 && streak === maxStreak,
      weeksToRecord: streak > 0 && streak < maxStreak ? maxStreak - streak : 0,
    };
  }, [activities, weeklyRunGoal, freezes.uses]);
  const { streak, maxStreak, thisWeekRunDays, isRecordBreaking, weeksToRecord } = streakState;


  // Phase A: yoyComparison·연간 합계 제거 — 요약 4칩 삭제로 미사용 (기간 상세 카드가 대체)

  // Phase B: dailyData·dayStats·hourStats·기간상세 파생값 → StatsCharts 이관


  const recentActivities = activities.slice(0, 5);

  // 단순화 B (2026-07-11): 신규 러너 모드 — 러닝 5회 미만 + 가입 14일 이내.
  // 첫인상 인지 부하 절반: [시작 가이드 / 이달 목표 / 달력 / START 칩(헤더) / 최근 활동] 만 렌더,
  // 나머지 카드 (페이스메이커·월드런·우승예측·친구스토리·리더보드·차트 등) 는 스킵.
  // 러닝 수는 profile.total_runs 와 activities.length 중 큰 값 — activities 지연 도착으로
  // 기존 유저가 순간 신규 모드로 보이는 깜빡임 방지 (profile 은 auth 와 함께 먼저 도착).
  const isNewRunner = useMemo(() => {
    if (!profile) return false;
    const runs = Math.max(profile.total_runs ?? 0, activities.length);
    if (runs >= 5) return false;
    const created = new Date(profile.created_at).getTime();
    if (!Number.isFinite(created)) return false;
    return Date.now() - created <= 14 * 24 * 60 * 60 * 1000;
  }, [profile, activities.length]);

  // Phase A (build 327, hans 홈 다이어트): 리캡류 동시 노출 방지 — 우선순위 1장만.
  // 2026-08-03 hans: **주간 리캡 폐기** ("주간 단위는 너무 잦다") — 월간(월말정산)만 유지.
  // 각 카드의 자체 게이트는 유지 (여긴 겹칠 때 한 장만 고르는 상위 슬롯).
  const recapSlot = useMemo<'monthEnd' | 'season'>(() => {
    const now = new Date();
    const day = now.getUTCDate();
    const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    if (day === lastDay || day === 1) return 'monthEnd';
    return 'season';
  }, []);

  // build 291 i18n Phase D: 이전엔 syncToast.startsWith('동기화 실패') 로 tone 판정했지만
  // 실제 메시지가 '동기화 중에 문제가...' 라 조건이 항상 false (dead) + 번역 시 매칭 불가.
  // → tone 을 메시지와 함께 구조적으로 저장.
  const [syncToast, setSyncToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  // (2026-07-30 2차) 거리권한 경고 배너는 제거 — 진범이 워치 share 세트 누락으로 판명.

  const handleRefresh = useCallback(async () => {
    let toast = '';
    let toastTone: 'ok' | 'warn' = 'ok';
    const en = getCurrentLocale() === 'en';
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
          // build 327: pull-to-refresh 는 조용히 조회만 — 새로고침마다 승인 시트 금지
          syncHealthData(user.id, { interactiveAuth: false }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('pull-refresh sync 30s timeout')), 30000)
          ),
        ]);
        if (r.success) {
          toast = r.synced > 0
            ? (en ? `${r.synced} new run${r.synced === 1 ? '' : 's'} just arrived! 🎉` : `러닝 ${r.synced}건 새로 도착! 🎉`)
            : r.meta?.totalFromHealth
              ? (en ? `Already up to date! ${r.meta.totalFromHealth} runs safe and sound ✨` : `이미 최신이에요! ${r.meta.totalFromHealth}건 챙겨놨어요 ✨`)
              : ttl('아직 새로운 기록은 없어요. 한 바퀴 돌아볼까요? 👟');
        } else {
          toast = `${ttl('동기화 중에 문제가 생겼어요')}\n${r.message}`;
          toastTone = 'warn';
        }
      } catch (e) {
        toast = `${ttl('동기화 중에 문제가 생겼어요')}\n${e instanceof Error ? e.message : ttl('알 수 없음')}`;
        toastTone = 'warn';
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
    await refresh();

    if (user) {
      try {
        const { fetchMileageBalance } = await import('@/lib/mileage-data');
        const balanceAfter = await fetchMileageBalance(user.id);
        const earned = balanceAfter - balanceBefore;
        if (earned > 0) {
          toast = en
            ? `🎉 +${earned}P earned! (Balance ${balanceAfter.toLocaleString()}P)`
            : `🎉 ${earned}P 적립! (잔액 ${balanceAfter.toLocaleString()}P)`;
          toastTone = 'ok';
        }
      } catch {}
    }

    if (toast) {
      setSyncToast({ text: toast, tone: toastTone });
      setTimeout(() => setSyncToast(null), 4000);
    }
  }, [user, refresh]);

  if (showOnboarding) {
    return <Onboarding onComplete={() => { setShowOnboarding(false); if (user) localStorage.setItem(`onboarding_done:${user.id}`, '1'); }} />;
  }

  return (
    <PullToRefresh onRefresh={handleRefresh}>
    <CourseCompletionModal />
    {/* 배지 획득 축하 — newly_awarded 큐 순차 표시. key=code 로 리마운트 (팝 애니메이션 재생) */}
    {badgeQueue.length > 0 && (
      <BadgeCelebration
        key={badgeQueue[0]}
        code={badgeQueue[0]}
        onClose={() => {
          try { localStorage.setItem(`badge_celebrated:${badgeQueue[0]}`, '1'); } catch {}
          setBadgeQueue(q => q.slice(1));
        }}
      />
    )}
    <div className="max-w-lg mx-auto pb-8 bg-[var(--background)] min-h-screen">
    {/* Sticky Header — build 208 #6-2: 좌 Home 로고/타이틀, 우 컴팩트 START 칩 고정. */}
    <header className="sticky top-0 z-20 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
      <div className="px-4 py-3 flex items-center gap-2">
        <AppLogo size={28} />
        <h1 className="text-xl font-extrabold tracking-tight">{t('home.title')}</h1>
        {/* 2026-07-18 (hans): 알림 종 — 앱 아이콘 배지를 보고 열면 홈에 떨어지므로,
            unread 카운트가 홈 우상단에서 바로 보여야 알림을 찾아 헤매지 않는다. */}
        {/* 2026-07-18: "달리기 시작" 칩은 탭바 정중앙 원형 버튼으로 이동 (헤더 복잡 피드백) */}
        <div className="ml-auto">
          <NotificationBell />
        </div>
      </div>
    </header>
      {syncToast && (
        <AppToast text={syncToast.text} tone={syncToast.tone} position="top" onClose={() => setSyncToast(null)} durationMs={4000} />
      )}

      {/* ========== ① HealthKit + 개인 통계 + 경쟁/소셜 묶음 ==========
          순서 (build 100 재배치):
          1 HealthKit → 2 주간Recap → 3 스트릭경고 → 4 이름헤더 → 5 4칩 → 6 이달목표
          → 7 랭킹Hero (활성화 hero) → 8 LiveRunning → 9 캘린더 → 10 지역배너
          → 11 Friends → 12 Predict → 13 LocalTop → 14 Neighbors → 15 OnThisDay */}
      <div className="space-y-4 pt-1">
        {/* Phase C (build 327, hans UX 리뷰): 5그룹 재배치 —
            지금(헤더·그리드·랭킹히어로) → 이번 주 → 이번 달 → 함께 달리기 → 내 기록.
            그룹 라벨(SectionLabel)로 경계 표시, 경쟁 3표면은 CompetitionHub 탭으로 통합. */}
        {/* (2026-07-30 hans 2차) 최상단 퍼레이드 제거 — "정신없다". 동물 행진은 섹션 라벨로 */}
        <PullDownOnboardingHint />

        {/* 신규 가입자 onboarding 가이드 — 가입 7일 이내 + 5회 미만.
            App Store 2.5.1 요건: 안에 "Apple Health 연동" 진입 항목 포함. */}
        <HomeOnboardingCard />

        {!isNewRunner && (<>
        {/* Phase A: 리캡 슬롯 — 겹치는 날에도 1장만 (월말정산 > 시즌). 주간은 2026-08-03 폐기 */}
        {recapSlot === 'monthEnd' && <MonthEndRecapCard activities={activities} />}

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
                {/* '{km}km' 을 통째로 치환해 mi 모드에서 단위 문구까지 변환 (i18n.ts 불변) */}
                {t('home.totalSummary')
                  .replace('{km}km', `${toDisplayDistance(totalKm, unit).toFixed(0)}${unitLabel(unit)}`)
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
          {/* 2026-08-02 hans P0-4: DAY 섹션은 오늘 지표만 — 이달 km·일수는 MONTH 의
              이달 목표 카드 서브라인으로 이동 (섹션 라벨과 내용 일치). */}
          <div className="grid grid-cols-2 gap-x-6 text-center tabular-nums">
            <div className="min-w-0">
              {userDataLoading && activities.length === 0 ? (
                <p className="text-3xl font-extrabold tracking-tight text-[var(--accent)] opacity-30">···</p>
              ) : (
                <p className="text-3xl font-extrabold tracking-tight text-[var(--accent)]">{toDisplayDistance(todayKm, unit).toFixed(1)}</p>
              )}
              <p className="text-sm font-medium text-[var(--muted)] mt-1">{t('home.todayKm').replace(/km$/, unitLabel(unit))}</p>
            </div>
            <div className="min-w-0">
              {userDataLoading && activities.length === 0 ? (
                <p className="text-3xl font-extrabold tracking-tight text-[var(--foreground)] opacity-30">···</p>
              ) : (
                <p className="text-3xl font-extrabold tracking-tight text-[var(--foreground)]">
                  {todayPaceSec ? formatPaceForUnit(todayPaceSec, unit) : recentPace ? formatPaceForUnit(recentPace.pace, unit) : '-'}
                </p>
              )}
              <p className="text-sm font-medium text-[var(--muted)] mt-1">
                {todayPaceSec ? t('home.todayPace') : recentPace ? t('home.recentPace') : t('home.todayPace')}
              </p>
            </div>
          </div>
        </div>

        {/* 공유카드 만들기 — 2026-08-16 (hans): 캘린더 카드 하단에 있어 한참 스크롤해야 보였다.
            첫 화면에서 바로 닿도록 상단으로. 기간 선택 시트는 HomeCalendarCard 가 그대로 소유하고
            여기서는 트리거만 쏜다 (SHARE_PICKER_EVENT). */}
        {activities.length > 0 && (
          <div className="mx-4">
            <button
              onClick={() => window.dispatchEvent(new Event(SHARE_PICKER_EVENT))}
              className="w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-base shadow-md shadow-emerald-500/30 active:scale-[0.98] transition"
            >
              <Share2 size={18} />
              {locale === 'en' ? 'Make share card' : '공유카드 만들기'}
            </button>
          </div>
        )}

        {/* 랭킹 Hero — 활성화 핵심 (eager). Phase C: 그리드 바로 아래로 승격 */}
        <HomeRankingHero />
        {secondaryMounted && <LiveRunningIndicator />}
        {/* Today BestRun — 일간 콘텐츠라 오늘 그룹 (2026-07-30 hans 재배치) */}
        <RunOfTheDayCard />
        </>)}

        {/* ── 주간 섹션 (2026-08-02: 라벨 대신 넓은 여백으로 구분) ── */}
        <div className="h-3" aria-hidden />
        {/* Phase A: 스트릭 경고를 주간 목표 카드 바로 위로 — 주간 정보 그룹핑 (경고+목표+스트릭) */}
        {!isNewRunner && (
          <div className="mx-4">
            <StreakWarningCard
              activities={activities}
              weeklyStreak={streak}
              weeklyGoal={weeklyRunGoal}
              thisWeekRunDays={thisWeekRunDays}
              freezeCount={freezes.count}
              freezeUses={freezes.uses}
              onFreezeUsed={loadFreezes}
            />
          </div>
        )}
        {/* 6.3 주간 목표 원탭 카드 (습관 코어 C2, 2026-07-11) — 신규 러너 모드에서도 렌더.
            Phase A: 최장 스트릭·기록 갱신 문구를 이 카드로 흡수 (인라인 주간 스트릭 카드 제거). */}
        <WeeklyGoalCard
          weeklyStreak={streak}
          maxStreak={maxStreak}
          isRecordBreaking={isRecordBreaking}
          weeksToRecord={weeksToRecord}
        />
        {!isNewRunner && secondaryMounted && <HomeChallengeCard />}
        {/* 주간 콘텐츠 재배치 (2026-07-30 hans): 경쟁 허브 (친구·동네·내 주변 러너 = 전부
            주간 랭킹) + 이번 주 우승자 맞히기를 함께 그룹에서 이번 주 그룹으로. */}
        {!isNewRunner && (<>
        <LazyMount minHeight={220} rootMargin="300px"><CompetitionHub /></LazyMount>
        <LazyMount minHeight={200} rootMargin="300px"><WinnerPredictionWidget /></LazyMount>
        </>)}

        {/* ── 월간 섹션 ── */}
        <div className="h-3" aria-hidden />
        {/* 6.1 이달 목표 */}
        <div className={`mx-4 card p-5 relative overflow-hidden ${goalKm > 0 && goalProgress >= 100 ? 'goal-achieved' : ''}`}>
          {goalKm > 0 && goalProgress >= 100 && (
            <div className="absolute inset-0 achievement-shimmer pointer-events-none" />
          )}
          <div className="relative">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-base font-semibold text-[var(--foreground)]">{t('home.monthGoal').replace('{month}', monthLabel)}</h3>
              <Link href="/goals" className="text-sm text-[var(--accent)] font-semibold flex items-center gap-0.5">
                {t('home.set')} <ChevronRight size={14} />
              </Link>
            </div>
            {/* P0-4 (2026-08-02): DAY 그리드에서 이관한 이달 누적 — 목표 유무와 무관하게 표시 */}
            <p className="text-sm text-[var(--muted)] mb-3 tabular-nums">
              {locale === 'en'
                ? `${toDisplayDistance(monthlyDistance, unit).toFixed(1)}${unitLabel(unit)} · ${monthlyRunDays} day${monthlyRunDays === 1 ? '' : 's'} this month`
                : `이달 ${toDisplayDistance(monthlyDistance, unit).toFixed(1)}${unitLabel(unit)} · ${monthlyRunDays}일 달림`}
            </p>
            {goalKm > 0 ? (
              <>
                {/* 2026-08-01 세련화: 굵은 바 안 흰 글씨·깃발 아이콘 → 큰 % 숫자 + 얇은 바.
                    파란 그라데이션은 브랜드 밖 색이라 emerald 단일 그라데이션으로. */}
                <div className="flex items-baseline justify-between mb-2">
                  <p className="text-2xl font-extrabold tracking-tight tabular-nums text-[var(--accent)]">
                    {goalProgress.toFixed(0)}<span className="text-base font-bold">%</span>
                  </p>
                  <span className="text-xs text-[var(--muted)]" dangerouslySetInnerHTML={{
                    __html: t('home.goalLabel').replace('{km}', `<span class='font-semibold text-[var(--foreground)]'>${goalKm}km</span>`)
                  }} />
                </div>
                <div className="bg-[var(--card-border)]/60 rounded-full h-2.5 overflow-hidden mb-2">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ease-out ${
                      goalProgress >= 100
                        ? 'bg-gradient-to-r from-emerald-400 to-emerald-500'
                        : 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                    }`}
                    style={{ width: `${goalProgress}%` }}
                  />
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
                  <p className="text-xs text-[var(--muted)] text-right">
                    {t('home.goalRemaining').replace('{remain}', goalRemaining.toFixed(1)).replace('{daily}', dailyNeeded.toFixed(1))}
                  </p>
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

            {/* 기본 챌린지 (42.195km) — 2026-08-02 hans: 월드런과 같은 메뉴이므로
                HomeWorldMarathonCard(월드런 허브) 안으로 통합 이동. 여기선 제거. */}
          </div>
        </div>

        {!isNewRunner && (<>
        {/* 이달의 페이스메이커 — 월 단위 1:1 매칭이라 이번 달 그룹 */}
        <MonthlyRivalCard />
        {secondaryMounted && <HomeWorldMarathonCard />}
        {recapSlot === 'season' && <SeasonRecapCard />}
        </>)}

        {/* 월 캘린더 (잔디) */}
        <div className="mx-4"><HomeCalendarCard /></div>

        {/* ── 함께 달리기 섹션 ── */}
        <div className="h-3" aria-hidden />
        {!isNewRunner && (<>
        {secondaryMounted && <HomeFriendStories />}
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

        {/* ── 내 기록 섹션 ── */}
        <div className="h-3" aria-hidden />
        {/* 미니맵 — LazyMount 없이 즉시 (사용자 신고: "지도 안 보임") */}
        <HomeMapPreview />
        {/* 2026-08-01 (hans): 그래프 복원 — 30일 추이·요일 패턴은 홈에서 바로.
            서버 조회 없음 (activities 로컬 계산). 깊은 분석은 아래 /stats 진입 카드. */}
        <LazyMount minHeight={200} rootMargin="300px"><HomeStatsGlance /></LazyMount>
        <LazyMount minHeight={140} rootMargin="300px"><OnThisDayCard /></LazyMount>
        </>)}
      </div>
      {/* ========== ② 통계 차트 묶음 ==========
          16 스트릭 → 17 PB → 18 일별30일 → 19 12주 → 20 페이스 → 21 요일 → 22 시간대
          → 23 기간별 상세 (+히스토리 링크) → 24 요약 4칩 → 25 최근 활동 */}
      {/* 상단 그룹과 리듬 통일 (2026-08-02 hans: 카드 간격 확대) */}
      <div className="p-4 pt-2 space-y-4">

      {/* 신규 러너 모드에선 16~24 (스트릭·PB·차트류·요약칩) 스킵 — 25 최근 활동만 렌더 */}
      {!isNewRunner && (<>
      {/* 16 주간 러닝 스트릭 — Phase A (build 327): 삭제. 연속 주·이번 주 진행·최장 기록이
          전부 주간 목표 카드(WeeklyGoalCard)와 중복이라 그쪽으로 흡수. */}

      {/* 17~23 차트 7종 — Phase B (build 327): /stats 전용 페이지로 이관 (StatsCharts).
          홈은 "오늘 뭐 하지"에 집중, 깊은 분석은 아래 진입 카드로. */}
      <Link
        href="/stats"
        className="card p-5 flex items-center gap-3 active:scale-[0.99] transition block"
      >
        <div className="w-11 h-11 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
          <BarChart3 size={20} className="text-emerald-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base font-extrabold text-[var(--foreground)]">{tt('내 기록 통계')}</p>
          <p className="text-xs text-[var(--muted)] mt-0.5">{tt('개인 베스트 · 추이 차트 · 기간별 비교')}</p>
        </div>
        <ChevronRight size={18} className="text-[var(--muted)]" />
      </Link>

      {/* 24 요약 4칩 — Phase A (build 327): 삭제. 주/월/년/통산 수치가 기간 상세 카드(#23)와
          전부 중복 (이번 달은 상단 통계 그리드에도) — 기간 상세의 탭이 같은 정보를 더 깊게 제공. */}
      </>)}

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
          <div className="text-center py-6 space-y-3">
            <p className="text-3xl">👟</p>
            <p className="text-sm font-medium text-[var(--foreground)]">{t('home.noActivityYet')}</p>
            {/* 2026-08-09: 첫 활동 없는 유저의 1차 CTA 를 "달리기 시작" 으로. 건강 연동은 보조. */}
            <Link href="/track" className="block mx-auto max-w-[220px] py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-bold text-sm">
              🏃 {t('home.startFirstRunCta')}
            </Link>
            <Link href="/connect" className="text-xs text-[var(--muted)] font-semibold inline-block">
              {t('home.connectHealthCta')}
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {recentActivities.map(a => (
              <Link
                key={a.id}
                href={`/activity?id=${a.id}`}
                className="flex items-center gap-3 p-3 rounded-xl hover:bg-[var(--card-border)]/50 active:bg-[var(--card-border)]/40 transition-colors"
              >
                <div className="w-9 h-9 rounded-lg bg-[var(--accent)]/10 flex items-center justify-center text-[var(--accent)]">
                  {a.source === 'gps' ? <MapPin size={16} /> : <Zap size={16} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--foreground)]">
                    {toDisplayDistance(a.distance_km, unit).toFixed(2)} {unitLabel(unit)}
                    {/* build 296: 걷기 배지 — 러닝 합계에서 빠지는 이유를 목록에서 보이게 (hans 신고: 4건 보이는데 합계 3건) */}
                    {a.activity_type === 'walking' && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded-md bg-sky-100 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 text-[12px] font-bold align-middle">
                        🚶 {tt('걷기')}
                      </span>
                    )}
                    {a.duration_seconds && (
                      <span className="text-[var(--muted)] font-normal ml-2 text-sm">
                        {formatDuration(a.duration_seconds)}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {(() => {
                      // 'YYYY-MM-DD' UTC 파싱 금지 — 로컬 자정으로 생성 후 표시
                      const [ay, am, ad] = a.activity_date.split('-').map(Number);
                      return new Date(ay, am - 1, ad).toLocaleDateString(locale === 'en' ? 'en-US' : 'ko-KR', { month: 'short', day: 'numeric', weekday: 'short' });
                    })()}
                    {a.pace_avg_sec_per_km ? ` · ${formatPaceForUnit(a.pace_avg_sec_per_km, unit)}${paceUnitLabel(unit)}` : ''}
                  </p>
                </div>
                <ChevronRight size={14} className="text-[var(--muted)]" />
              </Link>
            ))}
          </div>
        )}
      </div>
      </LazyMount>

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
