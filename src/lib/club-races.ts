// 2026-08-16: 클럽 대회 (2인 1조 합산 레이스).
//
// BIT Runners 1주년 트레일런(8/21) 용으로 만들었지만 클럽 공통 기능이다.
// 조 기록 = 조원들의 **실경과 시간 합계**, 합계가 짧은 조가 상위.
//
// 왜 실경과(ended_at - started_at)인가: duration_seconds 는 자동정지가 빠진 이동 시간이라
// 오르막에서 걸은 시간이 기록에서 사라진다 → 많이 걸을수록 유리해진다. 대회에는 못 쓴다.
// 서버(sync_club_race_times)도 같은 규칙으로 계산한다.

import { getSupabase } from './supabase';

export type RaceStatus = 'open' | 'closed';
/** pending=기록 없음 · auto=앱 러닝 자동 매칭 · manual=운영자 입력 · dnf=미완주 */
export type RaceEntrySource = 'pending' | 'auto' | 'manual' | 'dnf';

export interface ClubRace {
  id: string;
  club_id: string;
  title: string;
  description: string | null;
  race_date: string;
  starts_at: string;
  ends_at: string;
  distance_km: number | null;
  team_size: number;
  status: RaceStatus;
  created_at: string;
}

export interface ClubRaceEntry {
  id: string;
  race_id: string;
  user_id: string | null;
  guest_name: string | null;
  team_no: number | null;
  seconds: number | null;
  distance_km: number | null;
  source: RaceEntrySource;
  note: string | null;
}

export interface RaceBoardMember {
  entry_id: string;
  user_id: string | null;
  name: string | null;
  avatar_url: string | null;
  seconds: number | null;
  distance_km: number | null;
  source: RaceEntrySource;
  is_guest: boolean;
}

export interface RaceBoardTeam {
  team_no: number;
  member_count: number;
  finished_count: number;
  total_seconds: number | null;
  total_distance_km: number | null;
  is_complete: boolean;
  /** 조원 전원의 기록이 있어야 순위가 붙는다. 한 명이라도 비면 null (합계가 성립 안 함) */
  rank: number | null;
  members: RaceBoardMember[];
}

/** 초 → "1:02:33" / "42:10" */
export function formatRaceTime(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** "42:10" / "1:02:33" / "3733" → 초. 파싱 실패 시 null */
export function parseRaceTime(input: string): number | null {
  const t = input.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t) > 0 ? Number(t) : null;
  const parts = t.split(':').map(p => p.trim());
  if (parts.length < 2 || parts.length > 3 || parts.some(p => !/^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  const total = nums.length === 3
    ? nums[0] * 3600 + nums[1] * 60 + nums[2]
    : nums[0] * 60 + nums[1];
  return total > 0 ? total : null;
}

export async function fetchClubRaces(clubId: string): Promise<ClubRace[]> {
  const { data, error } = await getSupabase()
    .from('club_races').select('*')
    .eq('club_id', clubId)
    .order('race_date', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ClubRace[];
}

export async function fetchRaceEntries(raceId: string): Promise<ClubRaceEntry[]> {
  const { data, error } = await getSupabase()
    .from('club_race_entries').select('*')
    .eq('race_id', raceId)
    .order('team_no', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as ClubRaceEntry[];
}

export async function fetchRaceBoard(raceId: string): Promise<RaceBoardTeam[]> {
  const { data, error } = await getSupabase().rpc('get_club_race_board', { p_race_id: raceId });
  if (error) throw error;
  return (data ?? []) as RaceBoardTeam[];
}

export async function createClubRace(input: {
  clubId: string; title: string; description?: string;
  raceDate: string; startsAt: string; endsAt: string;
  distanceKm?: number | null; teamSize?: number;
}): Promise<ClubRace> {
  const sb = getSupabase();
  const { data: auth } = await sb.auth.getUser();
  const { data, error } = await sb.from('club_races').insert({
    club_id: input.clubId,
    title: input.title,
    description: input.description ?? null,
    race_date: input.raceDate,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    distance_km: input.distanceKm ?? null,
    team_size: input.teamSize ?? 2,
    created_by: auth.user?.id ?? null,
  }).select().single();
  if (error) throw error;
  return data as ClubRace;
}

/** 본인 참가. RLS 가 기록 필드를 비워둘 것을 강제한다 (자기 기록 위조 차단) */
export async function joinClubRace(raceId: string): Promise<void> {
  const sb = getSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) throw new Error('로그인이 필요합니다');
  const { error } = await sb.from('club_race_entries').insert({
    race_id: raceId, user_id: auth.user.id, source: 'pending',
  });
  if (error && error.code !== '23505') throw error;   // 23505 = 이미 참가
}

export async function leaveClubRace(raceId: string): Promise<void> {
  const sb = getSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return;
  const { error } = await sb.from('club_race_entries')
    .delete().eq('race_id', raceId).eq('user_id', auth.user.id);
  if (error) throw error;
}

/** 앱 없는 참가자를 이름만으로 추가 (운영자) */
export async function addRaceGuest(raceId: string, name: string): Promise<void> {
  const { error } = await getSupabase().from('club_race_entries')
    .insert({ race_id: raceId, guest_name: name.trim(), source: 'pending' });
  if (error) throw error;
}

export async function removeRaceEntry(entryId: string): Promise<void> {
  const { error } = await getSupabase().from('club_race_entries').delete().eq('id', entryId);
  if (error) throw error;
}

/** 조 편성 (운영자). team_no = null 이면 미편성으로 되돌린다 */
export async function setRaceTeam(entryId: string, teamNo: number | null): Promise<void> {
  const { error } = await getSupabase().from('club_race_entries')
    .update({ team_no: teamNo, updated_at: new Date().toISOString() })
    .eq('id', entryId);
  if (error) throw error;
}

/** 도착 시각 수동 입력 (운영자). 이후 동기화가 덮어쓰지 않는다 */
export async function setRaceManualTime(entryId: string, seconds: number | null): Promise<void> {
  const { error } = await getSupabase().from('club_race_entries')
    .update({
      seconds,
      source: seconds == null ? 'pending' : 'manual',
      updated_at: new Date().toISOString(),
    })
    .eq('id', entryId);
  if (error) throw error;
}

export async function setRaceDnf(entryId: string): Promise<void> {
  const { error } = await getSupabase().from('club_race_entries')
    .update({ seconds: null, source: 'dnf', updated_at: new Date().toISOString() })
    .eq('id', entryId);
  if (error) throw error;
}

/** 창 안의 러닝을 찾아 참가자 기록을 채운다 (운영자). manual/dnf 는 보존 */
export async function syncRaceTimes(raceId: string): Promise<{ matched: number; missing: number }> {
  const { data, error } = await getSupabase().rpc('sync_club_race_times', { p_race_id: raceId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { matched: row?.matched ?? 0, missing: row?.missing ?? 0 };
}
