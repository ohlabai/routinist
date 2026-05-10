import { getSupabase } from './supabase';
import type { Activity } from '@/types';

interface FetchRoutesOptions {
  year?: number;
  month?: number;
  /** 최근 N 일 — year/month 없을 때 사용. 'all' 모드면 undefined. */
  daysBack?: number;
  /** 페이지 크기. 기본 1000 (이전 200 은 활동 많은 사용자 옛날 경로 누락). */
  pageSize?: number;
  /** offset (페이지네이션). 기본 0. */
  offset?: number;
}

export async function fetchRoutesForUser(
  userId: string,
  options: FetchRoutesOptions = {},
): Promise<Activity[]> {
  const supabase = getSupabase();
  const pageSize = options.pageSize ?? 1000;
  const offset = options.offset ?? 0;

  let query = supabase
    .from('activities')
    .select('id, activity_date, distance_km, duration_seconds, route_data')
    .eq('user_id', userId)
    .not('route_data', 'is', null)
    .order('activity_date', { ascending: false });

  if (options.year && options.month) {
    const { year, month } = options;
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endMonth = month === 12 ? 1 : month + 1;
    const endYear = month === 12 ? year + 1 : year;
    const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;
    query = query.gte('activity_date', startDate).lt('activity_date', endDate);
  } else if (typeof options.daysBack === 'number') {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - options.daysBack);
    query = query.gte('activity_date', cutoff.toISOString().slice(0, 10));
  }

  const { data, error } = await query.range(offset, offset + pageSize - 1);
  if (error) throw error;
  return (data || []) as Activity[];
}
