import { getSupabase } from './supabase';
import { toLocalDateStr } from './kst';

export interface MemberProgress {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  distance_km: number;
  goal_km: number;
  progress: number; // 0-100
}

// 클럽 멤버들의 이번 달 목표 진행률 (배치 쿼리)
export async function fetchClubMemberProgress(clubId: string, year: number, month: number): Promise<MemberProgress[]> {
  const supabase = getSupabase();

  const { data: members } = await supabase
    .from('club_members')
    .select('user_id, profiles(display_name, avatar_url)')
    .eq('club_id', clubId);

  if (!members?.length) return [];

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

  const userIds = members.map(m => m.user_id);

  // 전 멤버의 활동/목표를 한 번에 조회
  const [{ data: activities }, { data: goals }] = await Promise.all([
    supabase
      .from('activities')
      .select('user_id, distance_km')
      .in('user_id', userIds)
      .gte('activity_date', startDate)
      .lt('activity_date', endDate),
    supabase
      .from('monthly_goals')
      .select('user_id, goal_km')
      .in('user_id', userIds)
      .eq('year', year)
      .eq('month', month),
  ]);

  const distanceMap = new Map<string, number>();
  (activities || []).forEach(a => {
    distanceMap.set(a.user_id, (distanceMap.get(a.user_id) || 0) + Number(a.distance_km));
  });

  const goalMap = new Map<string, number>();
  (goals || []).forEach(g => goalMap.set(g.user_id, Number(g.goal_km)));

  const results: MemberProgress[] = members.map(m => {
    const profile = m.profiles as unknown as { display_name: string; avatar_url: string | null };
    const distance = distanceMap.get(m.user_id) || 0;
    const goalKm = goalMap.get(m.user_id) || 0;
    const progress = goalKm > 0 ? Math.min((distance / goalKm) * 100, 100) : 0;
    return {
      user_id: m.user_id,
      display_name: profile?.display_name || '러너',
      avatar_url: profile?.avatar_url || null,
      distance_km: Math.round(distance * 100) / 100,
      goal_km: goalKm,
      progress,
    };
  });

  return results.sort((a, b) => b.progress - a.progress);
}

// 클럽 요약 통계
export interface ClubSummary {
  totalDistance: number;
  avgDistance: number;
  totalRuns: number;
  activeMembers: number;
  totalMembers: number;
  daysRemaining: number;
}

// 멤버별 러닝 횟수
export interface MemberRunCount {
  user_id: string;
  display_name: string;
  run_count: number;
}

// 통산 누적 랭킹
export interface CumulativeRanking {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  total_distance_km: number;
}

// 명예의 전당 수상 내역
export interface HallOfFameEntry {
  category: 'long_runner' | 'finisher' | 'consistent';
  label: string;
  emoji: string;
  description: string;
  winners: { user_id: string; display_name: string; value: number; count: number }[];
}

// 월별 수상 기록
export interface MonthlyAward {
  year: number;
  month: number;
  finishRate: number;
  topRunner: { display_name: string; distance_km: number } | null;
  awards: {
    category: string;
    emoji: string;
    winners: { display_name: string; value: string }[];
  }[];
}

// 클럽 요약 통계 조회
export async function fetchClubSummary(clubId: string, year: number, month: number): Promise<ClubSummary> {
  const supabase = getSupabase();

  const { data: members } = await supabase
    .from('club_members')
    .select('user_id')
    .eq('club_id', clubId);

  const totalMembers = members?.length || 0;
  if (!members?.length) return { totalDistance: 0, avgDistance: 0, totalRuns: 0, activeMembers: 0, totalMembers: 0, daysRemaining: 0 };

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

  const userIds = members.map(m => m.user_id);

  const { data: activities } = await supabase
    .from('activities')
    .select('user_id, distance_km')
    .in('user_id', userIds)
    .gte('activity_date', startDate)
    .lt('activity_date', endDate);

  const totalDistance = (activities || []).reduce((s, a) => s + Number(a.distance_km), 0);
  const totalRuns = activities?.length || 0;
  const activeUserIds = new Set((activities || []).map(a => a.user_id));
  const activeMembers = activeUserIds.size;
  const avgDistance = activeMembers > 0 ? totalDistance / activeMembers : 0;

  const daysInMonth = new Date(year, month, 0).getDate();
  const now = new Date();
  const daysRemaining = (now.getFullYear() === year && now.getMonth() + 1 === month)
    ? daysInMonth - now.getDate()
    : 0;

  return {
    totalDistance: Math.round(totalDistance * 10) / 10,
    avgDistance: Math.round(avgDistance * 10) / 10,
    totalRuns,
    activeMembers,
    totalMembers,
    daysRemaining,
  };
}

