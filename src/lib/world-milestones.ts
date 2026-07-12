// build 229: 월드런 챌린지 마일스톤 통합 — Conqueror 의 마일 마커 unlock 패턴 차용.
// 사용자 progress 가 마일스톤 km 에 도달하면 잠금 해제. 각 마일스톤은 위치 (lat/lng) 보간 +
// Street View 미리보기 + 디지털 엽서 + Fun fact 카드를 노출.

import { haversineMeters } from './gps-tracking';
import type { RealLatLng, Landmark, VirtualCourse } from './world-data';

export type MilestoneKind = 'start' | 'generic' | 'landmark' | 'half' | 'finish';

export interface Milestone {
  id: string;          // unique key for React
  km: number;
  kind: MilestoneKind;
  label: string;       // 표시용 라벨 ("5 km", "Heartbreak Hill 32 km", "하프 마라톤")
  name: string;        // 짧은 이름 ("5km", "Heartbreak Hill", "하프", "완주")
  funFact?: string;    // landmark 의 description 또는 generic 메시지
  unlocked: boolean;
  emoji: string;
  // 보간된 lat/lng (real_path 가 있을 때만). Street View / 지도 핀에 사용.
  lat: number | null;
  lng: number | null;
}

// 코스 distance_km 기반 generic milestones — 5/10/15/20/하프/25/30/35/40/풀.
// 2026-07-12: 장거리 코스 (>60km — 국토대장정 633km 등) 는 40km 이후 완주까지 공백이
// 생기던 문제 → 초반 5~20km 촘촘 + 이후 25km 간격.
function genericMilestoneKms(distanceKm: number): number[] {
  if (distanceKm > 60) {
    const ms: number[] = [5, 10, 15, 20];
    for (let km = 25; km < distanceKm - 0.5; km += 25) ms.push(km);
    ms.push(distanceKm);
    return Array.from(new Set(ms.map(k => Math.round(k * 1000) / 1000)));
  }
  const ms: number[] = [];
  if (distanceKm >= 5) ms.push(5);
  if (distanceKm >= 10) ms.push(10);
  if (distanceKm >= 15) ms.push(15);
  if (distanceKm >= 20) ms.push(20);
  if (distanceKm >= 21.0975 && Math.abs(distanceKm - 21.0975) > 0.05) ms.push(21.0975);
  if (distanceKm >= 25) ms.push(25);
  if (distanceKm >= 30) ms.push(30);
  if (distanceKm >= 35) ms.push(35);
  if (distanceKm >= 40) ms.push(40);
  ms.push(distanceKm);
  // dedup (e.g. 21.0975km 코스는 20 + 하프 + 코스 distance 가 같은 점)
  return Array.from(new Set(ms.map(k => Math.round(k * 1000) / 1000)));
}

// real_path 의 점들 사이 누적 거리 → target km 위치 보간.
// real_path 가 없거나 너무 짧으면 null 반환 (Street View 비활성).
export function getLatLngAtKm(realPath: RealLatLng[] | null, targetKm: number): RealLatLng | null {
  if (!realPath || realPath.length < 2) return null;
  const targetMeters = targetKm * 1000;
  let cumMeters = 0;
  for (let i = 1; i < realPath.length; i++) {
    const prev = realPath[i - 1];
    const cur = realPath[i];
    const segMeters = haversineMeters(prev, cur);
    if (cumMeters + segMeters >= targetMeters) {
      const remain = targetMeters - cumMeters;
      const fraction = segMeters > 0 ? remain / segMeters : 0;
      return {
        lat: prev.lat + (cur.lat - prev.lat) * fraction,
        lng: prev.lng + (cur.lng - prev.lng) * fraction,
      };
    }
    cumMeters += segMeters;
  }
  // target 이 path 총 길이보다 크면 마지막 점 반환.
  return realPath[realPath.length - 1];
}

// generic milestone fun facts — 코스 무관 일반 응원/팩트.
const GENERIC_FUN_FACTS: Record<number, string> = {
  5: '5km는 처음 마라톤 도전하는 사람의 입문 거리. 약 3.1마일이에요.',
  10: '10km를 30분 안에 달리면 엘리트 러너. 일반인 평균은 60~70분.',
  15: '15km부터 글리코겐 고갈이 시작돼요. 수분·전해질 보충이 중요.',
  20: '20km는 마라톤의 절반에 가까운 거리. 일주일 한 번 충분한 도전.',
  21.0975: '하프 마라톤! 풀 마라톤의 정확히 절반. 진정한 장거리 러너 자격.',
  25: '25km부터는 정신력 게임. 발은 아프지만 호흡은 안정돼요.',
  30: '"30km의 벽" - 마라톤에서 가장 힘든 지점. 여기서 무너지는 사람 많음.',
  35: '7km만 남았어요. 페이스 유지하면 PB 가능한 구간.',
  40: '단 2.195km! 가장 긴 2km. 마지막 한 걸음까지 응원해요.',
  42.195: '풀 마라톤! 1908년 런던 올림픽에서 정해진 공식 거리. 진짜 해냈어요!',
};

