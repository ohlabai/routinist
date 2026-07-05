// 동네 러너 검색 (build 116 A 패키지).
// region 매칭으로 안전한 친구 찾기. GPS 정확도 X (privacy).

import { getSupabase } from './supabase';

// build 293: 'country' 스코프 추가 (콜드스타트·글로벌) — profiles.country_code 매칭.
// 'national' 은 RPC 무필터 = 사실상 전 세계라 라벨을 '전 세계' 로 정정.
export type NearbyScope = 'dong' | 'gu' | 'si' | 'country' | 'national';

// 한국 행정구역(region_si/gu/dong) 입력이 필요한 스코프 — country/national 은 지역 미설정도 검색 가능.
export function scopeNeedsRegion(scope: NearbyScope): boolean {
  return scope === 'dong' || scope === 'gu' || scope === 'si';
}

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

// build 245 사용자 피드백 #5: "같은 시" 가 실제로는 시·도(경기도) 매칭이라 혼동.
// 한국 행정구역 표기 (시·도 / 시·군·구 / 읍·면·동) 그대로 사용 — 데이터 컬럼 의미와 라벨 일치.
// region_si 컬럼 = 시·도 (서울특별시 / 경기도 / 부산광역시)
// region_gu 컬럼 = 시·군·구 (강남구 / 성남시 / 분당구 — 데이터 normalization 추후 필요)
// region_dong 컬럼 = 읍·면·동 (역삼동 / 야탑동)
export const SCOPE_LABEL: Record<NearbyScope, string> = {
  dong: '같은 읍·면·동',
  gu: '같은 시·군·구',
  si: '같은 시·도',
  country: '같은 나라',
  national: '전 세계',
};

export const SCOPE_DESC: Record<NearbyScope, string> = {
  dong: '걸어서 만날 수 있는 거리',
  gu: '같은 자치구·시·군',
  si: '같은 광역시·도 (서울특별시·경기도 등)',
  country: '같은 나라에서 달리는 러너',
  national: '전 세계 러너 모두',
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

// build 293: 글로벌 fallback — 이번 주(7일) 활동이 있는 전 세계 공개 러너 상위 N.
// 지역 매칭이 0명인 신규 시장/해외 유저에게 빈 화면 대신 "전 세계 러너" 를 보여주기 위함.
// fetch_nearby_runners('national') 재사용 (30일 km 많은 순 정렬) + last_active 7일 필터.
export async function fetchActiveGlobalRunners(limit = 8): Promise<NearbyRunner[]> {
  const all = await fetchNearbyRunners('national', 50);
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return all
    .filter(r => r.last_active && new Date(r.last_active).getTime() >= weekAgo)
    .slice(0, limit);
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