// 멤버별 러닝 횟수
export async function fetchMemberRunCounts(clubId: string, year: number, month: number): Promise<MemberRunCount[]> {
  const supabase = getSupabase();

  const { data: members } = await supabase
    .from('club_members')
    .select('user_id, profiles(display_name)')
    .eq('club_id', clubId);

  if (!members?.length) return [];

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

  const userIds = members.map(m => m.user_id);

  const { data: activities } = await supabase
    .from('activities')
    .select('user_id')
    .in('user_id', userIds)
    .gte('activity_date', startDate)
    .lt('activity_date', endDate);

  const countMap = new Map<string, number>();
  (activities || []).forEach(a => countMap.set(a.user_id, (countMap.get(a.user_id) || 0) + 1));

  const results: MemberRunCount[] = members.map(m => {
    const profile = m.profiles as unknown as { display_name: string };
    return {
      user_id: m.user_id,
      display_name: profile?.display_name || '러너',
      run_count: countMap.get(m.user_id) || 0,
    };
  });

  return results.filter(r => r.run_count > 0).sort((a, b) => b.run_count - a.run_count);
}

// 통산 누적 랭킹 (profiles 테이블의 total_distance_km 사용)
export async function fetchCumulativeRanking(clubId: string): Promise<CumulativeRanking[]> {
  const supabase = getSupabase();

  const { data: members } = await supabase
    .from('club_members')
    .select('user_id, profiles(display_name, avatar_url, total_distance_km)')
    .eq('club_id', clubId);

  if (!members?.length) return [];

  return members
    .map(m => {
      const profile = m.profiles as unknown as { display_name: string; avatar_url: string | null; total_distance_km: number };
      return {
        user_id: m.user_id,
        display_name: profile?.display_name || '러너',
        avatar_url: profile?.avatar_url || null,
        total_distance_km: profile?.total_distance_km || 0,
      };
    })
    .sort((a, b) => b.total_distance_km - a.total_distance_km);
}

// 명예의 전당 (특정 월)
export async function fetchHallOfFame(clubId: string, year: number, month: number): Promise<HallOfFameEntry[]> {
  const [members, runCounts] = await Promise.all([
    fetchClubMemberProgress(clubId, year, month),
    fetchMemberRunCounts(clubId, year, month),
  ]);

  const entries: HallOfFameEntry[] = [];

  // 영광의 롱러너 — 월간 최장 거리 달성 횟수 (이번 달 1위)
  const sortedByDistance = [...members].sort((a, b) => b.distance_km - a.distance_km);
  if (sortedByDistance.length > 0 && sortedByDistance[0].distance_km > 0) {
    entries.push({
      category: 'long_runner',
      label: '영광의 롱러너',
      emoji: '🏆',
      description: '월간 최장 거리 달성',
      winners: sortedByDistance
        .filter(m => m.distance_km > 0)
        .slice(0, 3)
        .map(m => ({ user_id: m.user_id, display_name: m.display_name, value: m.distance_km, count: 0 })),
    });
  }

  // 영광의 피니셔 — 월 목표 달성 횟수
  const finishers = members.filter(m => m.progress >= 100);
  if (finishers.length > 0) {
    entries.push({
      category: 'finisher',
      label: '영광의 피니셔',
      emoji: '🥇',
      description: '월 목표 달성 횟수',
      winners: finishers.map(m => ({ user_id: m.user_id, display_name: m.display_name, value: m.distance_km, count: 0 })),
    });
  }

  // 영광의 개근상 — 월간 러닝 횟수 1위
  if (runCounts.length > 0) {
    entries.push({
      category: 'consistent',
      label: '영광의 개근상',
      emoji: '🔥',
      description: '월간 러닝 횟수 1위',
      winners: runCounts
        .slice(0, 3)
        .map(r => ({ user_id: r.user_id, display_name: r.display_name, value: r.run_count, count: r.run_count })),
    });
  }

  return entries;
}

