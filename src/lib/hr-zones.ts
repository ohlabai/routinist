// 심박존 Zone1~5 (회원 요청, 2026-08-01)
// 활동의 심박 샘플(HealthKit)로 존별 체류 시간을 계산해 activities.hr_zones 에 캐시.
// 존 경계는 워치 WorkoutManager.currentZone 과 동일: %maxHR < 60/70/80/90 → Z1~Z4, 이상 Z5.
//
// 데이터 소스 노트:
// - iOS: HealthKit heartRate 샘플 (워치·나이키 등 어느 앱 러닝이든 HK 에 있으면 계산 가능).
// - Android: 폰 매니페스트에 READ_HEART_RATE 없음 (Play 최소권한 2회 거절 대응) → 계산 불가.
//   저장된 hr_zones 가 있으면 표시만 한다 (iOS 에서 계산해 둔 것·향후 갤럭시워치 계산분).

import { getSupabase } from '@/lib/supabase';
import { isNativeApp, getPlatform } from '@/lib/health-sync';
import type { Activity } from '@/types';

export interface HrZonesData {
  z: number[]; // 존1~5 체류 초
  max_hr: number;
  src?: string;
  computed_at?: string;
}

export const ZONE_COLORS = ['#3B82F6', '#22C55E', '#EAB308', '#F97316', '#EF4444'];

/** bpm → 존 1~5 (0 = 무효) */
export function zoneOf(bpm: number, maxHr: number): number {
  if (!bpm || bpm <= 0 || maxHr <= 0) return 0;
  const pct = bpm / maxHr;
  if (pct < 0.6) return 1;
  if (pct < 0.7) return 2;
  if (pct < 0.8) return 3;
  if (pct < 0.9) return 4;
  return 5;
}

/**
 * HealthKit 심박 샘플로 존 분포 계산 (iOS 네이티브 전용).
 * 샘플 간격을 해당 존에 적산 — 공백 상한 30s (워치 로직 미러).
 * 계산 불가(플랫폼·데이터 부족)면 null.
 */
export async function computeHrZones(activity: Activity, maxHr: number): Promise<HrZonesData | null> {
  if (!isNativeApp() || getPlatform() !== 'ios') return null;
  if (!activity.started_at || !activity.duration_seconds) return null;
  try {
    const start = new Date(activity.started_at);
    const end = new Date(start.getTime() + activity.duration_seconds * 1000);
    const { Health } = await import('@capgo/capacitor-health');
    const { samples } = await Health.readSamples({
      dataType: 'heartRate',
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      limit: 10000,
      ascending: true,
    });
    if (!samples || samples.length < 5) return null;

    const z = [0, 0, 0, 0, 0];
    for (let i = 0; i < samples.length; i++) {
      const bpm = samples[i].value;
      const zone = zoneOf(bpm, maxHr);
      if (zone === 0) continue;
      const t = new Date(samples[i].startDate).getTime();
      const next = i + 1 < samples.length ? new Date(samples[i + 1].startDate).getTime() : t + 5000;
      const dt = Math.min(Math.max((next - t) / 1000, 0), 30);
      z[zone - 1] += dt;
    }
    if (z.reduce((s, v) => s + v, 0) < 60) return null; // 1분 미만 측정 — 표시 가치 없음

    return {
      z: z.map(v => Math.round(v)),
      max_hr: maxHr,
      src: 'hk',
      computed_at: new Date().toISOString(),
    };
  } catch {
    return null; // 권한 미승인·플러그인 실패 — 카드 생략이 정답
  }
}

/**
 * 활동의 존 분포 확보: 저장분 우선 → 없고 본인+iOS 면 계산 후 DB 캐시.
 * 실패는 조용히 null (카드 미표시).
 */
export async function ensureHrZones(
  activity: Activity,
  viewerId: string | null,
  maxHr: number
): Promise<HrZonesData | null> {
  if (activity.hr_zones?.z?.length === 5) return activity.hr_zones as HrZonesData;
  if (!viewerId || viewerId !== activity.user_id) return null; // 계산·저장은 본인만
  const zones = await computeHrZones(activity, maxHr);
  if (!zones) return null;
  try {
    await getSupabase()
      .from('activities')
      .update({ hr_zones: zones })
      .eq('id', activity.id)
      .eq('user_id', viewerId);
  } catch { /* 캐시 실패해도 이번 화면 표시는 진행 */ }
  return zones;
}
