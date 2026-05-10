import { getSupabase } from './supabase';
import type { Activity, UserMonthlyGoal } from '@/types';
import { todayStr, daysAgoStr } from './kst';

// ===== Activities =====

export async function fetchActivities(userId: string): Promise<Activity[]> {
  const all: Activity[] = [];
  let from = 0;
  const PAGE = 1000;

  while (true) {
    const { data, error } = await getSupabase()
      .from('activities')
      .select('*')
      .eq('user_id', userId)
      .order('activity_date', { ascending: false })
      .range(from, from + PAGE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    all.push(...data.map(a => ({
      ...a,
      distance_km: Number(a.distance_km),
    } as Activity)));

    if (data.length < PAGE) break;
    from += PAGE;
  }

  return all;
}

export async function fetchActivitiesForMonth(userId: string, year: number, month: number): Promise<Activity[]> {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`;

  const { data, error } = await getSupabase()
    .from('activities')
    .select('*')
    .eq('user_id', userId)
    .gte('activity_date', startDate)
    .lt('activity_date', endDate)
    .order('activity_date', { ascending: false });

  if (error) throw error;
  return (data || []).map(a => ({
    ...a,
    distance_km: Number(a.distance_km),
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
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay()); // 일요일 시작
  startOfWeek.setHours(0, 0, 0, 0);

  return activities.filter(a => new Date(a.activity_date) >= startOfWeek);
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
