import { getSupabase } from './supabase';
import type { Activity, UserMonthlyGoal } from '@/types';
import { todayStr, daysAgoStr, startOfWeekStr } from './kst';

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
  'id,user_id,activity_date,distance_km,duration_seconds,pace_avg_sec_per_km,calories,heart_rate_avg,heart_rate_max,active_energy_kcal,memo,source,visibility,started_at,ended_at,activity_type,created_at';

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

export function getMonthlyDistance(activities: Activity[], year: number, month: number): number {
  return activities
    .filter(a => {
      const d = new Date(a.activity_date);
      return d.getFullYear() === year && d.getMonth() + 1 === month;
    })
    .reduce((sum, a) => sum + a.distance_km, 0);
}

export function getWeeklyActivities(activities: Activity[]): Activity[] {
  // 주 시작 = 월요일 (KST). 일요일이 한 주의 마지막 날. activity_date 는 'YYYY-MM-DD' 문자열 (KST)
  // 이라 string 비교가 정확. startOfWeekStr 은 사용자 timezone 의 그 주 월요일을 반환.
  const monday = startOfWeekStr();
  return activities.filter(a => a.activity_date >= monday);
}

export function getMaxStreak(activities: Activity[]): number {
  if (activities.length === 0) return 0;
  const dates = [...new Set(activities.map(a => a.activity_date))].sort();
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

export function getStreak(activities: Activity[]): number {
  if (activities.length === 0) return 0;

  const dates = [...new Set(activities.map(a => a.activity_date))].sort().reverse();
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
