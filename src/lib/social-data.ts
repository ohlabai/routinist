import { getSupabase } from './supabase';
import type { Profile, Club, ClubMember, Follow, RegionalRanking } from '@/types';

// Supabase PostgrestError 가 일부 환경에서 Error 인스턴스가 아니라 plain object 로 전달돼
// `String(err) = '[object Object]'` 토스트가 발생함. message/code 추출 후 Error wrap.
function asError(e: unknown, fallback = '알 수 없는 오류'): Error {
  if (e instanceof Error) return e;
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    const msg =
      (typeof o.message === 'string' && o.message) ||
      (typeof o.details === 'string' && o.details) ||
      (typeof o.hint === 'string' && o.hint) ||
      (typeof o.code === 'string' && o.code) ||
      fallback;
    return new Error(msg);
  }
  if (typeof e === 'string') return new Error(e);
  return new Error(fallback);
}

// =============================================
// 팔로우
// =============================================

export async function followUser(followingId: string) {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다');

  const { error } = await supabase.from('follows').insert({
    follower_id: user.id,
    following_id: followingId,
  });
  if (error) throw asError(error);
}

export async function unfollowUser(followingId: string) {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다');

  const { error } = await supabase.from('follows')
    .delete()
    .eq('follower_id', user.id)
    .eq('following_id', followingId);
  if (error) throw asError(error);
}

export async function fetchFollowers(userId: string): Promise<Profile[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('follows')
    .select('follower_id, profiles!follows_follower_id_fkey(*)')
    .eq('following_id', userId);
  if (error) throw asError(error);
  return (data || []).map((d) => d.profiles as unknown as Profile);
}

export async function fetchFollowing(userId: string): Promise<Profile[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('follows')
    .select('following_id, profiles!follows_following_id_fkey(*)')
    .eq('follower_id', userId);
  if (error) throw asError(error);
  return (data || []).map((d) => d.profiles as unknown as Profile);
}

export async function isFollowing(followingId: string): Promise<boolean> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { data } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('follower_id', user.id)
    .eq('following_id', followingId)
    .maybeSingle();
  return !!data;
}

export async function getFollowCounts(userId: string): Promise<{ followers: number; following: number }> {
  const supabase = getSupabase();
  const [{ count: followers }, { count: following }] = await Promise.all([
    supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', userId),
    supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', userId),
  ]);
  return { followers: followers ?? 0, following: following ?? 0 };
}

// =============================================
// 유저 검색
// =============================================

export async function searchUsers(query: string, limit = 20): Promise<Profile[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .ilike('display_name', `%${query}%`)
    .eq('is_public', true)
    .limit(limit);
  if (error) throw asError(error);
  return (data || []) as Profile[];
}

export async function fetchPublicUsers(limit = 50): Promise<Profile[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('is_public', true)
    .order('total_distance_km', { ascending: false })
    .limit(limit);
  if (error) throw asError(error);
  return (data || []) as Profile[];
}

// =============================================
// 클럽
// =============================================

export async function fetchClubs(): Promise<Club[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('clubs')
    .select('*')
    .order('member_count', { ascending: false });
  if (error) throw asError(error);
  return (data || []) as Club[];
}

export async function fetchClub(clubId: string): Promise<Club | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('clubs')
    .select('*')
    .eq('id', clubId)
    .maybeSingle();
  if (error) throw asError(error);
  return data as Club | null;
}

export async function fetchClubMembers(clubId: string): Promise<ClubMember[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('club_members')
    .select('*, profiles(*)')
    .eq('club_id', clubId)
    .order('joined_at');
  if (error) throw asError(error);
  return (data || []).map((d) => ({
    ...d,
    profile: d.profiles as unknown as Profile,
  })) as ClubMember[];
}

export async function createClub(name: string, description?: string): Promise<Club> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다');

  // 프로필이 없으면 먼저 생성 (auth 트리거 누락 대비)
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (!existingProfile) {
    const displayName =
      (user.user_metadata?.name as string | undefined) ||
      (user.user_metadata?.full_name as string | undefined) ||
      (user.email?.split('@')[0]) ||
      '러너';
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({ id: user.id, display_name: displayName });
    if (profileError) {
      console.error('[프로필 자동 생성 실패]', profileError);
      throw new Error(`프로필 생성 실패: ${profileError.message}`);
    }
  }

  const { data, error } = await supabase
    .from('clubs')
    .insert({ name, description: description || null, created_by: user.id })
    .select()
    .single();
  if (error) {
    console.error('[클럽 insert 실패]', error);
    throw new Error(error.message || '알 수 없는 오류');
  }

  const { error: memberError } = await supabase.from('club_members').insert({
    club_id: data.id,
    user_id: user.id,
    role: 'owner',
  });
  if (memberError) {
    console.error('[클럽 멤버 추가 실패]', memberError);
    throw new Error(`클럽은 생성되었으나 멤버 등록 실패: ${memberError.message}`);
  }

  return data as Club;
}

export async function joinClub(clubId: string) {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다');

  const { error } = await supabase.from('club_members').insert({
    club_id: clubId,
    user_id: user.id,
    role: 'member',
  });
  if (error) throw asError(error);
}

export async function leaveClub(clubId: string) {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다');

  const { error } = await supabase.from('club_members')
    .delete()
    .eq('club_id', clubId)
    .eq('user_id', user.id);
  if (error) throw asError(error);
}

export async function getMyClubs(): Promise<Club[]> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('club_members')
    .select('club_id, clubs(*)')
    .eq('user_id', user.id);
  if (error) throw asError(error);
  return (data || []).map((d) => d.clubs as unknown as Club);
}

