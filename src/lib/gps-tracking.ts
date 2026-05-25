// 미니멀 GPS 트래킹 라이브러리 (build 194).
// - Capacitor Geolocation watchPosition → 좌표 스트림
// - Haversine 거리 계산
// - 일시정지/재개 지원
// - localStorage 에 진행 상태 저장 (앱 죽음·OS 강제종료 복원)
//
// 의도적 미포함: 실시간 페이스 (안 3), 음성 안내, Live Activity, 자동 일시정지.
// 표시 데이터는 시간 + 누적 거리 + 지도뿐.

import { Geolocation, type Position } from '@capacitor/geolocation';

export type Coord = [lng: number, lat: number, alt: number, ts: number];

export interface TrackingState {
  startedAt: number;          // epoch ms
  elapsedSeconds: number;     // 누적 활동 시간 (일시정지 제외)
  distanceMeters: number;     // 누적 거리 (m)
  coords: Coord[];            // [lng, lat, alt, ts] (GeoJSON LineString 호환)
  status: 'active' | 'paused' | 'idle';
  lastTickAt: number;         // 직전 tick epoch ms (시간 누적용)
}

const STORAGE_KEY = 'routinist:gps-tracking-v1';
const MIN_ACCURACY_METERS = 30;   // 정확도 30m 이하 좌표만 사용
const MIN_MOVE_METERS = 3;        // 직전 좌표와 3m 이상 이동했을 때만 거리·polyline 갱신

export function loadState(): TrackingState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as TrackingState;
    if (s.status !== 'active' && s.status !== 'paused') return null;
    return s;
  } catch { return null; }
}

export function saveState(s: TrackingState): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}

export function clearState(): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
}

export function createInitialState(): TrackingState {
  const now = Date.now();
  return {
    startedAt: now,
    elapsedSeconds: 0,
    distanceMeters: 0,
    coords: [],
    status: 'active',
    lastTickAt: now,
  };
}

// Haversine — 두 좌표 사이 거리 (m).
export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const c = sinDLat * sinDLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.sqrt(c));
}

export async function requestLocationPermission(): Promise<'granted' | 'denied' | 'prompt'> {
  try {
    const r = await Geolocation.requestPermissions();
    // Capacitor 의 location 권한은 location, coarseLocation 두 키. 둘 중 하나라도 granted 면 OK.
    const ok = r.location === 'granted' || r.coarseLocation === 'granted';
    if (ok) return 'granted';
    if (r.location === 'denied' || r.coarseLocation === 'denied') return 'denied';
    return 'prompt';
  } catch { return 'denied'; }
}

export interface WatcherHandle { clear: () => Promise<void>; }

export async function startWatcher(
  onCoord: (pos: { lat: number; lng: number; alt: number; ts: number; accuracy: number }) => void,
): Promise<WatcherHandle> {
  const id = await Geolocation.watchPosition(
    { enableHighAccuracy: true, timeout: 30000 },
    (pos: Position | null, err) => {
      if (err || !pos) return;
      // 정확도 30m 초과 좌표는 무시 — 도심 빌딩가에서 튀는 GPS 차단.
      if ((pos.coords.accuracy ?? 999) > MIN_ACCURACY_METERS) return;
      onCoord({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        alt: pos.coords.altitude ?? 0,
        ts: pos.timestamp ?? Date.now(),
        accuracy: pos.coords.accuracy ?? 0,
      });
    },
  );
  return { clear: () => Geolocation.clearWatch({ id }) };
}

// 새 좌표 도착 시 state 갱신. 너무 짧은 이동은 무시 (MIN_MOVE_METERS).
// 반환값: 거리 갱신 발생 여부 (UI 리렌더 trigger 용).
export function appendCoord(state: TrackingState, c: { lat: number; lng: number; alt: number; ts: number }): boolean {
  const last = state.coords[state.coords.length - 1];
  if (!last) {
    state.coords.push([c.lng, c.lat, c.alt, c.ts]);
    return true;
  }
  const dist = haversineMeters({ lat: last[1], lng: last[0] }, c);
  if (dist < MIN_MOVE_METERS) return false;
  state.coords.push([c.lng, c.lat, c.alt, c.ts]);
  state.distanceMeters += dist;
  return true;
}

export function tickElapsed(state: TrackingState, now: number): void {
  if (state.status !== 'active') { state.lastTickAt = now; return; }
  const delta = (now - state.lastTickAt) / 1000;
  if (delta > 0) state.elapsedSeconds += delta;
  state.lastTickAt = now;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
}

export function formatDistanceKm(meters: number): string {
  return (meters / 1000).toFixed(2);
}

export function averagePaceSecondsPerKm(elapsedSeconds: number, distanceMeters: number): number | null {
  if (distanceMeters < 50) return null;
  return Math.round(elapsedSeconds / (distanceMeters / 1000));
}

export function formatPace(secondsPerKm: number | null): string {
  if (secondsPerKm == null) return "—'--\"";
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.floor(secondsPerKm % 60);
  return `${m}'${s.toString().padStart(2, '0')}"`;
}