// 러닝 캘린더 히트맵 데이터 (클럽 전체)
export async function fetchClubCalendar(clubId: string, year: number, month: number): Promise<Map<string, number>> {
  const supabase = getSupabase();

  const { data: members } = await supabase
    .from('club_members')
    .select('user_id')
    .eq('club_id', clubId);

  if (!members?.length) return new Map();

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

  const userIds = members.map(m => m.user_id);

  const { data: activities } = await supabase
    .from('activities')
    .select('user_id, activity_date')
    .in('user_id', userIds)
    .gte('activity_date', startDate)
    .lt('activity_date', endDate);

  // 날짜별 고유 사용자 수 계산
  const dateUserMap = new Map<string, Set<string>>();
  (activities || []).forEach(a => {
    if (!dateUserMap.has(a.activity_date)) dateUserMap.set(a.activity_date, new Set());
    dateUserMap.get(a.activity_date)!.add(a.user_id);
  });

  const result = new Map<string, number>();
  dateUserMap.forEach((users, date) => result.set(date, users.size));
  return result;
}

// =============================================
// 개인 통계 분석
// =============================================

export interface PersonalBest {
  longestRun: { distance_km: number; date: string } | null;
  fastestPace: { pace: number; date: string; distance_km: number } | null;
  longestDuration: { duration: number; date: string } | null;
  mostCalories: { calories: number; date: string } | null;
}

export interface DayOfWeekStat {
  day: string; // 월, 화, ...
  dayIndex: number;
  runCount: number;
  totalDistance: number;
  avgDistance: number;
}

export interface HourOfDayStat {
  hour: number;
  label: string;
  runCount: number;
}

export interface PaceTrend {
  month: string;
  avgPace: number | null; // sec/km
  runCount: number;
}

// 개인 베스트 기록
export async function fetchPersonalBests(userId: string): Promise<PersonalBest> {
  const supabase = getSupabase();

  const { data } = await supabase
    .from('activities')
    .select('distance_km, duration_seconds, pace_avg_sec_per_km, calories, activity_date')
    .eq('user_id', userId)
    .order('activity_date', { ascending: false })
    .limit(1000);

  if (!data?.length) return { longestRun: null, fastestPace: null, longestDuration: null, mostCalories: null };

  let longestRun: PersonalBest['longestRun'] = null;
  let fastestPace: PersonalBest['fastestPace'] = null;
  let longestDuration: PersonalBest['longestDuration'] = null;
  let mostCalories: PersonalBest['mostCalories'] = null;

  for (const a of data) {
    const km = Number(a.distance_km);
    if (!longestRun || km > longestRun.distance_km) longestRun = { distance_km: km, date: a.activity_date };
    if (a.pace_avg_sec_per_km && km >= 1 && (!fastestPace || a.pace_avg_sec_per_km < fastestPace.pace)) {
      fastestPace = { pace: a.pace_avg_sec_per_km, date: a.activity_date, distance_km: km };
    }
    if (a.duration_seconds && (!longestDuration || a.duration_seconds > longestDuration.duration)) {
      longestDuration = { duration: a.duration_seconds, date: a.activity_date };
    }
    if (a.calories && (!mostCalories || a.calories > mostCalories.calories)) {
      mostCalories = { calories: a.calories, date: a.activity_date };
    }
  }

  return { longestRun, fastestPace, longestDuration, mostCalories };
}

// 요일별 패턴 분석
export async function fetchDayOfWeekStats(userId: string): Promise<DayOfWeekStat[]> {
  const supabase = getSupabase();

  const { data } = await supabase
    .from('activities')
    .select('activity_date, distance_km')
    .eq('user_id', userId)
    .order('activity_date', { ascending: false })
    .limit(1000);

  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const stats = days.map((day, i) => ({ day, dayIndex: i, runCount: 0, totalDistance: 0, avgDistance: 0 }));

  (data || []).forEach(a => {
    const dayIndex = new Date(a.activity_date).getDay();
    stats[dayIndex].runCount++;
    stats[dayIndex].totalDistance += Number(a.distance_km);
  });

  stats.forEach(s => { s.avgDistance = s.runCount > 0 ? Math.round((s.totalDistance / s.runCount) * 10) / 10 : 0; });
  return stats;
}

