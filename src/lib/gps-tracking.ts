// 미니멀 GPS 트래킹 라이브러리 (build 194).
// - Capacitor Geolocation watchPosition → 좌표 스트림
// - Haversine 거리 계산
// - 일시정지/재개 지원
// - localStorage 에 진행 상태 저장 (앱 죽음·OS 강제종료 복원)
//
// 의도적 미포함: 실시간 페이스 (안 3), 음성 안내, Live Activity, 자동 일시정지.
// 표시 데이터는 시간 + 누적 거리 + 지도뿐.

import { Geolocation, type Position } from '@capacitor/geolocation';
import { BackgroundLocation, isBackgroundLocationAvailable, type BgCoord } from './background-location';
import type { PluginListenerHandle } from '@capacitor/core';
import { logClientInfo, logClientWarn } from './error-logger';

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
// build 214 #2: 도심 iPhone GPS 가 빈번하게 30~80m accuracy → 좌표 다수 drop → 실제보다 짧게 측정.
// 30 → 50 m 완화 (build 214) → 100m 완화 (build 225, Apple Watch 보정 알고리즘 참고).
// 100m accuracy 좌표도 polyline 의 곡선 보강에 유의미하고, 아래 MAX_JUMP_METERS outlier filter 가 jitter 흡수.
const MIN_ACCURACY_METERS = 100;
const MIN_MOVE_METERS = 3;        // 직전 좌표와 3m 이상 이동했을 때만 거리·polyline 갱신
// build 225: GPS jitter / 백그라운드 복귀 후 큰 jump (이전 좌표와 200m+) 는 outlier 로 차단.
// 인간 달리기 최대 속도 ~25 km/h ≈ 7 m/s. watchPosition 은 보통 1~3s 간격 → 정상 최대 21m.
// 200m+ 는 GPS multipath 오류 또는 백그라운드 후 첫 fix 가 stale → distance overreport 차단.
// 단, 좌표는 push 하되 distance 누적 skip (다음 정상 sample 부터 다시 계산).
const MAX_JUMP_METERS = 200;

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

// build 205 #3: 권한이 이미 granted 인지 사전 조회 (다이얼로그 안 띄움).
// Strava/Nike Run Club 패턴 — 첫 마운트에서 권한 있으면 조용히 현재 위치로 이동.
export async function checkLocationPermission(): Promise<'granted' | 'denied' | 'prompt'> {
  try {
    const r = await Geolocation.checkPermissions();
    const ok = r.location === 'granted' || r.coarseLocation === 'granted';
    if (ok) return 'granted';
    if (r.location === 'denied' || r.coarseLocation === 'denied') return 'denied';
    return 'prompt';
  } catch { return 'prompt'; }
}

// build 207 #7: getCurrentLocation 회복 시도. build 205 fix 에도 서울 시청 그대로 표시되는 사용자
// 보고. 가능한 원인:
//   (a) checkPermissions 가 'prompt' 반환 → getCurrentLocation 호출 안 됨
//   (b) maximumAge 30s 캐시가 없는 첫 호출에서 enableHighAccuracy 타임아웃 (도심 빌딩가)
//   (c) Google Maps 로드보다 GPS fix 가 늦어 panTo 가 호출되어도 view 가 아직 업데이트 안 됨
// fix: 2단계 시도 — 저정밀 fast (4s) → 고정밀 fallback (10s). maximumAge=0 강제 fresh.
export async function getCurrentLocation(): Promise<{ lat: number; lng: number } | null> {
  // 1단계: 저정밀 / 빠른 응답 — Wi-Fi/셀 기반 ~100m 정확도면 충분히 사용자 위치 표시 가능
  try {
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: false,
      timeout: 4000,
      maximumAge: 0,
    });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    // 폴백
  }
  // 2단계: 고정밀 (GPS 안테나 활성). 도심/실내에선 더 오래 걸릴 수 있음.
  try {
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return null;
  }
}

export interface WatcherHandle { clear: () => Promise<void>; }

// build 246: 백그라운드 트래킹 회복. 화면 꺼짐 / 다른 앱 전환 시 WebView JS suspend → @capacitor/geolocation
// watchPosition 콜백 중단 → 좌표가 54초~수분 간격으로 sparse 하게만 들어옴 (hans 6/3 사례: 46분 동안 51점).
// 자체 native 플러그인 BackgroundLocation 은 CLLocationManager 에 allowsBackgroundLocationUpdates=true
// 를 설정해 native 단에서 좌표를 계속 누적하고, JS resume 시 flush() 로 일괄 회수.
//
// 폴백: iOS 가 아닌 환경 (Android — 아직 native 구현 안 함, 웹 dev) 에서는 기존 @capacitor/geolocation 사용.
export async function startWatcher(
  onCoord: (pos: { lat: number; lng: number; alt: number; ts: number; accuracy: number }) => void,
): Promise<WatcherHandle> {
  if (isBackgroundLocationAvailable()) {
    return startNativeBackgroundWatcher(onCoord);
  }
  return startFallbackWatcher(onCoord);
}

