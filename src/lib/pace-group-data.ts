// 페이스 그룹 (build 119) — 5단계 페이스대 가상 클럽.

import { getSupabase } from './supabase';

export interface PaceGroup {
  group_id: string;
  slug: string;
  label: string;
  description: string | null;
  emoji: string | null;
  min_pace_sec: number;
  max_pace_sec: number;
  member_count: number;
  is_recommended: boolean;
  is_joined: boolean;
}

export interface PaceGroupMember {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  region_gu: string | null;
  gender: 'male' | 'female' | null;
  show_gender: boolean;
  km_30d: number;
  joined_at: string;
}

export async function fetchPaceGroups(): Promise<PaceGroup[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('fetch_pace_groups');
  if (error) throw error;
  return (data ?? []) as PaceGroup[];
}

export async function fetchPaceGroupMembers(groupId: string): Promise<PaceGroupMember[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('fetch_pace_group_members', { p_group_id: groupId, p_limit: 50 });
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    user_id: r.user_id as string,
    display_name: r.display_name as string,
    avatar_url: (r.avatar_url as string) ?? null,
    region_gu: (r.region_gu as string) ?? null,
    gender: (r.gender as 'male' | 'female') ?? null,
    show_gender: r.show_gender !== false,
    km_30d: Number(r.km_30d ?? 0),
    joined_at: r.joined_at as string,
  }));
}

export async function joinPaceGroup(groupId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('join_pace_group', { p_group_id: groupId });
  if (error) throw error;
}

export async function leavePaceGroup(): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('leave_pace_group');
  if (error) throw error;
}
