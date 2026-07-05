// Achievement 배지 (build 129).

import { getSupabase } from './supabase';

export interface AchievementDef {
  code: string;
  name: string;
  description: string;
  emoji: string;
  category: 'run' | 'distance' | 'course' | 'series' | 'social';
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
  first_course: { code: 'first_course', name: '월드런 챌린지 첫 완주', description: '월드런 챌린지 첫 코스 완주', emoji: '🌍', category: 'course' },
  courses_3: { code: 'courses_3', name: '3 코스 완주', description: '월드런 챌린지 3개 완주', emoji: '🎖️', category: 'course' },
  courses_10: { code: 'courses_10', name: '10 코스 마스터', description: '월드런 챌린지 10개 완주', emoji: '🌟', category: 'course' },
  six_stars: { code: 'six_stars', name: 'Six Stars', description: 'World Marathon Majors 6개 완주', emoji: '⭐⭐⭐⭐⭐⭐', category: 'series' },
  // 습관 형성 초반 배지 (SQL 지급 로직 별도 트랙) — 첫 주 안에 "얻는 경험" 을 주는 이지 배지.
  first_week_3runs: { code: 'first_week_3runs', name: '첫 주 3회', description: '한 주에 3번 달리기 달성', emoji: '📅', category: 'run' },
  first_5km: { code: 'first_5km', name: '첫 5K', description: '한 번에 5km 달리기', emoji: '🏅', category: 'distance' },
  streak_3: { code: 'streak_3', name: '3일 연속', description: '3일 연속 달리기', emoji: '🔥', category: 'run' },
  first_photo: { code: 'first_photo', name: '첫 인증샷', description: '첫 러닝 사진 올리기', emoji: '📸', category: 'social' },
  first_cheer_sent: { code: 'first_cheer_sent', name: '첫 응원', description: '친구에게 첫 응원 보내기', emoji: '📣', category: 'social' },
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

export interface AwardCheckResult {
  code: string;
  /** 이번 호출에서 처음 지급된 배지만 true (SQL fix 이후 계약). */
  newly_awarded: boolean;
}

export async function checkAndAwardAchievements(): Promise<AwardCheckResult[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('check_and_award_achievements');
  if (error) throw error;
  // 구버전 RPC (newly_awarded 컬럼 없음) 는 false 처리 → 축하 모달이 잘못 뜨지 않게 보수적으로.
  return ((data ?? []) as { code: string; newly_awarded?: boolean }[]).map(r => ({
    code: r.code,
    newly_awarded: r.newly_awarded === true,
  }));
}
