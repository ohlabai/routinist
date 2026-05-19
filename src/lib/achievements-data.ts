// Achievement 배지 (build 129).

import { getSupabase } from './supabase';

export interface AchievementDef {
  code: string;
  name: string;
  description: string;
  emoji: string;
  category: 'run' | 'distance' | 'course' | 'series';
}

export const ACHIEVEMENTS: Record<string, AchievementDef> = {
  first_run: { code: 'first_run', name: '첫 발걸음', description: '첫 활동', emoji: '👟', category: 'run' },
  runs_10: { code: 'runs_10', name: '10번 달림', description: '10회 달리기 누적', emoji: '🏃', category: 'run' },
  runs_100: { code: 'runs_100', name: '100런 클럽', description: '100회 달리기 누적', emoji: '🎯', category: 'run' },
  runs_500: { code: 'runs_500', name: '500 러너', description: '500회 달리기 누적', emoji: '⚡', category: 'run' },
  km_100: { code: 'km_100', name: '센추리', description: '누적 100km', emoji: '💯', category: 'distance' },
  km_500: { code: 'km_500', name: '500km 러너', description: '누적 500km', emoji: '🔥', category: 'distance' },
  km_1000: { code: 'km_1000', name: '밀레니엄', description: '누적 1,000km', emoji: '🏆', category: 'distance' },
  km_5000: { code: 'km_5000', name: '레전드', description: '누적 5,000km', emoji: '👑', category: 'distance' },
  first_course: { code: 'first_course', name: '월드마라톤 첫 완주', description: '월드마라톤 첫 코스 완주', emoji: '🌍', category: 'course' },
  courses_3: { code: 'courses_3', name: '3 코스 완주', description: '월드마라톤 3개 완주', emoji: '🎖️', category: 'course' },
  courses_10: { code: 'courses_10', name: '10 코스 마스터', description: '월드마라톤 10개 완주', emoji: '🌟', category: 'course' },
  six_stars: { code: 'six_stars', name: 'Six Stars', description: 'World Marathon Majors 6개 완주', emoji: '⭐⭐⭐⭐⭐⭐', category: 'series' },
};

export interface UserAchievement {
  code: string;
  achieved_at: string;
  metadata: Record<string, unknown> | null;
}

export async function fetchUserAchievements(userId: string): Promise<UserAchievement[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('fetch_user_achievements', { p_user_id: userId });
  if (error) throw error;
  return (data ?? []) as UserAchievement[];
}

export async function checkAndAwardAchievements(): Promise<string[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('check_and_award_achievements');
  if (error) throw error;
  return ((data ?? []) as { code: string }[]).map(r => r.code);
}
