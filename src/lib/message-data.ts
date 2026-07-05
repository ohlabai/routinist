import { getSupabase } from './supabase';
import type { Conversation, Message, Profile } from '@/types';
import { PUBLIC_PROFILE_FIELDS } from './profile-fields';

// 대화 목록 조회 (상대방 프로필 + 마지막 메시지 포함)
// Supabase nested select 로 양쪽 프로필을 한 번에 가져오고, 마지막 메시지는 conversation_ids 일괄 쿼리.
// 이전 구현은 대화 수 N 만큼 (프로필 + 메시지) 쌍 쿼리로 N+1.
export async function fetchConversations(userId: string): Promise<Conversation[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('conversations')
    .select(`
      *,
      user_a_profile:profiles!conversations_user_a_fkey(${PUBLIC_PROFILE_FIELDS}),
      user_b_profile:profiles!conversations_user_b_fkey(${PUBLIC_PROFILE_FIELDS})
    `)
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .order('last_message_at', { ascending: false });
  if (error) throw error;

  type ConvWithProfiles = Conversation & {
    user_a_profile?: Profile;
    user_b_profile?: Profile;
  };
  const convs = (data || []) as ConvWithProfiles[];
  if (convs.length === 0) return [];

  // 마지막 메시지: DISTINCT ON RPC 로 대화당 1행만.
  // build 290: 이전엔 모든 대화의 전체 메시지를 limit 없이 받아 첫 행만 사용 — 대화가 길수록
  // 목록 진입이 수천 row 전송으로 느려지던 N+1 계열 버그.
  const convIds = convs.map(c => c.id);
  const { data: lastMsgs } = await supabase
    .rpc('fetch_last_messages', { p_conversation_ids: convIds });

  const lastMsgByConv = new Map<string, Message>();
  for (const m of (lastMsgs || []) as Message[]) {
    lastMsgByConv.set(m.conversation_id, m);
  }

  // build 290: 차단한 사용자와의 대화는 목록에서 숨김 (Apple 1.2)
  const blocked = await fetchMyBlockedIds().catch(() => new Set<string>());

  return convs
    .filter(c => !blocked.has(c.user_a === userId ? c.user_b : c.user_a))
    .map(c => ({
      id: c.id,
      user_a: c.user_a,
      user_b: c.user_b,
      last_message_at: c.last_message_at,
      created_at: c.created_at,
      other_user: (c.user_a === userId ? c.user_b_profile : c.user_a_profile) as Profile | undefined,
      last_message: lastMsgByConv.get(c.id),
    }));
}

// 대화 메시지 조회
export async function fetchMessages(conversationId: string, limit = 100): Promise<Message[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data || []) as Message[];
}

// 메시지 보내기
export async function sendMessage(conversationId: string, body: string): Promise<Message> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다');

  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: user.id, body })
    .select()
    .single();
  if (error) throw error;
  return data as Message;
}

// 대화 시작 (없으면 생성)
export async function getOrCreateConversation(otherUserId: string): Promise<Conversation> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다');

  // 정규 순서: user_a < user_b
  const [userA, userB] = user.id < otherUserId ? [user.id, otherUserId] : [otherUserId, user.id];

  // 기존 대화 확인
  const { data: existing } = await supabase
    .from('conversations')
    .select('*')
    .eq('user_a', userA)
    .eq('user_b', userB)
    .maybeSingle();

  if (existing) return existing as Conversation;

  // 새 대화 생성
  const { data, error } = await supabase
    .from('conversations')
    .insert({ user_a: userA, user_b: userB })
    .select()
    .single();
  if (error) throw error;
  return data as Conversation;
}

// 메시지 읽음 처리
export async function markAsRead(conversationId: string, userId: string): Promise<void> {
  const supabase = getSupabase();
  await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .neq('sender_id', userId)
    .is('read_at', null);
}

// 안 읽은 메시지 수
export async function getUnreadCount(userId: string): Promise<number> {
  const supabase = getSupabase();

  // 내가 참여한 대화의 안 읽은 메시지
  const { data: convs } = await supabase
    .from('conversations')
    .select('id')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`);

  if (!convs?.length) return 0;

  const convIds = convs.map((c) => c.id);
  const { count } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .in('conversation_id', convIds)
    .neq('sender_id', userId)
    .is('read_at', null);

  return count ?? 0;
}

// build 290: 내 차단 목록 — 피드/댓글/쪽지 필터용. 모듈 캐시 (60s TTL) + in-flight 공유.
// 차단/해제 시 즉시 로컬 갱신하므로 TTL 은 다중 기기 동기화 지연 한도일 뿐.
let blockedIdsCache: { userId: string; at: number; ids: Set<string> } | null = null;
let blockedIdsInflight: { userId: string; promise: Promise<Set<string>> } | null = null;
const BLOCKED_IDS_TTL_MS = 60_000;

export async function fetchMyBlockedIds(): Promise<Set<string>> {
  const supabase = getSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return new Set();

  if (blockedIdsCache?.userId === userId && Date.now() - blockedIdsCache.at < BLOCKED_IDS_TTL_MS) {
    return blockedIdsCache.ids;
  }
  if (blockedIdsInflight?.userId === userId) return blockedIdsInflight.promise;

  const promise = (async () => {
    const { data, error } = await supabase.from('user_blocks').select('blocked_id').eq('blocker_id', userId);
    blockedIdsInflight = null;
    if (error) return blockedIdsCache?.userId === userId ? blockedIdsCache.ids : new Set<string>();
    const ids = new Set<string>((data ?? []).map((r: { blocked_id: string }) => r.blocked_id));
    blockedIdsCache = { userId, at: Date.now(), ids };
    return ids;
  })();
  blockedIdsInflight = { userId, promise };
  return promise;
}

// 유저 차단
export async function blockUser(blockedId: string): Promise<void> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다');

  const { error } = await supabase.from('user_blocks').insert({ blocker_id: user.id, blocked_id: blockedId });
  // 23505 = 이미 차단됨 — 성공으로 간주
  if (error && error.code !== '23505') throw new Error(error.message);
  if (blockedIdsCache?.userId === user.id) blockedIdsCache.ids.add(blockedId);

  // 차단하면 내 쪽 팔로우도 해제 — 친구 피드/친구 사진 탭에서 즉시 사라지게.
  // (상대 → 나 방향은 RLS 상 삭제 불가; 내 피드 노출은 내 follows 기준이라 이것으로 충분)
  await supabase.from('follows').delete().eq('follower_id', user.id).eq('following_id', blockedId);
}

// 차단 해제
export async function unblockUser(blockedId: string): Promise<void> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다');

  const { error } = await supabase.from('user_blocks').delete().eq('blocker_id', user.id).eq('blocked_id', blockedId);
  if (error) throw new Error(error.message);
  if (blockedIdsCache?.userId === user.id) blockedIdsCache.ids.delete(blockedId);
}

// 차단 여부 확인
export async function isBlocked(blockedId: string): Promise<boolean> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { data } = await supabase
    .from('user_blocks')
    .select('blocker_id')
    .eq('blocker_id', user.id)
    .eq('blocked_id', blockedId)
    .maybeSingle();
  return !!data;
}
