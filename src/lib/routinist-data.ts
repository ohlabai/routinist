import { getSupabase } from './supabase';
import type { Activity, UserMonthlyGoal } from '@/types';
import { todayStr, daysAgoStr, startOfWeekStr, toLocalDateStr } from './kst';

// ===== Activities =====

// build 167 #1: build 162 의 route_data 포함 fetch 가 홈 로딩 회귀 (297회 × GPS 수천 점 = 페이로드 폭증).
// 다시 lite fetch (route_data 제외) 로 — 홈/통계/캘린더는 route_data 안 씀.
// ShareCard/activity 상세에선 fetchActivityRoute 로 단건 lazy fetch (이미 activity/page.tsx 패턴).
//
// build 167 #2: 같은 activity_date 의 tiebreaker — started_at desc → created_at desc.
// 하루 2번 뛰었을 때 최신이 위로 (이전엔 DB가 임의 정렬해서 첫 번째 뛴 게 최근으로 표시되는 버그).
// build 168 fix: build 167 의 exercise_type/updated_at 은 DB에 없는 컬럼 → PostgREST 가 select 거부.
// 실제 DB 컬럼: activity_type, active_energy_kcal. updated_at 없음.
const ACTIVITY_LITE_COLS =
  'id,user_id,activity_date,distance_km,duration_seconds,pace_avg_sec_per_km,calories,heart_rate_avg,heart_rate_max,active_energy_kcal,memo,source,visibility,started_at,ended_at,activity_type,created_at,hr_zones';

export async function fetchActivities(userId: string): Promise<Activity[]> {
  const all: Activity[] = [];
  let from = 0;
  const PAGE = 1000;

  while (true) {
    const { data, error } = await getSupabase()
      .from('activities')
      .select(ACTIVITY_LITE_COLS)
      .eq('user_id', userId)
      .order('activity_date', { ascending: false })
      .order('started_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    all.push(...data.map(a => ({
      ...a,
      distance_km: Number(a.distance_km),
      route_data: null,
      map_snapshot_url: null,
    } as Activity)));

    if (data.length < PAGE) break;
    from += PAGE;
  }

  return all;
}

// 활동 상세 단건의 route_data 조회 — build 161 시절 lazy fetch 경로.
// 현재는 fetchActivities 가 route_data 를 함께 가져오지만, 호출부 호환 유지를 위해 남겨둠.
export async function fetchActivityRoute(activityId: string): Promise<{ route_data: import('@/types').GeoJSONLineString | null } | null> {
  const { data, error } = await getSupabase()
    .from('activities')
    .select('route_data')
    .eq('id', activityId)
    .maybeSingle();
  if (error) return null;
  return data as { route_data: import('@/types').GeoJSONLineString | null } | null;
}

// build 222 #3: 저장 직후 router.push 직진 시 UserDataProvider 캐시가 아직 stale → "찾을 수 없음" 회귀 fix.
// 캐시 miss 일 때 단건 DB fetch 폴백.
export async function fetchActivityById(activityId: string): Promise<Activity | null> {
  const { data, error } = await getSupabase()
    .from('activities')
    .select(`${ACTIVITY_LITE_COLS},route_data`)
    .eq('id', activityId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    ...data,
    distance_km: Number(data.distance_km),
    map_snapshot_url: null,
  } as Activity;
}

