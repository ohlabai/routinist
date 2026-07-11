// build 292 Phase 1: 네이티브 RunSession 엔진 wrapper.
// iOS: RunSessionPlugin.swift (동시 개발 중 — scratchpad/run-session-contract.md 계약만 믿고 구현).
//
// 왜 별도 엔진인가 (진단 리뷰 결론):
//   기존 구조는 두뇌 (거리 적산 / 페이스 / 자동 일시정지 / 음성) 가 전부 JS 에 있어서
//   화면 잠금·앱 전환 시 WebView JS suspend 와 함께 죽음. BackgroundLocation 플러그인은
//   좌표 버퍼링만 해줄 뿐 판정 로직은 여전히 JS 라 자동 일시정지·음성이 백그라운드에서 멈춤.
//   RunSession 은 native 가 세션 전체 (필터/적산/자동정지/pedometer 융합/음성) 를 소유하고
//   JS 는 'update' 이벤트를 받아 렌더만 담당.
//
// 폴백: 플러그인 미탑재 빌드 (웹 dev / Android / 구버전) 은 isRunSessionAvailable() = false
// → 호출자가 기존 gps-tracking.ts 레거시 JS 엔진 사용.

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

// ── 계약 타입 (run-session-contract.md 와 1:1) ───────────────────────────────

export type RunSessionState = 'running' | 'autoPaused' | 'paused';
export type RunGpsSignal = 'good' | 'weak' | 'lost';
/** [lng, lat, tsMs] — 계약의 route 좌표 tuple. */
export type RunCoord = [lng: number, lat: number, tsMs: number];

export interface RunSessionVoiceTemplates {
  /** "{km}" "{pace}" 치환자 포함. native 가 마일스톤 도달 시 치환 후 발화. */
  milestone: string;
  autoPause: string;
  autoResume: string;
}

export interface RunSessionStartOptions {
  locale: 'ko' | 'en';
  voiceEnabled: boolean;
  /** 마일스톤 간격 (km). 기본 1. 500m 안내는 0.5. */
  milestoneEveryKm: number;
  voiceTemplates: RunSessionVoiceTemplates;
}

export interface RunSessionUpdateEvent {
  state: RunSessionState;
  distanceM: number;
  activeSec: number;
  instantPaceSecPerKm: number | null;
  avgPaceSecPerKm: number | null;
  /** 직전 이벤트 이후 추가된 필터 통과 좌표만 — 지도 폴리라인 append 용. */
  newCoords: RunCoord[];
  gpsSignal: RunGpsSignal;
  pedometerDistanceM: number;
}

export interface RunSessionMilestoneEvent {
  km: number;
  avgPaceSecPerKm: number | null;
}

export interface RunSessionSummary {
  startedAtMs: number;
  endedAtMs: number;
  /** 최종 채택 거리 (GPS + pedometer gap-fill 융합). */
  distanceM: number;
  gpsDistanceM: number;
  pedometerDistanceM: number;
  /** pause 제외 실동작 시간. */
  activeSec: number;
  elapsedSec: number;
  autoPausedSec: number;
  avgPaceSecPerKm: number | null;
  route: RunCoord[];
}

export interface RunSessionSnapshot extends RunSessionUpdateEvent {
  active: boolean;
  routeSoFar: RunCoord[];
  // 계약에는 명시 안 됐지만 update 필드만으론 벽시계 시작 시각을 알 수 없어 optional 로 선언.
  // Swift 쪽이 안 주면 JS 는 routeSoFar 첫 좌표 ts 또는 (now - activeSec) 으로 근사.
  startedAtMs?: number;
}

export interface RunSessionPermissions {
  location: 'granted' | 'denied' | 'prompt';
  motion: 'granted' | 'denied' | 'undetermined';
}