async function startNativeBackgroundWatcher(
  onCoord: (pos: { lat: number; lng: number; alt: number; ts: number; accuracy: number }) => void,
): Promise<WatcherHandle> {
  // build 249 진단: native start 응답 (authorization / onMainThread) 을 client_error_logs 에 남김.
  // hans 2026-06-05 사례 (좌표 0건) 의 root cause 가 thread bug 였는지 권한 부족이었는지 가린다.
  let startResp: unknown = null;
  try {
    startResp = await BackgroundLocation.start({ distanceFilter: MIN_MOVE_METERS, accuracy: 'high' });
    void logClientInfo('gps-tracking', 'bg-native-start ok', { resp: startResp as Record<string, unknown> });
  } catch (err) {
    void logClientWarn('gps-tracking', 'bg-native-start fail → fallback', {
      message: err instanceof Error ? err.message : String(err),
    });
    return startFallbackWatcher(onCoord);
  }

  let coordCount = 0;
  let fallbackAttached = false;
  let fallbackHandle: WatcherHandle | null = null;

  const handleEntry = (entry: BgCoord) => {
    if ((entry.accuracy ?? 999) > MIN_ACCURACY_METERS) return;
    coordCount += 1;
    onCoord({
      lat: entry.lat,
      lng: entry.lng,
      alt: entry.alt ?? 0,
      ts: entry.ts ?? Date.now(),
      accuracy: entry.accuracy ?? 0,
    });
  };

  // foreground 일 때 native 가 event 로 즉시 push.
  const listener: PluginListenerHandle = await BackgroundLocation.addListener('location', handleEntry);
  const errListener: PluginListenerHandle = await BackgroundLocation.addListener('error', (data) => {
    void logClientWarn('gps-tracking', 'bg-native-error', { message: data.message });
  });
  const authListener: PluginListenerHandle = await BackgroundLocation.addListener('authorizationChange', (data) => {
    void logClientInfo('gps-tracking', 'bg-auth-change', { status: data.status });
  });

  // JS 가 백그라운드에서 깨어났을 때 (또는 페이지가 visibility 복귀 시) native 가 버퍼링한 좌표 회수.
  // setInterval 은 foreground 에선 5초마다, 백그라운드에선 OS 가 throttle. 'visibilitychange' 이벤트로
  // 즉시 catch-up 도 보장.
  const flushBuffer = async () => {
    try {
      const { coords } = await BackgroundLocation.flush();
      for (const c of coords) handleEntry(c);
    } catch {
      // native plugin 미빌드 / 권한 거부 등 — listener 만으로도 foreground 동작은 됨.
    }
  };
  const flushTimer = window.setInterval(flushBuffer, 5000);
  const onVis = () => { if (!document.hidden) void flushBuffer(); };
  document.addEventListener('visibilitychange', onVis);

  // build 249 안전망: foreground 30초 동안 좌표 0건이면 native plugin 결함을 가정하고
  // capacitor geolocation 폴백을 *추가로* 부착한다. 두 watcher 가 동시에 좌표를 던지지만
  // 같은 onCoord 콜백을 거치므로 중복 좌표는 distance 누적 시 MIN_MOVE_METERS 필터에 의해
  // 자동 흡수됨 (3m 미만 이동은 누적 안 함). 한 운동이 통째로 0km 로 박히는 사고 방지가 목적.
  const fallbackTimer = window.setTimeout(() => {
    if (coordCount > 0 || fallbackAttached) return;
    fallbackAttached = true;
    void logClientWarn('gps-tracking', 'bg-native zero-coords 30s → attach fallback', {
      startResp: startResp as Record<string, unknown>,
    });
    void (async () => {
      try {
        fallbackHandle = await startFallbackWatcher(onCoord);
      } catch (err) {
        void logClientWarn('gps-tracking', 'fallback attach fail', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }, 30000);

  return {
    clear: async () => {
      clearTimeout(fallbackTimer);
      clearInterval(flushTimer);
      document.removeEventListener('visibilitychange', onVis);
      try { await listener.remove(); } catch {}
      try { await errListener.remove(); } catch {}
      try { await authListener.remove(); } catch {}
      try { await fallbackHandle?.clear(); } catch {}
      try {
        // stop 도 마지막 좌표를 같이 돌려주지만, 이미 처리됐을 가능성이 커서 무시.
        await BackgroundLocation.stop();
      } catch {}
    },
  };
}

async function startFallbackWatcher(
  onCoord: (pos: { lat: number; lng: number; alt: number; ts: number; accuracy: number }) => void,
): Promise<WatcherHandle> {
  const id = await Geolocation.watchPosition(
    { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 },
    (pos: Position | null, err) => {
      if (err || !pos) return;
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
// build 225: 너무 큰 jump (MAX_JUMP_METERS+) 도 차단 — GPS multipath / 백그라운드 stale fix 회피.
// outlier 의 경우 좌표는 push 하지만 distance 누적 skip → 폴리라인 visualisation 은 그대로 두되
// 통계만 보호. 다음 정상 sample 부터 distance 다시 계산.
// 반환값: 거리 갱신 발생 여부 (UI 리렌더 trigger 용).
export function appendCoord(state: TrackingState, c: { lat: number; lng: number; alt: number; ts: number }): boolean {
  const last = state.coords[state.coords.length - 1];
  if (!last) {
    state.coords.push([c.lng, c.lat, c.alt, c.ts]);
    return true;
  }
  const dist = haversineMeters({ lat: last[1], lng: last[0] }, c);
  if (dist < MIN_MOVE_METERS) return false;
  if (dist > MAX_JUMP_METERS) {
    // outlier: 좌표만 push, distance 누적 skip. polyline 시각화는 유지 (사용자가 이상 점 식별 가능).
    state.coords.push([c.lng, c.lat, c.alt, c.ts]);
    return true;
  }
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