// 시간대별 러닝 분포
export async function fetchHourOfDayStats(userId: string): Promise<HourOfDayStat[]> {
  const supabase = getSupabase();

  const { data } = await supabase
    .from('activities')
    .select('started_at')
    .eq('user_id', userId)
    .not('started_at', 'is', null)
    .order('activity_date', { ascending: false })
    .limit(1000);

  const hours: HourOfDayStat[] = [];
  for (let h = 0; h < 24; h++) {
    const label = h < 6 ? '새벽' : h < 12 ? '오전' : h < 18 ? '오후' : '저녁';
    hours.push({ hour: h, label: `${h}시`, runCount: 0 });
  }

  (data || []).forEach(a => {
    if (!a.started_at) return;
    const hour = new Date(a.started_at).getHours();
    hours[hour].runCount++;
  });

  return hours;
}

// 월별 페이스 추이 (최근 12개월)
export async function fetchPaceTrend(userId: string): Promise<PaceTrend[]> {
  const supabase = getSupabase();
  const now = new Date();

  const startDate = toLocalDateStr(new Date(now.getFullYear() - 1, now.getMonth(), 1));

  const { data } = await supabase
    .from('activities')
    .select('activity_date, pace_avg_sec_per_km, distance_km')
    .eq('user_id', userId)
    .gte('activity_date', startDate)
    .not('pace_avg_sec_per_km', 'is', null)
    .order('activity_date');

  const monthMap = new Map<string, { totalPace: number; count: number }>();

  (data || []).forEach(a => {
    if (!a.pace_avg_sec_per_km || Number(a.distance_km) < 1) return;
    const key = a.activity_date.substring(0, 7); // YYYY-MM
    const entry = monthMap.get(key) || { totalPace: 0, count: 0 };
    entry.totalPace += a.pace_avg_sec_per_km;
    entry.count++;
    monthMap.set(key, entry);
  });

  const results: PaceTrend[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const entry = monthMap.get(key);
    results.push({
      month: `${d.getMonth() + 1}월`,
      avgPace: entry ? Math.round(entry.totalPace / entry.count) : null,
      runCount: entry?.count || 0,
    });
  }

  return results;
}

export interface PeriodDistance {
  label: string;
  distance: number;
  prevDistance?: number; // 전년 동기 비교
}

