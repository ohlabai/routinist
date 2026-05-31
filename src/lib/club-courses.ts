// build 232: 클럽 월드런 챌린지 (거리 합산형 릴레이) RPC wrapper.
// 백엔드는 fetch_club_courses / start_club_course / fetch_club_course_leaderboard /
// enqueue_club_course_pushes 가 이미 완성돼 있음 (build 88~). UI 만 신규.

import { getSupabase } from './supabase';

export interface ClubCourse {
  course_id: string;
  name: string;
  country: string | null;
  description: string | null;
  distance_km: number;
  preview_path: unknown;   // jsonb (PreviewPoint[])
  started_at: string;
  completed_at: string | null;
  total_km: number;
  contributors: number;
}

export interface ClubCourseLeaderboardRow {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  contributed_km: number;
  rank: number;
}

export async function fetchClubCourses(clubId: string): Promise<ClubCourse[]> {
  const { data, error } = await getSupabase().rpc('fetch_club_courses', { p_club_id: clubId });
  if (error) {
    console.warn('[club-courses] fetchClubCourses fail', error);
    return [];
  }
  return ((data ?? []) as ClubCourse[]).map(r => ({
    ...r,
    distance_km: Number(r.distance_km),
    total_km: Number(r.total_km),
  }));
}

export async function startClubCourse(clubId: string, courseId: string): Promise<boolean> {
  const { error } = await getSupabase().rpc('start_club_course', {
    p_club_id: clubId,
    p_course_id: courseId,
  });
  if (error) throw error;
  return true;
}

export async function fetchClubCourseLeaderboard(
  clubId: string,
  courseId: string,
): Promise<ClubCourseLeaderboardRow[]> {
  const { data, error } = await getSupabase().rpc('fetch_club_course_leaderboard', {
    p_club_id: clubId,
    p_course_id: courseId,
  });
  if (error) {
    console.warn('[club-courses] leaderboard fail', error);
    return [];
  }
  return ((data ?? []) as ClubCourseLeaderboardRow[]).map(r => ({
    ...r,
    contributed_km: Number(r.contributed_km),
  }));
}