export async function fetchActivitiesForMonth(userId: string, year: number, month: number): Promise<Activity[]> {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`;

  const { data, error } = await getSupabase()
    .from('activities')
    .select(ACTIVITY_LITE_COLS)
    .eq('user_id', userId)
    .gte('activity_date', startDate)
    .lt('activity_date', endDate)
    .order('activity_date', { ascending: false })
    .order('started_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(a => ({
    ...a,
    distance_km: Number(a.distance_km),
    route_data: null,
    map_snapshot_url: null,
  } as Activity));
}

export async function addActivity(
  userId: string,
  activityDate: string,
  distanceKm: number,
  durationSeconds?: number,
  memo?: string,
  source: Activity['source'] = 'manual',
  routeData?: Activity['route_data'],
  startedAt?: string,
  endedAt?: string,
): Promise<Activity> {
  const paceAvg = durationSeconds && distanceKm > 0
    ? Math.round(durationSeconds / distanceKm)
    : null;

  const { data, error } = await getSupabase()
    .from('activities')
    .insert({
      user_id: userId,
      activity_date: activityDate,
      distance_km: distanceKm,
      duration_seconds: durationSeconds || null,
      pace_avg_sec_per_km: paceAvg,
      memo: memo || null,
      source,
      route_data: routeData || null,
      started_at: startedAt || null,
      ended_at: endedAt || null,
    })
    .select()
    .single();

  if (error) throw error;
  return { ...data, distance_km: Number(data.distance_km) } as Activity;
}

export async function deleteActivity(activityId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('activities')
    .delete()
    .eq('id', activityId);

  if (error) throw error;
}

// ===== Monthly Goals =====

export async function fetchMonthlyGoals(userId: string): Promise<UserMonthlyGoal[]> {
  const { data, error } = await getSupabase()
    .from('monthly_goals')
    .select('*')
    .eq('user_id', userId)
    .order('year')
    .order('month');

  if (error) throw error;
  return (data || []).map(g => ({
    ...g,
    goal_km: Number(g.goal_km),
  } as UserMonthlyGoal));
}

export async function setMonthlyGoal(userId: string, year: number, month: number, goalKm: number): Promise<void> {
  const { data: existing } = await getSupabase()
    .from('monthly_goals')
    .select('id')
    .eq('user_id', userId)
    .eq('year', year)
    .eq('month', month)
    .single();

  if (existing) {
    const { error } = await getSupabase()
      .from('monthly_goals')
      .update({ goal_km: goalKm })
      .eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await getSupabase()
      .from('monthly_goals')
      .insert({ user_id: userId, year, month, goal_km: goalKm });
    if (error) throw error;
  }
}

// ===== 통계 유틸 =====

// build 291: 거리 지표 (오늘/이달/주간 도전/목표) 는 러닝만 집계.
// 걷기 opt-in 유저의 산책 km 를 도전·목표에서 제외 (사용자 신고 — 홈 '이번 주 도전' 걷기 포함).
// activity_type='walking' 만 제외. NULL 은 러닝으로 간주 — 구버전 (≤1.2.5) 앱이 무표기로 넣은
// 걷기는 서버에서 식별 불가한 한계 (v1.2.6 보급 전까지 잔존).
// 달력·기록 목록은 걷기도 계속 표시 (필터는 거리 지표 전용).
export function runningOnly(activities: Activity[]): Activity[] {
  return activities.filter(a => a.activity_type !== 'walking');
}

export function getMonthlyDistance(activities: Activity[], year: number, month: number): number {
  // activity_date 는 'YYYY-MM-DD' 로컬 날짜 문자열 — new Date() UTC 파싱 후 로컬 getter 를 쓰면
  // UTC 서쪽 timezone 에서 하루 밀림. 문자열 prefix 비교가 정확.
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  return runningOnly(activities)
    .filter(a => a.activity_date.slice(0, 7) === ym)
    .reduce((sum, a) => sum + a.distance_km, 0);
}

export function getWeeklyActivities(activities: Activity[]): Activity[] {
  // 주 시작 = 월요일 (KST). 일요일이 한 주의 마지막 날. activity_date 는 'YYYY-MM-DD' 문자열 (KST)
  // 이라 string 비교가 정확. startOfWeekStr 은 사용자 timezone 의 그 주 월요일을 반환.
  // build 291: 주간 도전 은 러닝만
  const monday = startOfWeekStr();
  return runningOnly(activities).filter(a => a.activity_date >= monday);
}

// 스트릭 보호권 (습관 형성): freezeDates 는 보호권으로 지킨 날 ('YYYY-MM-DD' Set) — 달린 날로 간주.
// optional 파라미터라 기존 호출부 (미전달) 는 동작 완전 동일 (하위호환 필수 — 호출부 많음).
function mergeRunDates(activities: Activity[], freezeDates?: Set<string>): string[] {
  const set = new Set(activities.map(a => a.activity_date));
  if (freezeDates) freezeDates.forEach(d => set.add(d));
  return [...set];
}

export function getMaxStreak(activities: Activity[], freezeDates?: Set<string>): number {
  if (activities.length === 0) return 0;
  const dates = mergeRunDates(activities, freezeDates).sort();
  let maxStreak = 1;
  let currentStreak = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1]);
    const curr = new Date(dates[i]);
    const diff = (curr.getTime() - prev.getTime()) / 86400000;
    if (diff === 1) {
      currentStreak++;
      if (currentStreak > maxStreak) maxStreak = currentStreak;
    } else {
      currentStreak = 1;
    }
  }
  return maxStreak;
}

export function getStreak(activities: Activity[], freezeDates?: Set<string>): number {
  if (activities.length === 0) return 0;

  const dates = mergeRunDates(activities, freezeDates).sort().reverse();
  const today = todayStr();
  const yesterday = daysAgoStr(1);

  // 오늘이나 어제 달렸어야 스트릭 유지
  if (dates[0] !== today && dates[0] !== yesterday) return 0;

  let streak = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1]);
    const curr = new Date(dates[i]);
    const diff = (prev.getTime() - curr.getTime()) / 86400000;
    if (diff === 1) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

// ===== 주간 스트릭 (습관 코어 C1, 2026-07-11) =====
// 배경: 유저 전원이 주 2~4회 러너 (매일 러너 0명) — 일 단위 스트릭 보유자 62명 중 2명뿐이라
// 스트릭 장치 (경고 카드·보호권·streak_risk push) 가 전부 공회전. 주 단위로 전환.
//
// 정의:
//  - 주 = 사용자 timezone 월요일~일요일 (startOfWeekStr 과 동일 기준). 주 키 = 그 주 월요일 'YYYY-MM-DD'.
//  - 달성 주 = 그 주의 러닝 일수 (같은 날 2회 러닝 = 1회, 걷기 제외) ≥ max(1, weeklyGoal ?? 1).
//  - 스트릭 = 이번 주 또는 지난주에 끝나는 연속 달성 주 수.
//    이번 주가 아직 미달성이어도 지난주까지 이어져 있으면 유지 — 이번 주가 끝나기 전까진 안 끊김.
//  - 보호권 재해석: 사용일 (freezeDates, 'YYYY-MM-DD') 이 포함된 주는 통째로 달성 취급
//    (빈 주 1개 = 보호권 1개. 기존 get_my_streak_freezes/use_streak_freeze RPC 계약 그대로 재사용).
// DB 대응물: enqueue_streak_risk_pushes (20260711130000_weekly_streak_push.sql) — 반드시 동일 정의 유지.

// 주어진 'YYYY-MM-DD' 가 속한 주의 월요일. 로컬 자정 Date 생성 — UTC 파싱 밀림 없음.
export function weekStartOf(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const offset = (dt.getDay() + 6) % 7; // 월=0 … 일=6
  return toLocalDateStr(new Date(y, m - 1, d - offset));
}

// 'YYYY-MM-DD' + n일. setDate 오버플로 처리로 월/년 경계 자동.
export function addDaysStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return toLocalDateStr(new Date(y, m - 1, d + n));
}

// 달성 주 집합 (주 키 = 월요일 'YYYY-MM-DD').
function achievedWeekSet(
  activities: Activity[],
  weeklyGoal: number | null | undefined,
  freezeDates?: Set<string>,
): Set<string> {
  const goal = Math.max(1, weeklyGoal ?? 1);
  const daysByWeek = new Map<string, Set<string>>();
  runningOnly(activities).forEach(a => {
    const wk = weekStartOf(a.activity_date);
    let days = daysByWeek.get(wk);
    if (!days) { days = new Set(); daysByWeek.set(wk, days); }
    days.add(a.activity_date);
  });
  const achieved = new Set<string>();
  daysByWeek.forEach((days, wk) => { if (days.size >= goal) achieved.add(wk); });
  // 보호권 사용일이 있는 주는 목표와 무관하게 달성 취급 (빈 주 메꿈)
  freezeDates?.forEach(d => achieved.add(weekStartOf(d)));
  return achieved;
}

// 현재 주간 스트릭. 이번 주 달성 시 이번 주 포함, 미달성이면 지난주 앵커로 계산 (끊김 유예).
export function getWeeklyStreak(
  activities: Activity[],
  weeklyGoal: number | null | undefined,
  freezeDates?: Set<string>,
): number {
  const achieved = achievedWeekSet(activities, weeklyGoal, freezeDates);
  if (achieved.size === 0) return 0;
  const thisWeek = startOfWeekStr();
  let anchor = achieved.has(thisWeek) ? thisWeek : addDaysStr(thisWeek, -7);
  let streak = 0;
  while (achieved.has(anchor)) {
    streak++;
    anchor = addDaysStr(anchor, -7);
  }
  return streak;
}

// 역대 최장 주간 스트릭 (달성 주 목록에서 7일 간격 연속 run 최대 길이).
export function getMaxWeeklyStreak(
  activities: Activity[],
  weeklyGoal: number | null | undefined,
  freezeDates?: Set<string>,
): number {
  const achieved = achievedWeekSet(activities, weeklyGoal, freezeDates);
  if (achieved.size === 0) return 0;
  const weeks = [...achieved].sort();
  let max = 1;
  let cur = 1;
  for (let i = 1; i < weeks.length; i++) {
    if (addDaysStr(weeks[i - 1], 7) === weeks[i]) {
      cur++;
      if (cur > max) max = cur;
    } else {
      cur = 1;
    }
  }
  return max;
}

// 이번 주 러닝 일수 (m/goal 진행 표시용 — 같은 날 2회 러닝 = 1회, 걷기 제외).
export function getThisWeekRunDays(activities: Activity[]): number {
  const monday = startOfWeekStr();
  return new Set(
    runningOnly(activities)
      .filter(a => a.activity_date >= monday)
      .map(a => a.activity_date)
  ).size;
}

export function getTotalDistance(activities: Activity[]): number {
  return activities.reduce((sum, a) => sum + a.distance_km, 0);
}

export function formatPace(secPerKm: number): string {
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}'${String(sec).padStart(2, '0')}"`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// 2026-07-18 (hans): 러닝 시작 시각 라벨 — "몇 시에 뛰었나" 는 새벽 러너의 자부심 포인트.
// 완료 시각이 아니라 시작 시각인 이유: 새벽 러닝의 정체성은 출발 시각에 있고 (5:30 출발 >
// 6:15 완료), Strava/NRC 관례도 시작 시각. 시간대 이모지로 동기부여 강화.
export function startTimeLabel(
  startedAt: string | null | undefined,
  locale: 'ko' | 'en',
  short = false,   // 공유카드용 — 이모지 + 24h HH:MM (좁은 컬럼에 맞춤)
): string | null {
  if (!startedAt) return null;
  const d = new Date(startedAt);
  if (isNaN(d.getTime())) return null;
  const h = d.getHours();
  const emoji = h < 4 ? '🌙' : h < 7 ? '🌅' : h < 11 ? '☀️' : h < 17 ? '🌤️' : h < 21 ? '🌆' : '🌙';
  if (short) {
    return `${emoji} ${String(h).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const time = d.toLocaleTimeString(locale === 'en' ? 'en-US' : 'ko-KR', { hour: 'numeric', minute: '2-digit' });
  return `${emoji} ${time}`;
}
