// Best Splits 계산 + PB 갱신 (build 197).
// 활동의 GPS 좌표 + timestamp 스트림에서 sliding window 로 target 거리 (1km/3km/5km/10km/half/full)
// 의 최단 시간을 찾음.
//
// 알고리즘 (직접 작성):
// 1. coords [lng, lat, alt, unix_seconds] → cumulative distance (m) + cumulative time (s)
// 2. 각 target 거리마다 모든 시작 인덱스에서 target 거리 도달까지 걸린 시간 측정
// 3. 그 중 최소 = best split
//
// MPL 차용 안 함 — Elevate 의 SplitCalculator 는 평균값(power/HR 등) 용. 여기는 시간 기반이라 다름.

import { getSupabase } from './supabase';

export interface BestSplit {
  distanceMeters: number;
  bestSeconds: number;
  startIdx: number;     // coords array 인덱스
  endIdx: number;
}

export const STANDARD_PB_DISTANCES: number[] = [
  1000,      // 1km
  3000,      // 3km
  5000,      // 5km
  10000,     // 10km
  21097,     // half marathon
  42195,     // full marathon
];

function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const c = sinDLat * sinDLat + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.sqrt(c));
}

interface CoordEntry { lng: number; lat: number; t: number; }

function normalizeCoords(coords: Array<[number, number, number?, number?]>): CoordEntry[] {
  // 4-tuple: [lng, lat, alt, unix_seconds]. timestamp 없으면 균등 분배 시간 가정.
  if (coords.length === 0) return [];
  const hasTs = coords[0].length >= 4 && typeof coords[0][3] === 'number';
  if (hasTs) {
    return coords.map(c => ({ lng: c[0], lat: c[1], t: c[3] as number }));
  }
  // 폴백: 1초 간격 가정 (HealthKit 일부 데이터)
  return coords.map((c, i) => ({ lng: c[0], lat: c[1], t: i }));
}

// activity 의 route_data.coordinates 와 (선택) duration 으로 best splits 계산.
// duration 은 timestamp 없을 때 균등 분배용. 있어도 cumulative 시간 기준.
export function computeBestSplits(
  coords: Array<[number, number, number?, number?]>,
  targetDistances: number[] = STANDARD_PB_DISTANCES,
): BestSplit[] {
  const pts = normalizeCoords(coords);
  if (pts.length < 2) return [];

  // cumulative distance + cumulative time
  const cumDist: number[] = [0];
  const cumTime: number[] = [0];
  const startT = pts[0].t;
  for (let i = 1; i < pts.length; i++) {
    const d = haversineMeters([pts[i - 1].lng, pts[i - 1].lat], [pts[i].lng, pts[i].lat]);
    cumDist.push(cumDist[i - 1] + d);
    cumTime.push(pts[i].t - startT);
  }

  const totalDist = cumDist[cumDist.length - 1];
  const results: BestSplit[] = [];

  for (const target of targetDistances) {
    if (target > totalDist) continue;

    let best: BestSplit | null = null;
    let endIdx = 0;
    // two-pointer: 각 시작 i 에 대해 target 거리 도달하는 가장 가까운 end 찾기
    for (let i = 0; i < cumDist.length; i++) {
      // endIdx 가 i 보다 작거나 같으면 조정
      if (endIdx <= i) endIdx = i + 1;
      // target 거리 도달 또는 끝까지
      while (endIdx < cumDist.length && cumDist[endIdx] - cumDist[i] < target) {
        endIdx++;
      }
      if (endIdx >= cumDist.length) break;
      // endIdx 가 target 거리 직후 (선형 보간으로 정확도 ↑)
      const overDist = cumDist[endIdx] - cumDist[i];           // target 초과
      const dT = cumTime[endIdx] - cumTime[i];                 // 그 사이 시간
      const prevDist = cumDist[endIdx - 1] - cumDist[i];       // target 직전
      const prevT = cumTime[endIdx - 1] - cumTime[i];
      // 보간: target 거리에 정확히 도달하는 시간
      let elapsed: number;
      if (overDist === prevDist) {
        elapsed = dT;
      } else {
        const ratio = (target - prevDist) / (overDist - prevDist);
        elapsed = prevT + (dT - prevT) * ratio;
      }
      if (best === null || elapsed < best.bestSeconds) {
        best = { distanceMeters: target, bestSeconds: Math.round(elapsed), startIdx: i, endIdx };
      }
    }

    if (best) results.push(best);
  }

  return results;
}

// 활동 저장 직후 호출 — 새 PB 감지하고 upsert.
// 반환: 새로 갱신된 PB 목록 (toast / 알림용)
export interface NewPB {
  distanceMeters: number;
  newSeconds: number;
  prevSeconds: number | null;
  improvementSec: number | null;
}

export async function syncPBsFromActivity(
  activityId: string,
  coords: Array<[number, number, number?, number?]>,
  endedAtIso: string,
): Promise<NewPB[]> {
  if (coords.length < 5) return [];
  const splits = computeBestSplits(coords);
  if (splits.length === 0) return [];

  const supabase = getSupabase();
  const newPBs: NewPB[] = [];

  // 직렬 호출 (RLS + 사용자 PB 갱신 race 회피). 6 distances max 라 부담 적음.
  for (const sp of splits) {
    const { data, error } = await supabase.rpc('upsert_personal_best', {
      p_distance_meters: sp.distanceMeters,
      p_best_seconds: sp.bestSeconds,
      p_activity_id: activityId,
      p_achieved_at: endedAtIso,
    });
    if (error) { console.warn('[best-splits] upsert fail', sp.distanceMeters, error); continue; }
    const row = Array.isArray(data) ? data[0] : null;
    if (row?.is_new_pb) {
      newPBs.push({
        distanceMeters: sp.distanceMeters,
        newSeconds: sp.bestSeconds,
        prevSeconds: row.prev_seconds ?? null,
        improvementSec: row.prev_seconds ? row.prev_seconds - sp.bestSeconds : null,
      });
    }
  }
  return newPBs;
}

// 표시용 라벨
export function distanceLabel(meters: number): string {
  if (meters === 21097) return '하프';
  if (meters === 42195) return '풀';
  if (meters >= 1000) return `${meters / 1000}km`;
  return `${meters}m`;
}

export function formatSplitTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function formatPaceFromSplit(distanceMeters: number, seconds: number): string {
  const paceSec = seconds / (distanceMeters / 1000);
  const m = Math.floor(paceSec / 60);
  const s = Math.floor(paceSec % 60);
  return `${m}'${s.toString().padStart(2, '0')}"`;
}
