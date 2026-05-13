// 동네 러너 검색 (build 116 A 패키지).
// region 매칭으로 안전한 친구 찾기. GPS 정확도 X (privacy).

import { getSupabase } from './supabase';

export type NearbyScope = 'dong' | 'gu' | 'si' | 'national';

export interface NearbyRunner {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  region_si: string | null;
  region_gu: string | null;
  region_dong: string | null;
  bio: string | null;
  birth_year: number | null;
  gender: 'male' | 'female' | null;
  show_gender: boolean;
  total_runs: number;
  total_distance_km: number;
  runs_30d: number;
  km_30d: number;
  last_active: string | null;
}

export const SCOPE_LABEL: Record<NearbyScope, string> = {
  dong: '같은 동',
  gu: '같은 구',
  si: '같은 시',
  national: '전국',
};

export const SCOPE_DESC: Record<NearbyScope, string> = {
  dong: '걸어서 만날 수 있는 거리',
  gu: '같은 자치구',
  si: '같은 시/도',
  national: '전국',
};

export async function fetchNearbyRunners(scope: NearbyScope = 'gu', limit = 50): Promise<NearbyRunner[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('fetch_nearby_runners', {
    p_scope: scope,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    user_id: r.user_id as string,
    display_name: r.display_name as string,
    avatar_url: (r.avatar_url as string) ?? null,
    region_si: (r.region_si as string) ?? null,
    region_gu: (r.region_gu as string) ?? null,
    region_dong: (r.region_dong as string) ?? null,
    bio: (r.bio as string) ?? null,
    birth_year: (r.birth_year as number) ?? null,
    gender: (r.gender as 'male' | 'female') ?? null,
    show_gender: (r.show_gender as boolean) ?? true,
    total_runs: Number(r.total_runs ?? 0),
    total_distance_km: Number(r.total_distance_km ?? 0),
    runs_30d: Number(r.runs_30d ?? 0),
    km_30d: Number(r.km_30d ?? 0),
    last_active: (r.last_active as string) ?? null,
  }));
}

export async function toggleShowGender(show: boolean): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('toggle_show_gender', { p_show: show });
  if (error) throw error;
}

// 페이스 매칭 (build 118) — 비슷한 페이스의 러너 추천
export interface PaceMatchedRunner {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  region_gu: string | null;
  gender: 'male' | 'female' | null;
  show_gender: boolean;
  avg_pace_sec: number;
  pace_diff_sec: number;
  runs_30d: number;
  km_30d: number;
}

export async function fetchPaceMatchedRunners(rangeSec = 15): Promise<PaceMatchedRunner[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('fetch_pace_matched_runners', { p_range_sec: rangeSec });
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    user_id: r.user_id as string,
    display_name: r.display_name as string,
    avatar_url: (r.avatar_url as string) ?? null,
    region_gu: (r.region_gu as string) ?? null,
    gender: (r.gender as 'male' | 'female') ?? null,
    show_gender: (r.show_gender as boolean) ?? true,
    avg_pace_sec: Number(r.avg_pace_sec ?? 0),
    pace_diff_sec: Number(r.pace_diff_sec ?? 0),
    runs_30d: Number(r.runs_30d ?? 0),
    km_30d: Number(r.km_30d ?? 0),
  }));
}

// 페이스 포맷 — 357 → "5'57""
export function formatPace(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}'${String(s).padStart(2, '0')}"`;
}