// 기간별 거리 데이터
export async function fetchDistanceByPeriod(
  userId: string,
  mode: 'weekly' | 'monthly' | 'quarterly' | 'half' | 'yearly',
  year: number,
): Promise<PeriodDistance[]> {
  const supabase = getSupabase();

  // 올해 + 작년 데이터 한 번에 가져오기
  const { data: activities } = await supabase
    .from('activities')
    .select('activity_date, distance_km')
    .eq('user_id', userId)
    .gte('activity_date', `${year - 1}-01-01`)
    .lt('activity_date', `${year + 1}-01-01`)
    .order('activity_date');

  if (!activities) return [];

  const thisYear = activities.filter(a => a.activity_date.startsWith(String(year)));
  const lastYear = activities.filter(a => a.activity_date.startsWith(String(year - 1)));

  const sumByRange = (data: typeof activities, start: string, end: string) =>
    data.filter(a => a.activity_date >= start && a.activity_date < end)
      .reduce((s, a) => s + Number(a.distance_km), 0);

  const results: PeriodDistance[] = [];

  if (mode === 'weekly') {
    // 올해의 각 주 (최근 12주) + 작년 동일 주 (-364일 = 정확히 52주 전).
    // 사용자 신고 #4: 주간 차트에 전년 비교 막대가 안 보이는 버그 — prevDistance 필드 누락이 원인.
    const now = new Date();
    const ONE_DAY = 86400000;
    for (let w = 11; w >= 0; w--) {
      const weekEnd = new Date(now);
      weekEnd.setDate(now.getDate() - w * 7);
      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekEnd.getDate() - 6);

      const start = toLocalDateStr(weekStart);
      const end = toLocalDateStr(new Date(weekEnd.getTime() + ONE_DAY));

      // 작년 동일 주 — 364일 전 (52주). 정확히 같은 요일/주차.
      const prevStart = toLocalDateStr(new Date(weekStart.getTime() - 364 * ONE_DAY));
      const prevEnd = toLocalDateStr(new Date(weekEnd.getTime() + ONE_DAY - 364 * ONE_DAY));

      results.push({
        label: `${weekStart.getMonth() + 1}/${weekStart.getDate()}`,
        distance: Math.round(sumByRange(thisYear, start, end) * 10) / 10,
        prevDistance: Math.round(sumByRange(lastYear, prevStart, prevEnd) * 10) / 10,
      });
    }
  } else if (mode === 'monthly') {
    for (let m = 1; m <= 12; m++) {
      const start = `${year}-${String(m).padStart(2, '0')}-01`;
      const endM = m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, '0')}-01`;
      const prevStart = `${year - 1}-${String(m).padStart(2, '0')}-01`;
      const prevEnd = m === 12 ? `${year}-01-01` : `${year - 1}-${String(m + 1).padStart(2, '0')}-01`;

      results.push({
        label: `${m}월`,
        distance: Math.round(sumByRange(thisYear, start, endM) * 10) / 10,
        prevDistance: Math.round(sumByRange(lastYear, prevStart, prevEnd) * 10) / 10,
      });
    }
  } else if (mode === 'quarterly') {
    for (let q = 0; q < 4; q++) {
      const start = `${year}-${String(q * 3 + 1).padStart(2, '0')}-01`;
      const end = q === 3 ? `${year + 1}-01-01` : `${year}-${String((q + 1) * 3 + 1).padStart(2, '0')}-01`;
      const prevStart = `${year - 1}-${String(q * 3 + 1).padStart(2, '0')}-01`;
      const prevEnd = q === 3 ? `${year}-01-01` : `${year - 1}-${String((q + 1) * 3 + 1).padStart(2, '0')}-01`;

      results.push({
        label: `Q${q + 1}`,
        distance: Math.round(sumByRange(thisYear, start, end) * 10) / 10,
        prevDistance: Math.round(sumByRange(lastYear, prevStart, prevEnd) * 10) / 10,
      });
    }
  } else if (mode === 'half') {
    for (let h = 0; h < 2; h++) {
      const start = `${year}-${String(h * 6 + 1).padStart(2, '0')}-01`;
      const end = h === 1 ? `${year + 1}-01-01` : `${year}-07-01`;
      const prevStart = `${year - 1}-${String(h * 6 + 1).padStart(2, '0')}-01`;
      const prevEnd = h === 1 ? `${year}-01-01` : `${year - 1}-07-01`;

      results.push({
        label: h === 0 ? '상반기' : '하반기',
        distance: Math.round(sumByRange(thisYear, start, end) * 10) / 10,
        prevDistance: Math.round(sumByRange(lastYear, prevStart, prevEnd) * 10) / 10,
      });
    }
  } else {
    // yearly — 최근 5년. 각 해마다 전년 대비 (이전 해) prevDistance 부여 — 분석 줄에서 사용.
    // 단, year-1 보다 더 이전 해의 데이터는 fetch 범위에 없어 N/A 처리.
    // build 68 fix: 현재 연도(running year)는 작년 "동기간" (1/1 ~ 오늘 같은 월·일까지) 으로
    // 비교해야 음수가 안 나옴. 기존엔 작년 1년 전체 합과 비교 → 항상 음수.
    // build 74: KST 기준으로 today 계산 (activity_date 가 KST 기준이라 디바이스 timezone 차이로
    // 새벽에 ±1일 어긋나는 문제 방지).
    const ymdKst = (() => {
      try {
        return new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Seoul',
          year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date());
      } catch {
        const k = new Date(Date.now() + 9 * 60 * 60 * 1000);
        return k.toISOString().slice(0, 10);
      }
    })();
    const [yKst, mKst, dKst] = ymdKst.split('-');
    const isThisYear = year === Number(yKst);
    const ytdEnd = isThisYear ? `${year - 1}-${mKst}-${dKst}` : null;

    for (let y = year - 4; y <= year; y++) {
      const yActivities = activities.filter(a => a.activity_date.startsWith(String(y)));
      const dist = yActivities.reduce((s, a) => s + Number(a.distance_km), 0);
      let prevDist: number | undefined;
      if (y === year) {
        const prevYActs = activities.filter(a => a.activity_date.startsWith(String(y - 1)));
        if (isThisYear && ytdEnd) {
          // 작년 1/1 ~ 오늘 같은 월·일 까지만 합산. ex) 오늘 5/9 → 2025-01-01..2025-05-09 합.
          const ytdSum = prevYActs
            .filter(a => a.activity_date <= ytdEnd)
            .reduce((s, a) => s + Number(a.distance_km), 0);
          prevDist = Math.round(ytdSum * 10) / 10;
        } else {
          prevDist = Math.round(prevYActs.reduce((s, a) => s + Number(a.distance_km), 0) * 10) / 10;
        }
      }
      results.push({
        label: `${y}`,
        distance: Math.round(dist * 10) / 10,
        prevDistance: prevDist,
      });
    }
  }

  return results;
}
