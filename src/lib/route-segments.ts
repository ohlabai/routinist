// build 327 (2026-07-29, 이승우 신고 "지도 보면 하늘을 날아서 온 것"):
// GPS 공백(화면 꺼짐·타 앱 경합·터널 등) 전후 좌표를 폴리라인이 직선으로 이어버려
// 지도에 하늘을 가로지르는 선이 그려졌다. 렌더링 시 공백 지점에서 세그먼트를 끊는다.
// 데이터 포맷은 그대로 (route_data 무변경) — 이미 저장된 기록도 소급해서 고쳐진다.
//
// 공백 판정: ① 연속 좌표의 timestamp 간격 > 60s (좌표 4번째 슬롯, unix sec)
//           ② ts 없는 레거시 좌표는 연속 좌표 거리 > 300m (정상 수신 주기에선 불가능)

export const ROUTE_GAP_SEC = 60;
export const ROUTE_GAP_M = 300;

type Pt = readonly (number | undefined)[]; // [lng, lat, alt?, tsSec?] — GeoJSON 좌표는 3·4번 슬롯 optional

export function isRouteGap(prev: Pt, cur: Pt): boolean {
  const t1 = prev[3];
  const t2 = cur[3];
  if (typeof t1 === 'number' && typeof t2 === 'number' && t1 > 0 && t2 > 0) {
    if (Math.abs(t2 - t1) > ROUTE_GAP_SEC) return true;
  }
  const lng1 = prev[0] ?? 0, lat1 = prev[1] ?? 0;
  const lng2 = cur[0] ?? 0, lat2 = cur[1] ?? 0;
  // 등장방형 근사 (렌더링 판정용 — 정밀 haversine 불필요)
  const dLat = (lat2 - lat1) * 111320;
  const dLng = (lng2 - lng1) * 111320 * Math.cos((lat2 * Math.PI) / 180);
  return Math.hypot(dLat, dLng) > ROUTE_GAP_M;
}

/** 좌표 배열을 공백 기준으로 세그먼트들로 분리. 1점짜리 세그먼트는 버림. */
export function splitRouteByGaps<T extends Pt>(coords: T[]): T[][] {
  const out: T[][] = [];
  let seg: T[] = [];
  for (let i = 0; i < coords.length; i++) {
    if (i > 0 && isRouteGap(coords[i - 1], coords[i])) {
      if (seg.length >= 2) out.push(seg);
      seg = [];
    }
    seg.push(coords[i]);
  }
  if (seg.length >= 2) out.push(seg);
  return out;
}
