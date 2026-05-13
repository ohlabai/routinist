// 클럽 단체 코스 챌린지 (build 118 — 클럽 마라톤).
// 클럽 멤버 km 합산으로 가상 코스 도전.

import { getSupabase } from './supabase';
import type { PreviewPoint } from './world-data';

export interface ClubCourse {
  course_id: string;
  name: string;
  country: string | null;
  description: string | null;
  distance_km: number;
  preview_path: PreviewPoint[] | null;
  started_at: string;
  completed_at: string | null;
  total_km: number;
  contributors: number;
}

export interface ClubCourseLeaderRow {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  contributed_km: number;
  rank: number;
}

export async function startClubCourse(clubId: string, courseId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('start_club_course', { p_club_id: clubId, p_course_id: courseId });
  if (error) throw error;
}

export async function fetchClubCourses(clubId: string): Promise<ClubCourse[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('fetch_club_courses', { p_club_id: clubId });
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    course_id: r.course_id as string,
    name: r.name as string,
    country: (r.country as string) ?? null,
    description: (r.description as string) ?? null,
    distance_km: Number(r.distance_km ?? 0),
    preview_path: (r.preview_path as PreviewPoint[]) ?? null,
    started_at: r.started_at as string,
    completed_at: (r.completed_at as string) ?? null,
    total_km: Number(r.total_km ?? 0),
    contributors: Number(r.contributors ?? 0),
  }));
}

export async function fetchClubCourseLeaderboard(clubId: string, courseId: string): Promise<ClubCourseLeaderRow[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('fetch_club_course_leaderboard', { p_club_id: clubId, p_course_id: courseId });
  if (error) throw error;
  return (data ?? []) as ClubCourseLeaderRow[];
}
