// build 290 (할일 #22): 마일/임페리얼 단위 지원.
// 룰: 저장·계산은 항상 km (DB/서버/RPC 불변) — "표시만" 변환.
// 랭킹/목표/월드런/마일리지 적립 등 서버 km 기준 표면에는 사용 금지.

'use client';

import { useSyncExternalStore } from 'react';

export type DistanceUnit = 'km' | 'mi';

const STORAGE_KEY = 'routinist_unit';
export const KM_TO_MI = 0.621371;

/** 저장값 우선, 없으면 navigator.language 가 미국 계열(-US)이면 'mi', 그 외 'km'. */
export function getDistanceUnit(): DistanceUnit {
  if (typeof window === 'undefined') return 'km';
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'km' || saved === 'mi') return saved;
  } catch {}
  try {
    const lang = navigator.language || '';
    if (/-US$/i.test(lang) || /^en-US/i.test(lang)) return 'mi';
  } catch {}
  return 'km';
}

export function setDistanceUnit(unit: DistanceUnit): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, unit); } catch {}
  window.dispatchEvent(new CustomEvent('unit:changed', { detail: unit }));
}

/** km → 표시 단위 수치 변환 (mi = km × 0.621371). 저장값 변환에 쓰지 말 것. */
export function toDisplayDistance(km: number, unit: DistanceUnit): number {
  return unit === 'mi' ? km * KM_TO_MI : km;
}

export function unitLabel(unit: DistanceUnit): string {
  return unit === 'mi' ? 'mi' : 'km';
}

export function paceUnitLabel(unit: DistanceUnit): string {
  return unit === 'mi' ? '/mi' : '/km';
}

/** "5.2 km" / "3.2 mi" — decimals 기본 1자리 (거리 소수 1~2자리 룰). */
export function formatDistance(km: number, unit: DistanceUnit, decimals: number = 1): string {
  return `${toDisplayDistance(km, unit).toFixed(decimals)} ${unitLabel(unit)}`;
}

/** sec/km → 단위별 페이스 문자열 (5'30" 폼). mi 페이스 = secPerKm / 0.621371. 초 단위 반올림. */
export function formatPaceForUnit(secPerKm: number, unit: DistanceUnit): string {
  const secPerUnit = unit === 'mi' ? secPerKm / KM_TO_MI : secPerKm;
  const total = Math.round(secPerUnit);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}'${String(sec).padStart(2, '0')}"`;
}

function subscribeUnit(cb: () => void): () => void {
  window.addEventListener('unit:changed', cb);
  // 다른 탭/웹뷰에서 localStorage 변경 시에도 반영
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener('unit:changed', cb);
    window.removeEventListener('storage', cb);
  };
}

/** 현재 단위 + 'unit:changed' 이벤트 구독 React hook. SSR 스냅샷은 'km' (hydration 후 보정). */
export function useDistanceUnit(): DistanceUnit {
  return useSyncExternalStore(subscribeUnit, getDistanceUnit, () => 'km' as DistanceUnit);
}