function genericLabel(km: number, isFinish: boolean): { label: string; name: string; kind: MilestoneKind; emoji: string; funFact?: string } {
  if (isFinish) {
    if (Math.abs(km - 42.195) < 0.1) return { label: '풀 마라톤 완주!', name: '완주', kind: 'finish', emoji: '🏆', funFact: GENERIC_FUN_FACTS[42.195] };
    return { label: `완주! ${km.toFixed(1)} km`, name: '완주', kind: 'finish', emoji: '🏆', funFact: `${km.toFixed(1)}km 완주는 누구나 할 수 있는 일이 아니에요. 정말 자랑스러워요!` };
  }
  if (Math.abs(km - 21.0975) < 0.05) {
    return { label: '하프 마라톤', name: '하프', kind: 'half', emoji: '🥈', funFact: GENERIC_FUN_FACTS[21.0975] };
  }
  const rounded = Math.round(km);
  return {
    label: `${rounded} km`,
    name: `${rounded}km`,
    kind: 'generic',
    emoji: rounded >= 30 ? '🔥' : rounded >= 20 ? '💪' : rounded >= 10 ? '⭐' : '🟢',
    funFact: GENERIC_FUN_FACTS[rounded],
  };
}

/** 진행 카드 예고용 — 아직 도달 못 한 가장 가까운 generic 마일스톤. 완주면 null. */
export function nextGenericMilestone(distanceKm: number, progressKm: number): { km: number; name: string; emoji: string } | null {
  if (!distanceKm || distanceKm <= 0) return null;
  for (const km of genericMilestoneKms(distanceKm)) {
    if (progressKm < km - 0.05) {
      const meta = genericLabel(km, Math.abs(km - distanceKm) < 0.05);
      return { km, name: meta.name, emoji: meta.emoji };
    }
  }
  return null;
}

/** 코스 + 사용자 progress 로 통합 마일스톤 list 생성. unlock 상태 + 보간 lat/lng. */
export function buildMilestones(course: VirtualCourse, myProgressKm: number): Milestone[] {
  const items: Milestone[] = [];

  // 시작점
  if (course.real_path && course.real_path.length > 0) {
    items.push({
      id: 'start',
      km: 0,
      kind: 'start',
      label: '출발',
      name: '출발',
      emoji: '🚩',
      unlocked: myProgressKm > 0,
      lat: course.real_path[0].lat,
      lng: course.real_path[0].lng,
      funFact: '여정의 시작이에요. 첫 걸음을 응원합니다!',
    });
  }

  // generic milestones
  const genericKms = genericMilestoneKms(course.distance_km);
  for (const km of genericKms) {
    const isFinish = Math.abs(km - course.distance_km) < 0.05;
    const meta = genericLabel(km, isFinish);
    const ll = getLatLngAtKm(course.real_path, km);
    items.push({
      id: `g-${km}`,
      km,
      ...meta,
      unlocked: myProgressKm >= km - 0.05,
      lat: ll?.lat ?? null,
      lng: ll?.lng ?? null,
    });
  }

  // course landmarks (별도 카드로 추가). generic 과 km 가까우면 (0.5km 이내) landmark 우선 표시.
  const landmarks: Landmark[] = course.landmarks ?? [];
  for (const lm of landmarks) {
    // 같은 km 의 generic 카드 제거 (landmark 가 더 풍부함)
    const dupIdx = items.findIndex(it => Math.abs(it.km - lm.km) < 0.5 && it.kind === 'generic');
    if (dupIdx >= 0) items.splice(dupIdx, 1);
    const ll = getLatLngAtKm(course.real_path, lm.km);
    items.push({
      id: `lm-${lm.km}-${lm.name}`,
      km: lm.km,
      kind: 'landmark',
      label: `${lm.km.toFixed(1)} km · ${lm.name}`,
      name: lm.name,
      emoji: '📍',
      unlocked: myProgressKm >= lm.km - 0.05,
      lat: ll?.lat ?? null,
      lng: ll?.lng ?? null,
      funFact: lm.description ?? `${lm.name} 도착! 코스의 명소예요.`,
    });
  }

  // km 오름차순 정렬
  items.sort((a, b) => a.km - b.km);
  return items;
}
