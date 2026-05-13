// 세계를 달려! (Virtual Course) — RPC wrapper.

import { getSupabase } from './supabase';

export interface PreviewPoint { x: number; y: number; }

export type Continent = 'asia' | 'europe' | 'americas' | 'oceania' | 'africa' | 'global';
export const CONTINENT_LABEL: Record<Continent, string> = {
  asia: '아시아',
  europe: '유럽',
  americas: '미주',
  oceania: '오세아니아',
  africa: '아프리카',
  global: '글로벌',
};
export const CONTINENT_EMOJI: Record<Continent, string> = {
  asia: '🌏',
  europe: '🇪🇺',
  americas: '🇺🇸',
  oceania: '🇦🇺',
  africa: '🌍',
  global: '🌐',
};

export interface ElevationPoint { km: number; m: number; }
export interface Landmark { km: number; name: string; description?: string; }
export interface PastWinner { year: number; name: string; time: string; notes?: string; }
export interface RealLatLng { lat: number; lng: number; }

export interface VirtualCourse {
  id: string;
  name: string;
  distance_km: number;
  country: string | null;
  description: string | null;
  hero_image_url: string | null;
  preview_path: PreviewPoint[] | null;
  real_path: RealLatLng[] | null;  // 실제 GPS 좌표 (Google Maps 통합용)
  entry_fee_p: number;
  continent: Continent | null;
  series_id?: string | null;
  story: string | null;
  past_winners: PastWinner[] | null;
  youtube_url: string | null;
  official_url: string | null;
  elevation_profile: ElevationPoint[] | null;
  landmarks: Landmark[] | null;
  course_record: string | null;
  is_active?: boolean;
  sort_order?: number;
}

export interface CourseRunner {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  region_gu: string | null;
  progress_km: number;
  ratio: number;
  completed_at: string | null;
  started_at: string;
}

export interface MedalStatus {
  course_id: string;
  awarded_at: string | null;
  requested_at: string | null;
  request_status: 'none' | 'requested' | 'paid' | 'shipped' | 'delivered' | 'cancelled';
  shipping_name: string | null;
  shipping_address: string | null;
  payment_amount: number | null;
}

export interface MedalShippingForm {
  shipping_name: string;
  shipping_phone: string;
  shipping_address: string;
  shipping_zipcode: string;
  payment_amount?: number;
}

export interface MyCourse {
  course_id: string;
  name: string;
  country: string | null;
  description: string | null;
  hero_image_url: string | null;
  distance_km: number;
  started_at: string;
  completed_at: string | null;
  progress_km: number;
  has_medal: boolean;
}

const COURSE_FIELDS_LIST = 'id, name, distance_km, country, description, hero_image_url, preview_path, entry_fee_p, continent, series_id, sort_order';
const COURSE_FIELDS_FULL = 'id, name, distance_km, country, description, hero_image_url, preview_path, real_path, entry_fee_p, continent, story, past_winners, youtube_url, official_url, elevation_profile, landmarks, course_record';

export async function fetchAvailableCourses(): Promise<VirtualCourse[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('virtual_courses')
    .select(COURSE_FIELDS_LIST)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as VirtualCourse[];
}

// 코스 단일 정보 (상세 sheet 용) — 풍부한 데이터
export async function fetchCourseById(courseId: string): Promise<VirtualCourse | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('virtual_courses')
    .select(COURSE_FIELDS_FULL)
    .eq('id', courseId)
    .maybeSingle();
  if (error) throw error;
  return data as VirtualCourse | null;
}

// 라이브 트래커 — 같은 코스 참가자들의 현재 진행 위치
export async function fetchCourseRunners(courseId: string): Promise<CourseRunner[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('fetch_course_runners', { p_course_id: courseId });
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    user_id: r.user_id as string,
    display_name: r.display_name as string,
    avatar_url: (r.avatar_url as string) ?? null,
    region_gu: (r.region_gu as string) ?? null,
    progress_km: Number(r.progress_km ?? 0),
    ratio: Number(r.ratio ?? 0),
    completed_at: (r.completed_at as string) ?? null,
    started_at: r.started_at as string,
  }));
}

export async function fetchMyMedalStatus(courseId: string): Promise<MedalStatus | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('fetch_my_medal_status', { p_course_id: courseId });
  if (error) throw error;
  const row = (data ?? [])[0];
  return row ? (row as MedalStatus) : null;
}

export async function requestCourseMedal(courseId: string, form: MedalShippingForm): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('request_course_medal', {
    p_course_id: courseId,
    p_shipping_name: form.shipping_name,
    p_shipping_phone: form.shipping_phone,
    p_shipping_address: form.shipping_address,
    p_shipping_zipcode: form.shipping_zipcode,
    p_payment_amount: form.payment_amount ?? 30000,
  });
  if (error) throw error;
}

export async function fetchMyCourses(): Promise<MyCourse[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('fetch_my_courses');
  if (error) throw error;
  return (data ?? []) as MyCourse[];
}

export async function startCourse(courseId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('start_course', { p_course_id: courseId });
  if (error) throw error;
}

// admin
export interface CourseUpsert {
  id?: string;
  name: string;
  distance_km: number;
  country?: string | null;
  description?: string | null;
  hero_image_url?: string | null;
  continent?: Continent | null;
  entry_fee_p?: number;
  story?: string | null;
  youtube_url?: string | null;
  official_url?: string | null;
  course_record?: string | null;
  past_winners?: PastWinner[] | null;
  landmarks?: Landmark[] | null;
  real_path?: RealLatLng[] | null;
  preview_path?: PreviewPoint[] | null;
  elevation_profile?: ElevationPoint[] | null;
  is_active?: boolean;
  sort_order?: number;
}

export async function adminUpsertCourse(row: CourseUpsert): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from('virtual_courses').upsert({
    ...row,
    is_active: row.is_active ?? true,
    sort_order: row.sort_order ?? 0,
  });
  if (error) throw error;
}

export interface CourseSeries {
  series_id: string;
  slug: string;
  name: string;
  description: string | null;
  emoji: string | null;
  course_count: number;
  my_completed: number;
  total_distance_km: number;
}

export async function fetchCourseSeries(): Promise<CourseSeries[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('fetch_course_series');
  if (error) throw error;
  return (data ?? []) as CourseSeries[];
}

export async function adminListAllCourses(): Promise<VirtualCourse[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('virtual_courses')
    .select('id, name, distance_km, country, description, hero_image_url, continent, entry_fee_p, story, youtube_url, official_url, course_record, past_winners, landmarks, real_path, preview_path, elevation_profile, is_active, sort_order')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as VirtualCourse[];
}
