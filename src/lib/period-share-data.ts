// 주간·월간 공유카드용 데이터 fetch (build 195).

import { getSupabase } from './supabase';
import type { PeriodChartData } from './period-share-canvas';

interface ActivityRow {
  activity_date: string | null;
  distance_km: number | string;
  duration_seconds: number | null;
  pace_avg_sec_per_km: number | null;
}

function userLocalDate(d: Date): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

// 옵션 D: 모수 ≤3 친근 메시지, 그 이상 "8위 · 강남구 50명".
export function rankLineFromHero(hero: {
  scope_label?: string | null;
  rank_position?: number | null;
  total_in_scope?: number | null;
} | null, periodWord: '이번 주' | '이번 달'): string | null {
  if (!hero) return null;
  const total = hero.total_in_scope ?? 0;
  const rank = hero.rank_position ?? 0;
  const scope = hero.scope_label ?? '';
  if (rank === 0 || total === 0) return null;
  if (total <= 3) {
    if (rank === 1) return `${scope} ${periodWord} 1위 ✨`;
    return `${scope} ${periodWord} ${rank}위`;
  }
  return `${rank}위 · ${scope} ${total}명`;
}

// 사용자 timezone 의 이번 주 (월~일) 시작일 ISO 문자열 반환.
function getWeekStart(today: Date): Date {
  // 월요일 시작 (KST/Asia 통상)
  const dow = today.getDay();                 // 0=일, 1=월, ...
  const diff = (dow + 6) % 7;                 // 월요일까지 며칠 전
  const d = new Date(today);
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export interface PeriodFetchResult { data: PeriodChartData; }

export async function fetchWeekChartData(userId: string, userName: string): Promise<PeriodFetchResult> {
  const supabase = getSupabase();
  const today = new Date();
  const weekStart = getWeekStart(today);
  const prevWeekStart = addDays(weekStart, -7);
  const prevWeekEnd = addDays(weekStart, -1);

  const weekStartIso = userLocalDate(weekStart);
  const weekEndIso = userLocalDate(addDays(weekStart, 6));
  const prevStartIso = userLocalDate(prevWeekStart);
  const prevEndIso = userLocalDate(prevWeekEnd);

  // 이번 주 + 지난 주 활동 한 번에 fetch (range)
  const { data: rows } = await supabase
    .from('activities')
    .select('activity_date,distance_km,duration_seconds,pace_avg_sec_per_km')
    .eq('user_id', userId)
    .gte('activity_date', prevStartIso)
    .lte('activity_date', weekEndIso);

  const activities = (rows ?? []) as ActivityRow[];

  // 이번 주 일별 거리 (월~일 7개)
  const bars: number[] = Array(7).fill(0);
  const barLabels = ['월', '화', '수', '목', '금', '토', '일'];
  let totalKm = 0;
  let totalSec = 0;
  let runs = 0;
  let paceSum = 0;
  let paceCount = 0;

  for (const a of activities) {
    if (!a.activity_date) continue;
    const km = Number(a.distance_km) || 0;
    if (a.activity_date >= weekStartIso && a.activity_date <= weekEndIso) {
      const idx = Math.floor((new Date(a.activity_date).getTime() - weekStart.getTime()) / (24 * 60 * 60 * 1000));
      if (idx >= 0 && idx < 7) bars[idx] += km;
      totalKm += km;
      totalSec += a.duration_seconds ?? 0;
      runs++;
      if (a.pace_avg_sec_per_km) { paceSum += a.pace_avg_sec_per_km; paceCount++; }
    }
  }

  // 지난 주 누적
  let prevTotalKm = 0;
  for (const a of activities) {
    if (!a.activity_date) continue;
    if (a.activity_date >= prevStartIso && a.activity_date <= prevEndIso) {
      prevTotalKm += Number(a.distance_km) || 0;
    }
  }

  // 랭킹
  const { data: heroData } = await supabase.rpc('find_hero_rank', {
    target_user_id: userId, time_axis: 'week',
  });
  const hero = Array.isArray(heroData) ? heroData[0] : null;
  const rankLine = rankLineFromHero(hero, '이번 주');

  // 라벨 (5/19 ~ 5/25)
  const fmtMd = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  const periodLabel = `${fmtMd(weekStart)} ~ ${fmtMd(addDays(weekStart, 6))}`;

  return {
    data: {
      period: 'week',
      userName,
      periodLabel,
      bars: bars.map(v => Number(v.toFixed(2))),
      barLabels,
      totalKm: Number(totalKm.toFixed(1)),
      prevTotalKm: Number(prevTotalKm.toFixed(1)),
      totalDurationSec: totalSec,
      avgPaceSec: paceCount > 0 ? Math.round(paceSum / paceCount) : null,
      runs,
      rankLine,
    },
  };
}

export async function fetchMonthChartData(userId: string, userName: string): Promise<PeriodFetchResult> {
  const supabase = getSupabase();
  const today = new Date();
  const yy = today.getFullYear();
  const mm = today.getMonth(); // 0~11
  const monthStart = new Date(yy, mm, 1);
  const monthEnd = new Date(yy, mm + 1, 0);
  const daysInMonth = monthEnd.getDate();
  const prevMonthStart = new Date(yy, mm - 1, 1);
  const prevMonthEnd = new Date(yy, mm, 0);

  const startIso = userLocalDate(monthStart);
  const endIso = userLocalDate(monthEnd);
  const prevStartIso = userLocalDate(prevMonthStart);
  const prevEndIso = userLocalDate(prevMonthEnd);

  const { data: rows } = await supabase
    .from('activities')
    .select('activity_date,distance_km,duration_seconds,pace_avg_sec_per_km')
    .eq('user_id', userId)
    .gte('activity_date', prevStartIso)
    .lte('activity_date', endIso);

  const activities = (rows ?? []) as ActivityRow[];

  // 일별 막대 — 28~31개. 라벨은 5개씩만 표기 (1, 6, 11, 16, 21, 26).
  const bars: number[] = Array(daysInMonth).fill(0);
  const barLabels: string[] = Array(daysInMonth).fill('');
  for (let i = 0; i < daysInMonth; i++) {
    const day = i + 1;
    if (day === 1 || day % 5 === 1 || day === daysInMonth) barLabels[i] = String(day);
  }

  let totalKm = 0;
  let totalSec = 0;
  let runs = 0;
  let paceSum = 0;
  let paceCount = 0;
  let prevTotalKm = 0;

  for (const a of activities) {
    if (!a.activity_date) continue;
    const km = Number(a.distance_km) || 0;
    if (a.activity_date >= startIso && a.activity_date <= endIso) {
      const d = new Date(a.activity_date);
      const dayIdx = d.getDate() - 1;
      if (dayIdx >= 0 && dayIdx < daysInMonth) bars[dayIdx] += km;
      totalKm += km;
      totalSec += a.duration_seconds ?? 0;
      runs++;
      if (a.pace_avg_sec_per_km) { paceSum += a.pace_avg_sec_per_km; paceCount++; }
    } else if (a.activity_date >= prevStartIso && a.activity_date <= prevEndIso) {
      prevTotalKm += km;
    }
  }

  const { data: heroData } = await supabase.rpc('find_hero_rank', {
    target_user_id: userId, time_axis: 'month',
  });
  const hero = Array.isArray(heroData) ? heroData[0] : null;
  const rankLine = rankLineFromHero(hero, '이번 달');

  const periodLabel = `${yy}년 ${mm + 1}월`;

  return {
    data: {
      period: 'month',
      userName,
      periodLabel,
      bars: bars.map(v => Number(v.toFixed(2))),
      barLabels,
      totalKm: Number(totalKm.toFixed(1)),
      prevTotalKm: Number(prevTotalKm.toFixed(1)),
      totalDurationSec: totalSec,
      avgPaceSec: paceCount > 0 ? Math.round(paceSum / paceCount) : null,
      runs,
      rankLine,
    },
  };
}
