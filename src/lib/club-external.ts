import { getSupabase } from './supabase';

// 외부(앱 미가입) 클럽 멤버의 월별 결산 데이터.
// HTML 결산 import 후 club_external_* 테이블에 저장된 데이터를 조회.

export interface ClubExternalMonthlySummary {
  member_id: string;
  club_id: string;
  name: string;
  linked_user_id: string | null;
  year: number;
  month: number;
  run_count: number;
  days_count: number;
  total_km: number;
  max_run_km: number;
  goal_km: number | null;
  goal_pct: number | null;
  goal_achieved: boolean | null;
  pass50: boolean;
}

export interface ClubExternalRunEvent {
  id: string;
  member_id: string;
  activity_date: string;
  started_at: string | null;
  distance_km: number;
}

// 한 클럽의 특정 월 멤버별 결산 (랭킹 정렬)
export async function fetchClubMonthlySummary(
  clubId: string,
  year: number,
  month: number,
): Promise<ClubExternalMonthlySummary[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('club_external_monthly_summary')
    .select('*')
    .eq('club_id', clubId)
    .eq('year', year)
    .eq('month', month)
    .order('total_km', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ClubExternalMonthlySummary[];
}

// 외부 활동이 존재하는 (year, month) 목록 — 아카이브 셀렉터용
export async function fetchClubExternalArchives(
  clubId: string,
): Promise<Array<{ year: number; month: number }>> {
  const supabase = getSupabase();
  // members 를 통해 활동 날짜 분포를 조회
  const { data, error } = await supabase
    .from('club_external_activities')
    .select('activity_date, club_external_members!inner(club_id)')
    .eq('club_external_members.club_id', clubId)
    .order('activity_date', { ascending: false });
  if (error) throw error;
  const seen = new Set<string>();
  const out: Array<{ year: number; month: number }> = [];
  for (const r of (data ?? []) as Array<{ activity_date: string }>) {
    const [y, m] = r.activity_date.split('-');
    const key = `${y}-${m}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ year: parseInt(y, 10), month: parseInt(m, 10) });
  }
  return out;
}

// 한 멤버의 특정 월 일별 활동 목록
export async function fetchMemberRunEvents(
  memberId: string,
  year: number,
  month: number,
): Promise<ClubExternalRunEvent[]> {
  const supabase = getSupabase();
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const { data, error } = await supabase
    .from('club_external_activities')
    .select('id, member_id, activity_date, started_at, distance_km')
    .eq('member_id', memberId)
    .gte('activity_date', monthStart)
    .lt('activity_date', nextMonth)
    .order('started_at', { ascending: true })
    .order('activity_date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ClubExternalRunEvent[];
}
