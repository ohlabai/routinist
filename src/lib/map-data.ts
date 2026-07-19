import { getSupabase } from './supabase';
import { daysAgoStr } from './kst';
import { haversineMeters } from './gps-tracking';
import type { Activity } from '@/types';
import type { GeoJSONLineString } from '@/types';

// 2026-07-19 (지도 리뷰): GPS 튐 좌표 방어 — 튄 점 하나가 fitBounds 를 대륙 단위로
// 축소시키고 히트맵 셀을 오염시킴. fetch 단계에서 한 번 걸러 모든 소비처(지도 히트맵·
// 홈 미니맵·동네 페이지)가 깨끗한 좌표를 받게 한다.
const MAX_RUN_SPEED_MPS = 10;   // 36 km/h — 러닝에서 불가능한 순간속도
const MIN_SPEED_REJECT_M = 50;  // 짧은 지터가 Δt 오차로 고속 판정되는 것 방지
const MAX_JUMP_NO_TS_M = 500;   // ts 없는 옛 3-tuple 경로용 점프 한계
const REANCHOR_AFTER = 6;       // 연속 제외 한도 — 앵커 자체가 튄 점이었던 케이스 복구

export function sanitizeRouteCoords(
  coords: GeoJSONLineString['coordinates'],
): GeoJSONLineString['coordinates'] {
  if (!coords || coords.length < 3) return coords;
  // route_data ts 는 unix 초 (build 151), 일부 경로는 ms — 자동 판별.
  const toMs = (ts: unknown): number | null =>
    typeof ts === 'number' && ts > 0 ? (ts > 1e12 ? ts : ts * 1000) : null;
  const isBrokenStep = (
    prev: GeoJSONLineString['coordinates'][number],
    cur: GeoJSONLineString['coordinates'][number],
  ): boolean => {
    const dist = haversineMeters({ lat: prev[1], lng: prev[0] }, { lat: cur[1], lng: cur[0] });
    const t1 = toMs(prev[3]);
    const t2 = toMs(cur[3]);
    if (t1 !== null && t2 !== null && t2 > t1) {
      return dist > MIN_SPEED_REJECT_M && dist / ((t2 - t1) / 1000) > MAX_RUN_SPEED_MPS;
    }
    return dist > MAX_JUMP_NO_TS_M;
  };

  const out: GeoJSONLineString['coordinates'] = [coords[0]];
  let rejects = 0;
  for (let i = 1; i < coords.length; i++) {
    const cur = coords[i];
    if (isBrokenStep(out[out.length - 1], cur)) {
      rejects++;
      if (rejects >= REANCHOR_AFTER) { out.push(cur); rejects = 0; }
      continue;
    }
    rejects = 0;
    out.push(cur);
  }
  // 첫 점이 튄 점이면 이후 전부와 어긋남 — 선두를 다듬는다.
  while (out.length >= 2 && isBrokenStep(out[0], out[1])) out.shift();
  // 과반이 잘리면 필터 판단 불신 (차량 이동 통짜 기록 등) — 원본 유지.
  return out.length >= coords.length * 0.5 ? out : coords;
}

interface FetchRoutesOptions {
  year?: number;
  month?: number;
  /** 최근 N 일 — year/month 없을 때 사용. 'all' 모드면 undefined. */
  daysBack?: number;
  /** 페이지 크기. 기본 1000 (이전 200 은 활동 많은 사용자 옛날 경로 누락). */
  pageSize?: number;
  /** offset (페이지네이션). 기본 0. */
  offset?: number;
}

export async function fetchRoutesForUser(
  userId: string,
  options: FetchRoutesOptions = {},
): Promise<Activity[]> {
  const supabase = getSupabase();
  const pageSize = options.pageSize ?? 1000;
  const offset = options.offset ?? 0;

  let query = supabase
    .from('activities')
    .select('id, activity_date, distance_km, duration_seconds, route_data')
    .eq('user_id', userId)
    .not('route_data', 'is', null)
    .order('activity_date', { ascending: false });

  if (options.year && options.month) {
    const { year, month } = options;
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endMonth = month === 12 ? 1 : month + 1;
    const endYear = month === 12 ? year + 1 : year;
    const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;
    query = query.gte('activity_date', startDate).lt('activity_date', endDate);
  } else if (typeof options.daysBack === 'number') {
    // toISOString 은 UTC 라 KST 새벽에 컷오프가 하루 어긋남 — 로컬 날짜 기준 daysAgoStr 사용
    query = query.gte('activity_date', daysAgoStr(options.daysBack));
  }

  const { data, error } = await query.range(offset, offset + pageSize - 1);
  if (error) throw error;
  return ((data || []) as Activity[]).map(a =>
    a.route_data?.coordinates?.length
      ? { ...a, route_data: { ...a.route_data, coordinates: sanitizeRouteCoords(a.route_data.coordinates) } }
      : a
  );
}
