// 하루 대회 (Daily Contest) — RPC wrapper.

import { getSupabase } from './supabase';

export type ContestEvent = 'distance' | 'duration' | 'pace';
export type ContestStatus = 'open' | 'running' | 'finished';

export interface ContestSummary {
  contest_id: string;
  title: string;
  contest_date: string;
  event_type: ContestEvent;
  status: ContestStatus;
  host_user_id: string;
  host_name: string;
  participant_count: number;
  submitted_count: number;
  my_submitted: boolean;
  created_at: string;
}

export interface ContestLeaderRow {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  activity_id: string | null;
  result_value: number | null;
  rank: number;
  is_host: boolean;
}

export async function createDailyContest(
  title: string,
  contestDate: string,
  eventType: ContestEvent,
  inviteeIds: string[],
  options?: {
    isPublic?: boolean;
    meetupLocation?: string | null;
    meetupTime?: string | null;
    maxParticipants?: number | null;
  },
): Promise<string> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('create_daily_contest', {
    p_title: title,
    p_contest_date: contestDate,
    p_event_type: eventType,
    p_invitee_ids: inviteeIds,
    p_is_public: options?.isPublic ?? false,
    p_meetup_location: options?.meetupLocation ?? null,
    p_meetup_time: options?.meetupTime ?? null,
    p_max_participants: options?.maxParticipants ?? null,
  });
  if (error) throw error;
  return data as string;
}

export interface PublicContest {
  contest_id: string;
  title: string;
  contest_date: string;
  event_type: ContestEvent;
  meetup_location: string | null;
  meetup_time: string | null;
  host_region_gu: string | null;
  max_participants: number | null;
  status: ContestStatus;
  host_user_id: string;
  host_name: string;
  host_avatar: string | null;
  participant_count: number;
  my_joined: boolean;
  created_at: string;
}

export async function fetchPublicContests(regionGu?: string | null, onlyUpcoming = true): Promise<PublicContest[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('fetch_public_contests', {
    p_region_gu: regionGu ?? null,
    p_only_upcoming: onlyUpcoming,
    p_limit: 50,
  });
  if (error) throw error;
  return (data ?? []) as PublicContest[];
}

export async function joinPublicContest(contestId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('join_public_contest', { p_contest_id: contestId });
  if (error) throw error;
}

export async function submitContestResult(contestId: string, activityId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('submit_contest_result', {
    p_contest_id: contestId,
    p_activity_id: activityId,
  });
  if (error) throw error;
}

export async function fetchMyContests(): Promise<ContestSummary[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('fetch_my_contests');
  if (error) throw error;
  return (data ?? []) as ContestSummary[];
}

export async function fetchContestLeaderboard(contestId: string): Promise<ContestLeaderRow[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('fetch_contest_leaderboard', { p_contest_id: contestId });
  if (error) throw error;
  return (data ?? []) as ContestLeaderRow[];
}

export async function finishContest(contestId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('finish_contest', { p_contest_id: contestId });
  if (error) throw error;
}

export interface ContestMessage {
  id: number;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  body: string;
  created_at: string;
}

export async function fetchContestMessages(contestId: string, limit = 200): Promise<ContestMessage[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('fetch_contest_messages', { p_contest_id: contestId, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ContestMessage[];
}

export async function postContestMessage(contestId: string, body: string): Promise<void> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다');
  const { error } = await supabase.from('contest_messages').insert({
    contest_id: contestId,
    user_id: user.id,
    body: body.trim(),
  });
  if (error) throw error;
}

export async function deleteMyContestMessage(messageId: number): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from('contest_messages').delete().eq('id', messageId);
  if (error) throw error;
}

// event_type 별 단위 / 정렬 방향 라벨
export function formatContestValue(eventType: ContestEvent, value: number | null): string {
  if (value === null || value === undefined) return '—';
  if (eventType === 'distance') return `${value.toFixed(2)}km`;
  if (eventType === 'duration') {
    const s = Math.round(value);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }
  // pace
  const m = Math.floor(value / 60);
  const sec = Math.round(value % 60);
  return `${m}'${String(sec).padStart(2, '0')}"`;
}

export function contestEventLabel(eventType: ContestEvent): string {
  if (eventType === 'distance') return '거리';
  if (eventType === 'duration') return '시간';
  return '페이스';
}
