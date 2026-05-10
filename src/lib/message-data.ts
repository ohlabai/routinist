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

  // 마지막 메시지: conversation_id IN (...) 단일 쿼리. created_at DESC 로 정렬 후 conversation 별 첫 행만.
  const convIds = convs.map(c => c.id);
  const { data: lastMsgs } = await supabase
    .from('messages')
    .select('*')
    .in('conversation_id', convIds)
    .order('created_at', { ascending: false });

  const lastMsgByConv = new Map<string, Message>();
  for (const m of (lastMsgs || []) as Message[]) {
    if (!lastMsgByConv.has(m.conversation_id)) {
      lastMsgByConv.set(m.conversation_id, m);
    }
  }

  return convs.map(c => ({
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

// 유저 차단
export async function blockUser(blockedId: string): Promise<void> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다');

  await supabase.from('user_blocks').insert({ blocker_id: user.id, blocked_id: blockedId });
}

// 차단 해제
export async function unblockUser(blockedId: string): Promise<void> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다');

  await supabase.from('user_blocks').delete().eq('blocker_id', user.id).eq('blocked_id', blockedId);
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