export async function isClubMember(clubId: string): Promise<boolean> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { data } = await supabase
    .from('club_members')
    .select('user_id')
    .eq('club_id', clubId)
    .eq('user_id', user.id)
    .maybeSingle();
  return !!data;
}

export async function getMyClubRole(clubId: string): Promise<string | null> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('club_members')
    .select('role')
    .eq('club_id', clubId)
    .eq('user_id', user.id)
    .maybeSingle();
  return data?.role || null;
}

export async function updateMemberRole(clubId: string, userId: string, role: 'admin' | 'member') {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('club_members')
    .update({ role })
    .eq('club_id', clubId)
    .eq('user_id', userId);
  if (error) throw asError(error);
}

export async function removeMember(clubId: string, userId: string) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('club_members')
    .delete()
    .eq('club_id', clubId)
    .eq('user_id', userId);
  if (error) throw asError(error);
}

export async function updateClub(clubId: string, updates: { name?: string; description?: string; is_public?: boolean }) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('clubs')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', clubId);
  if (error) throw asError(error);
}

// 클럽 삭제 — 방장(owner) 또는 앱 관리자(hans@openhan.kr). 멤버십도 함께 정리.
export async function deleteClub(clubId: string) {
  const supabase = getSupabase();
  // club_members 는 ON DELETE CASCADE 로 연결됐을 가능성이 높지만, 실패를 피하기 위해 선제 제거
  await supabase.from('club_members').delete().eq('club_id', clubId);
  const { error } = await supabase.from('clubs').delete().eq('id', clubId);
  if (error) throw asError(error);
}

export async function fetchClubActivities(clubId: string, limit = 20) {
  const supabase = getSupabase();
  const { data: members } = await supabase
    .from('club_members')
    .select('user_id')
    .eq('club_id', clubId);
  if (!members?.length) return [];

  const userIds = members.map(m => m.user_id);
  const { data, error } = await supabase
    .from('activities')
    .select('*, profiles(display_name, avatar_url)')
    .in('user_id', userIds)
    .order('activity_date', { ascending: false })
    .limit(limit);
  if (error) throw asError(error);
  return data || [];
}

// =============================================
// 지역 랭킹
// =============================================

export async function fetchRegionalRankings(
  regionGu: string,
  year: number,
  month: number,
  limit = 50,
): Promise<RegionalRanking[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('regional_rankings')
    .select('*')
    .eq('region_gu', regionGu)
    .eq('year', year)
    .eq('month', month)
    .order('rank_in_gu')
    .limit(limit);
  if (error) throw asError(error);
  return (data || []) as RegionalRanking[];
}

// 내 지역 랭킹 조회 (시/구/동 3단)
export interface MyRegionalRank {
  level: '시' | '구' | '동';
  region: string;
  rank: number;
  total: number;
  myDistance: number;
}

export async function fetchMyRegionalRanks(userId: string, year: number, month: number): Promise<MyRegionalRank[]> {
  const supabase = getSupabase();

  // 내 프로필에서 지역 정보 가져오기
  const { data: myProfile } = await supabase
    .from('profiles')
    .select('region_si, region_gu, region_dong')
    .eq('id', userId)
    .single();

  if (!myProfile?.region_si) return [];

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

  // 이전 구현: 시·구·동 각각 (profiles + activities) 쿼리 → 6개. 시 superset 한 번만 가져오고 JS 에서 필터링.
  const { data: siProfiles } = await supabase
    .from('profiles')
    .select('id, region_gu, region_dong')
    .eq('region_si', myProfile.region_si);

  if (!siProfiles?.length) return [];

  const allUserIds = siProfiles.map(p => p.id);
  const { data: activities } = await supabase
    .from('activities')
    .select('user_id, distance_km')
    .in('user_id', allUserIds)
    .gte('activity_date', startDate)
    .lt('activity_date', endDate);

  // user_id → 거리 합계
  const distMap = new Map<string, number>();
  (activities || []).forEach(a => distMap.set(a.user_id, (distMap.get(a.user_id) || 0) + Number(a.distance_km)));

  type ProfileRow = { id: string; region_gu: string | null; region_dong: string | null };

  const computeRank = (level: '시' | '구' | '동', region: string, eligibleUsers: ProfileRow[]): MyRegionalRank => {
    const idsInLevel = new Set(eligibleUsers.map(p => p.id));
    const entries: [string, number][] = [];
    for (const id of idsInLevel) entries.push([id, distMap.get(id) || 0]);
    entries.sort((a, b) => b[1] - a[1]);
    const myIdx = entries.findIndex(([uid]) => uid === userId);
    const myDist = distMap.get(userId) || 0;
    return {
      level, region,
      rank: myIdx >= 0 ? myIdx + 1 : entries.length + 1,
      total: entries.length,
      myDistance: Math.round(myDist * 10) / 10,
    };
  };

  const results: MyRegionalRank[] = [];
  results.push(computeRank('시', myProfile.region_si, siProfiles as ProfileRow[]));

  if (myProfile.region_gu) {
    const guUsers = (siProfiles as ProfileRow[]).filter(p => p.region_gu === myProfile.region_gu);
    if (guUsers.length > 0) {
      results.push(computeRank('구', myProfile.region_gu, guUsers));
    }
  }

  if (myProfile.region_dong && myProfile.region_gu) {
    const dongUsers = (siProfiles as ProfileRow[]).filter(p =>
      p.region_gu === myProfile.region_gu && p.region_dong === myProfile.region_dong
    );
    if (dongUsers.length > 0) {
      results.push(computeRank('동', myProfile.region_dong, dongUsers));
    }
  }

  return results;
}
