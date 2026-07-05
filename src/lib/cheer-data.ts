// 사람 단위 응원 (랭킹/프로필) — 5종 이모지, 주 1회 한도
import { getSupabase } from './supabase';
import { startOfWeekStr } from './kst';

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
  touchSentCheersCache(user.id, set => set.add(`${toUserId}:${emoji}`));
  return { success: true };
}

export async function unsendCheer(toUserId: string, emoji: CheerEmoji): Promise<boolean> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  // 이번 주 행만 삭제
  const weekOf = startOfWeekStr();

  const { error } = await supabase.from('user_cheers')
    .delete()
    .eq('from_user', user.id)
    .eq('to_user', toUserId)
    .eq('emoji', emoji)
    .eq('week_of', weekOf);
  if (!error) touchSentCheersCache(user.id, set => set.delete(`${toUserId}:${emoji}`));
  return !error;
}

export async function getCheerSummary(userId: string): Promise<CheerSummary[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('get_user_cheer_summary', { p_user_id: userId });
  if (error) return [];
  return (data ?? []) as CheerSummary[];
}

// build 278: 받은 응원 카운트 — 프로필 chip 표시용.
export interface ReceivedCheerCounts {
  total: number;
  thisWeek: number;
}

export async function getReceivedCheerCounts(userId: string): Promise<ReceivedCheerCounts> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('get_received_cheer_counts', { p_user_id: userId }).single();
  if (error || !data) return { total: 0, thisWeek: 0 };
  const d = data as { total: number; this_week: number };
  return { total: d.total ?? 0, thisWeek: d.this_week ?? 0 };
}

// build 290: 친구 피드가 CheerButton 을 50개씩 렌더하면 인스턴스마다 이 RPC 를 쏘던 N+1.
// 유저별 모듈 캐시 (60s TTL) + in-flight 공유로 화면당 1회로 축소.
// sendCheer/unsendCheer 성공 시 캐시를 로컬 갱신해 optimistic UI 와 일치 유지.
let sentCheersCache: { userId: string; at: number; set: Set<string> } | null = null;
let sentCheersInflight: { userId: string; promise: Promise<Set<string>> } | null = null;
const SENT_CHEERS_TTL_MS = 60_000;

function touchSentCheersCache(userId: string, mutate: (set: Set<string>) => void): void {
  if (sentCheersCache?.userId === userId) mutate(sentCheersCache.set);
}

export async function getMySentCheersThisWeek(): Promise<Set<string>> {
  // Set<`${to_user}:${emoji}`> 반환 — UI 의 "이미 보냈음" 표시용
  const supabase = getSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return new Set();

  if (sentCheersCache?.userId === userId && Date.now() - sentCheersCache.at < SENT_CHEERS_TTL_MS) {
    return sentCheersCache.set;
  }
  if (sentCheersInflight?.userId === userId) return sentCheersInflight.promise;

  const promise = (async () => {
    const { data, error } = await supabase.rpc('get_my_sent_cheers_this_week');
    sentCheersInflight = null;
    if (error) return sentCheersCache?.userId === userId ? sentCheersCache.set : new Set<string>();
    const set = new Set<string>((data ?? []).map((r: { to_user: string; emoji: string }) => `${r.to_user}:${r.emoji}`));
    sentCheersCache = { userId, at: Date.now(), set };
    return set;
  })();
  sentCheersInflight = { userId, promise };
  return promise;
}