export interface RunSessionPlugin {
  requestPermissions(): Promise<RunSessionPermissions>;
  /** 이미 활성 세션 있으면 reject('session-already-active'). */
  start(options: RunSessionStartOptions): Promise<{ ok: true; startedAtMs: number }>;
  pause(): Promise<{ ok: boolean }>;
  /** autoPaused 상태도 해제. */
  resume(): Promise<{ ok: boolean }>;
  /** 세션 없으면 reject('no-active-session'). */
  stop(): Promise<RunSessionSummary>;
  /** JS 리로드/재진입 시 재부착용. active=false 면 나머지 필드는 무의미. */
  getSnapshot(): Promise<RunSessionSnapshot>;
  /** build 299: 카운트다운 beep 용 오디오 세션 선점 (무음 스위치 무시). 구버전 빌드엔 없음. */
  prepareAudio?(): Promise<{ ok: boolean }>;
  addListener(eventName: 'update', listenerFunc: (data: RunSessionUpdateEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'milestone', listenerFunc: (data: RunSessionMilestoneEvent) => void): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

export const RunSession = registerPlugin<RunSessionPlugin>('RunSession');

// ── 가용성 감지 ──────────────────────────────────────────────────────────────

/**
 * 네이티브 플랫폼 + RunSession 플러그인 실탑재 여부.
 * Swift 구현이 아직 없는 빌드 (구버전 / 시뮬레이터 web) 에선 false → 레거시 JS 엔진 폴백.
 */
export function isRunSessionAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cap = (window as any).Capacitor;
  if (!cap?.isNativePlatform?.()) return false;
  if (cap.getPlatform?.() !== 'ios') return false;   // Android native 는 Phase 2 이후
  return cap.isPluginAvailable?.('RunSession') === true;
}

// ── 음성 템플릿 (voice-cue.ts 의 buildMilestoneMessage 톤 계승 — 친근·짧은 한 호흡) ──

export function buildVoiceTemplates(locale: 'ko' | 'en'): RunSessionVoiceTemplates {
  // Phase 1 은 km 고정 (마일 단위 사용자는 Phase 2 에서 처리).
  if (locale === 'en') {
    return {
      milestone: '{km} kilometers. Average pace {pace}. Looking strong.',
      autoPause: 'Auto paused. I will pick it up when you move.',
      autoResume: "Resuming. Let's go.",
    };
  }
  return {
    milestone: '{km}킬로미터 통과. 평균 페이스 {pace}. 잘하고 있어요.',
    autoPause: '자동 일시정지. 다시 움직이면 이어서 잴게요.',
    autoResume: '다시 시작합니다. 같이 가요.',
  };
}

// ── 얇은 래퍼 ────────────────────────────────────────────────────────────────

export async function requestRunPermissions(): Promise<RunSessionPermissions> {
  return RunSession.requestPermissions();
}

export async function startRunSession(opts: {
  locale: 'ko' | 'en';
  voiceEnabled: boolean;
  milestoneEveryKm?: number;
}): Promise<{ ok: true; startedAtMs: number }> {
  return RunSession.start({
    locale: opts.locale,
    voiceEnabled: opts.voiceEnabled,
    milestoneEveryKm: opts.milestoneEveryKm ?? 1,
    voiceTemplates: buildVoiceTemplates(opts.locale),
  });
}

export async function pauseRunSession(): Promise<{ ok: boolean }> {
  return RunSession.pause();
}

export async function resumeRunSession(): Promise<{ ok: boolean }> {
  return RunSession.resume();
}

export async function stopRunSession(): Promise<RunSessionSummary> {
  return RunSession.stop();
}

// build 299: 시작 직전 호출 — WebAudio beep 이 무음 스위치에 먹히지 않게 .playback 선점.
// 플러그인 미탑재 (구버전 빌드) 면 조용히 무시.
export async function prepareRunAudio(): Promise<void> {
  if (!isRunSessionAvailable()) return;
  try { await RunSession.prepareAudio?.(); } catch { /* beep 은 ambient 로 재생 */ }
}

export async function getRunSnapshot(): Promise<RunSessionSnapshot> {
  return RunSession.getSnapshot();
}

// ── 리스너 관리 ──────────────────────────────────────────────────────────────

export interface RunSessionListenerHandlers {
  onUpdate?: (e: RunSessionUpdateEvent) => void;
  onMilestone?: (e: RunSessionMilestoneEvent) => void;
}

/**
 * update / milestone 리스너 일괄 부착. 반환된 cleanup 을 호출하면 전부 해제.
 * addListener 는 async 라, 호출자가 unmount race 를 피하려면 then 안에서
 * mounted 여부를 확인하고 즉시 cleanup 을 부를 수 있게 함수 형태로 반환.
 */
export async function attachRunSessionListeners(handlers: RunSessionListenerHandlers): Promise<() => void> {
  const hs: PluginListenerHandle[] = [];
  if (handlers.onUpdate) {
    hs.push(await RunSession.addListener('update', handlers.onUpdate));
  }
  if (handlers.onMilestone) {
    hs.push(await RunSession.addListener('milestone', handlers.onMilestone));
  }
  return () => {
    for (const h of hs) {
      void h.remove().catch(() => {});
    }
  };
}
