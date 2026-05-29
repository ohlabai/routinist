// Build 208 #3: 홈 랭킹 ↔ /ranking 탭 동기화.
// RankingBreakdown 에서 토글하는 6개 칩 필터를 localStorage 에 저장 → HomeRankingHero 가 동일 RPC 호출.
// 같은 탭에서 변경 시 storage event 가 안 와서 custom event 도 같이 발생.

export type RankingFilterKey = 'country' | 'region_si' | 'region_gu' | 'gender' | 'decade' | 'starter';
export type RankingFilters = Record<RankingFilterKey, boolean>;

const STORAGE_KEY = 'ranking.filters.v1';
const EVENT_NAME = 'ranking-filters-changed';

export const DEFAULT_FILTERS: RankingFilters = {
  country: true,
  region_si: true,
  region_gu: false,
  gender: false,
  decade: false,
  starter: false,
};

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
