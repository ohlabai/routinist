// build 254: HealthKit distanceWalkingRunning sample 합으로 GPS 누적 거리를 보정.
// 자체 native plugin (LiveDistancePlugin.swift) 호출 wrapper.
//
// 흐름:
//   1. 운동 종료 → DB 에 GPS 기반 distance/duration 저장
//   2. 15초 대기 (HealthKit 가 sample 적재할 시간)
//   3. queryDistanceSamples(startMs, endMs) 호출
//   4. hasData=true 이고 Apple 값이 GPS 와 5% 이상 차이 → DB UPDATE + 토스트
//
// 라이브 구독 (HKAnchoredObjectQuery updateHandler) 은 미래 phase. 현재는 종료 후 1회 조회만.

import { registerPlugin } from '@capacitor/core';
import { logClientInfo, logClientWarn } from './error-logger';

export interface DistanceSampleResult {
  totalMeters: number;
  sampleCount: number;
  hasData: boolean;
  startMs?: number;
  endMs?: number;
  reason?: string;
}

interface LiveDistancePlugin {
  querySamples(opts: { startMs: number; endMs: number }): Promise<DistanceSampleResult>;
}

const LiveDistance = registerPlugin<LiveDistancePlugin>('LiveDistance');

function isNativeIos(): boolean {
  if (typeof window === 'undefined') return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cap = (window as any).Capacitor;
  return cap?.isNativePlatform?.() && cap?.getPlatform?.() === 'ios';
}

export function isLiveDistanceAvailable(): boolean {
  return isNativeIos();
}

/**
 * 운동 시작~종료 사이의 HealthKit distanceWalkingRunning sample 합 (미터) 조회.
 * 권한 없음 / sample 없음 → hasData=false. 호출자는 fallback 으로 GPS 값 그대로 사용.
 */
export async function queryDistanceSamples(
  startMs: number, endMs: number,
): Promise<DistanceSampleResult> {
  if (!isLiveDistanceAvailable()) {
    return { totalMeters: 0, sampleCount: 0, hasData: false, reason: 'platform-unsupported' };
  }
  try {
    return await LiveDistance.querySamples({ startMs, endMs });
  } catch (err) {
    void logClientWarn('live-distance', 'query-fail', {
      message: err instanceof Error ? err.message : String(err),
    });
    return { totalMeters: 0, sampleCount: 0, hasData: false, reason: 'query-error' };
  }
}

/**
 * GPS 누적 거리를 HealthKit 보정값과 비교해서 더 신뢰할 만하면 보정값 반환.
 *
 * 보정 기준:
 *   - HealthKit sample 이 1개 이상 (hasData)
 *   - HealthKit 거리가 GPS 거리 대비 5% 이상 차이
 *   - HealthKit 거리가 GPS 의 50% ~ 150% 범위 (이 범위 밖이면 한쪽이 명백히 broken,
 *     자동 보정은 위험하므로 GPS 값 유지)
 *
 * 반환:
 *   - corrected: 보정 후 최종 거리 (m)
 *   - source: 'healthkit' 으로 바뀌었으면 보정됨, 'gps' 면 GPS 유지
 *   - delta: 차이 (m). UI 토스트에 표시 가능
 */
export interface CorrectionResult {
  corrected: number;
  source: 'gps' | 'healthkit';
  delta: number;
  ratio: number;
  sampleCount: number;
}

export async function correctDistanceWithHealthKit(opts: {
  gpsMeters: number;
  startMs: number;
  endMs: number;
  /** 첫 조회 전 대기 시간 (ms). HealthKit sample 적재 시간 확보. 기본 15초. */
  initialDelayMs?: number;
  /** sample 0 일 때 한 번 더 시도하는 간격 (ms). 기본 30초. 0 이면 재시도 안 함. */
  retryDelayMs?: number;
}): Promise<CorrectionResult> {
  const { gpsMeters, startMs, endMs } = opts;
  const initialDelay = opts.initialDelayMs ?? 15000;
  const retryDelay = opts.retryDelayMs ?? 30000;

  const fallback: CorrectionResult = {
    corrected: gpsMeters, source: 'gps', delta: 0, ratio: 1, sampleCount: 0,
  };

  if (!isLiveDistanceAvailable() || gpsMeters <= 0) return fallback;

  await new Promise((r) => setTimeout(r, initialDelay));

  let result = await queryDistanceSamples(startMs, endMs);

  // sample 없으면 한 번 더 시도 — Apple Watch 동기화 지연 케이스 회수.
  if (!result.hasData && retryDelay > 0) {
    await new Promise((r) => setTimeout(r, retryDelay));
    result = await queryDistanceSamples(startMs, endMs);
  }

  if (!result.hasData) {
    void logClientInfo('live-distance', 'no-hk-sample', { gpsMeters, reason: result.reason });
    return fallback;
  }

  const hkMeters = result.totalMeters;
  const ratio = hkMeters / gpsMeters;
  const delta = hkMeters - gpsMeters;

  // 한쪽이 명백히 broken (50% 미만 또는 150% 초과) 이면 자동 보정 보류.
  // 사용자는 health-sync 의 수동 동기화로 회복 가능.
  if (ratio < 0.5 || ratio > 1.5) {
    void logClientWarn('live-distance', 'ratio-out-of-bound', {
      gpsMeters, hkMeters, ratio: Math.round(ratio * 100) / 100, sampleCount: result.sampleCount,
    });
    return { ...fallback, delta, ratio, sampleCount: result.sampleCount };
  }

  // 5% 이내 차이는 GPS 유지 (작은 차이로 굳이 사용자 혼란 안 만듦).
  if (Math.abs(ratio - 1) < 0.05) {
    return { ...fallback, delta, ratio, sampleCount: result.sampleCount };
  }

  void logClientInfo('live-distance', 'corrected', {
    gpsMeters, hkMeters,
    deltaMeters: Math.round(delta),
    ratio: Math.round(ratio * 100) / 100,
    sampleCount: result.sampleCount,
  });

  return {
    corrected: hkMeters, source: 'healthkit', delta, ratio, sampleCount: result.sampleCount,
  };
}
