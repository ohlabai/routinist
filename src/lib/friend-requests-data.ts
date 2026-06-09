// build 264: 친구 신청 모델 클라이언트.
// 기존 follows 즉시 수락 모델과 별도. 사용자가 명시적으로 "친구 신청" 보낼 때만 사용.
// 수락 시 트리거가 follows 양방향 insert + 알림 자동.

import { getSupabase } from './supabase';
import { logClientWarn } from './error-logger';

export interface FriendRequest {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: 'pending' | 'accepted' | 'rejected' | 'canceled';
  message: string | null;
  created_at: string;
  responded_at: string | null;
}

export async function sendFriendRequest(receiverId: string, message?: string): Promise<string | null> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('send_friend_request', {
      p_receiver_id: receiverId,
      p_message: message ?? null,
    });
    if (error) {
      void logClientWarn('friend-requests', 'send fail', { receiverId, message: error.message });
      throw error;
    }
    return (data as string) ?? null;
  } catch (e) {
    void logClientWarn('friend-requests', 'send fail', {
      receiverId, message: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

export async function respondFriendRequest(requestId: string, accept: boolean): Promise<'accepted' | 'rejected'> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('respond_friend_request', {
      p_request_id: requestId,
      p_accept: accept,
    });
    if (error) {
      void logClientWarn('friend-requests', 'respond fail', { requestId, accept, message: error.message });
      throw error;
    }
    return (data as 'accepted' | 'rejected');
  } catch (e) {
    void logClientWarn('friend-requests', 'respond fail', {
      requestId, accept, message: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

export type FriendshipStatus = 'none' | 'request_sent' | 'request_received' | 'friend';

export interface FriendshipState {
  status: FriendshipStatus;
  requestId: string | null;
}

export async function getFriendshipStatus(otherUserId: string): Promise<FriendshipState> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('get_friendship_status', {
      p_other_user_id: otherUserId,
    });
    if (error || !data || data.length === 0) {
      return { status: 'none', requestId: null };
    }
    const row = data[0] as { status: FriendshipStatus; request_id: string | null };
    return { status: row.status ?? 'none', requestId: row.request_id ?? null };
  } catch (e) {
    void logClientWarn('friend-requests', 'get status fail', {
      otherUserId, message: e instanceof Error ? e.message : String(e),
    });
    return { status: 'none', requestId: null };
  }
}

export async function cancelFriendRequest(requestId: string): Promise<void> {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.rpc('cancel_friend_request', { p_request_id: requestId });
    if (error) {
      void logClientWarn('friend-requests', 'cancel fail', { requestId, message: error.message });
      throw error;
    }
  } catch (e) {
    void logClientWarn('friend-requests', 'cancel fail', {
      requestId, message: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

export async function fetchReceivedFriendRequests(): Promise<FriendRequest[]> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('friend_requests')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) {
      void logClientWarn('friend-requests', 'list fail', { message: error.message });
      return [];
    }
    return (data ?? []) as FriendRequest[];
  } catch (e) {
    void logClientWarn('friend-requests', 'list fail', {
      message: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

// build 279: 내가 보낸 pending 신청 + receiver profile.
export interface SentFriendRequest extends FriendRequest {
  receiver: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

export async function fetchSentFriendRequests(): Promise<SentFriendRequest[]> {
  try {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    // FK hint 가 환경마다 다를 수 있어 2-단계 fetch 로 단순화.
    const { data: requests, error } = await supabase
      .from('friend_requests')
      .select('*')
      .eq('sender_id', user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error || !requests) {
      void logClientWarn('friend-requests', 'sent list fail', { message: error?.message ?? 'no data' });
      return [];
    }
    if (requests.length === 0) return [];
    const receiverIds = Array.from(new Set(requests.map(r => r.receiver_id)));
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url')
      .in('id', receiverIds);
    const profileMap = new Map((profiles ?? []).map(p => [p.id, p]));
    return requests.map(r => ({
      ...(r as FriendRequest),
      receiver: profileMap.get(r.receiver_id) ?? null,
    })) as SentFriendRequest[];
  } catch (e) {
    void logClientWarn('friend-requests', 'sent list fail', {
      message: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}
