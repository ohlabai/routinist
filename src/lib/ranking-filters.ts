// Build 208 #3: 홈 랭킹 ↔ /ranking 탭 동기화.
// RankingBreakdown 에서 토글하는 6개 칩 필터를 localStorage 에 저장 → HomeRankingHero 가 동일 RPC 호출.
// 같은 탭에서 변경 시 storage event 가 안 와서 custom event 도 같이 발생.

export type RankingFilterKey = 'country' | 'region_si' | 'region_gu' | 'gender' | 'decade' | 'starter';
export type RankingFilters = Record<RankingFilterKey, boolean>;
// build 209 #4-2: axis (time period) 도 동일 storage 로 공유 — 홈 hero ↔ /ranking 탭 한쪽 변경 시 양쪽 sync.
export type RankingAxis = 'today' | 'week' | 'month' | 'year';

// build 296: 스토리지 키 v1 → v2 — 기본값 변경 (국가 단위 + 월간) 을 기존 사용자에게도
// 1회 리셋 적용 (회원 소수·전원 지인 단계 결정. 이후엔 각자 변경값 유지).
const STORAGE_KEY = 'ranking.filters.v2';
const AXIS_STORAGE_KEY = 'ranking.axis.v2';
const EVENT_NAME = 'ranking-filters-changed';
const AXIS_EVENT_NAME = 'ranking-axis-changed';

// build 296: 회원이 적은 동안은 시/구가 아니라 국가 단위가 기본 ("대한민국 N등").
// 회원이 늘면 region_si 기본 재활성 검토 (hans 결정 2026-07-09).
export const DEFAULT_FILTERS: RankingFilters = {
  country: true,
  region_si: false,
  region_gu: false,
  gender: false,
  decade: false,
  starter: false,
};
// build 296: 기본 axis 'week' → 'month' — 월간 누적이 기본 (hans 결정 2026-07-09).
export const DEFAULT_AXIS: RankingAxis = 'month';

export function readRankingFilters(): RankingFilters {
  if (typeof window === 'undefined') return DEFAULT_FILTERS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw);
    return {
      country: !!parsed.country,
      region_si: !!parsed.region_si,
      region_gu: !!parsed.region_gu,
      gender: !!parsed.gender,
      decade: !!parsed.decade,
      starter: !!parsed.starter,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function writeRankingFilters(filters: RankingFilters) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: filters }));
  } catch {}
}

export function onRankingFiltersChanged(handler: (f: RankingFilters) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onCustom = (e: Event) => handler((e as CustomEvent<RankingFilters>).detail);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) handler(readRankingFilters());
  };
  window.addEventListener(EVENT_NAME, onCustom);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT_NAME, onCustom);
    window.removeEventListener('storage', onStorage);
  };
}

export function readRankingAxis(): RankingAxis {
  if (typeof window === 'undefined') return DEFAULT_AXIS;
  try {
    const raw = localStorage.getItem(AXIS_STORAGE_KEY);
    if (raw === 'today' || raw === 'week' || raw === 'month' || raw === 'year') return raw;
  } catch {}
  return DEFAULT_AXIS;
}

export function writeRankingAxis(axis: RankingAxis) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(AXIS_STORAGE_KEY, axis);
    window.dispatchEvent(new CustomEvent(AXIS_EVENT_NAME, { detail: axis }));
  } catch {}
}

export function onRankingAxisChanged(handler: (a: RankingAxis) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onCustom = (e: Event) => handler((e as CustomEvent<RankingAxis>).detail);
  const onStorage = (e: StorageEvent) => {
    if (e.key === AXIS_STORAGE_KEY) handler(readRankingAxis());
  };
  window.addEventListener(AXIS_EVENT_NAME, onCustom);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(AXIS_EVENT_NAME, onCustom);
    window.removeEventListener('storage', onStorage);
  };
}
