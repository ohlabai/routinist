// 세계를 달려! (Virtual Course) — RPC wrapper.

import { getSupabase } from './supabase';

export interface VirtualCourse {
  id: string;
  name: string;
  distance_km: number;
  country: string | null;
  description: string | null;
  hero_image_url: string | null;
  is_active?: boolean;
  sort_order?: number;
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

export async function fetchAvailableCourses(): Promise<VirtualCourse[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('virtual_courses')
    .select('id, name, distance_km, country, description, hero_image_url, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as VirtualCourse[];
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

export async function adminListAllCourses(): Promise<VirtualCourse[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('virtual_courses')
    .select('id, name, distance_km, country, description, hero_image_url, is_active, sort_order')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as VirtualCourse[];
}
