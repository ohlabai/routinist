// 사람 단위 응원 (랭킹/프로필) — 5종 이모지, 주 1회 한도
import { getSupabase } from './supabase';

export type CheerEmoji = '❤️' | '🔥' | '💪' | '👏' | '🎉';
export const CHEER_EMOJIS: CheerEmoji[] = ['❤️', '🔥', '💪', '👏', '🎉'];

export interface CheerSummary {
  emoji: CheerEmoji;
  total_count: number;
  week_count: number;
}

export async function sendCheer(toUserId: string, emoji: CheerEmoji, context: string = 'profile'): Promise<{ success: boolean; reason?: string }> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, reason: 'not_authed' };
  if (user.id === toUserId) return { success: false, reason: 'self' };

  const { error } = await supabase.from('user_cheers').insert({
    from_user: user.id,
    to_user: toUserId,
    emoji,
    context,
  });
  if (error) {
    if (error.code === '23505') return { success: false, reason: 'already_sent_this_week' };
    return { success: false, reason: error.message };
  }
  return { success: true };
}

export async function unsendCheer(toUserId: string, emoji: CheerEmoji): Promise<boolean> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  // 이번 주 행만 삭제
  const monday = new Date();
  const day = monday.getDay() || 7;  // 일요일이면 7
  monday.setDate(monday.getDate() - day + 1);
  const weekOf = monday.toISOString().slice(0, 10);

  const { error } = await supabase.from('user_cheers')
    .delete()
    .eq('from_user', user.id)
    .eq('to_user', toUserId)
    .eq('emoji', emoji)
    .eq('week_of', weekOf);
  return !error;
}

export async function getCheerSummary(userId: string): Promise<CheerSummary[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('get_user_cheer_summary', { p_user_id: userId });
  if (error) return [];
  return (data ?? []) as CheerSummary[];
}

export async function getMySentCheersThisWeek(): Promise<Set<string>> {
  // Set<`${to_user}:${emoji}`> 반환 — UI 의 "이미 보냈음" 표시용
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('get_my_sent_cheers_this_week');
  if (error) return new Set();
  return new Set((data ?? []).map((r: { to_user: string; emoji: string }) => `${r.to_user}:${r.emoji}`));
}
