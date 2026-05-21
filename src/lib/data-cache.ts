// 신문 모델 (build 57): 한 번 받은 데이터는 사용자가 명시적으로 새로고침할 때까지 그대로 사용.
// localStorage 영속화 + 메모리 layer. 앱 재시작 후에도 마지막 데이터 즉시 보임.
//
// 사용 패턴:
//   const cached = dataCache.get<MyType>('hero:user123:month');
//   if (cached) setData(cached.value);
//   const fresh = await fetcher();
//   dataCache.set('hero:user123:month', fresh);
//
// pull-to-refresh:
//   dataCache.invalidate('hero:user123:'); // prefix match
//
// 로그아웃:
//   dataCache.clearAll();

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev';
// build 163: v1 → v2 로 bump. build 161 의 lite-fetch 가 cache 에 route_data 없는 activities 를
// localStorage 영속화 — 신문 모델이라 사용자가 pull-to-refresh 안 하면 영원히 stale.
// prefix 자체를 바꿔 모든 사용자 cache 1회 무효화.
const STORAGE_PREFIX = `routinist_cache_v2_${APP_VERSION}_`;
const TIMESTAMP_PREFIX = `routinist_cache_ts_v2_${APP_VERSION}_`;
const LEGACY_PREFIXES = ['routinist_cache_v1_', 'routinist_cache_ts_v1_'];

// 앱 첫 마운트 시 1회 — 옛 v1 cache 키들을 비워서 localStorage 정리.
function purgeLegacyCaches(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k) continue;
      if (LEGACY_PREFIXES.some(p => k.startsWith(p))) toRemove.push(k);
    }
    toRemove.forEach(k => window.localStorage.removeItem(k));
  } catch {}
}
if (typeof window !== 'undefined') purgeLegacyCaches();

interface CacheEntry<T> {
  value: T;
  /** 저장 시각 (ms epoch). UI 의 "N분 전" 표시에 사용. */
  ts: number;
}

// 메모리 layer — localStorage parse 비용 줄이기 위한 hot cache. 같은 key 를 여러 번 읽어도 1회만 파싱.
const memCache = new Map<string, CacheEntry<unknown>>();

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

// invalidate / clearAll 시 발사하는 글로벌 이벤트.
// hero / 캐싱 컴포넌트가 listen 해서 자동 fresh fetch — PullToRefresh 가 hero 화면도 갱신하게.
const INVALIDATED_EVENT = 'routinist:cache-invalidated';
function emitInvalidated(prefix: string): void {
  if (!isBrowser()) return;
  try {
    window.dispatchEvent(new CustomEvent(INVALIDATED_EVENT, { detail: { prefix } }));
  } catch {}
}

/**
 * cache invalidate 시 알림 받는 listener 등록. 컴포넌트 useEffect 안에서 호출.
 * cb 인자로 invalidated prefix 가 들어옴 — 자기 cache key 에 영향 있는지 호출자가 판단.
 */
export function onCacheInvalidated(cb: (prefix: string) => void): () => void {
  if (!isBrowser()) return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<{ prefix: string }>).detail;
    cb(detail?.prefix ?? '');
  };
  window.addEventListener(INVALIDATED_EVENT, handler);
  return () => window.removeEventListener(INVALIDATED_EVENT, handler);
}

export const dataCache = {
  /**
   * 캐시 조회. 만료시간 옵션 — 지정하지 않으면 무한 (사용자가 명시 새로고침할 때까지 유효).
   */
  get<T>(key: string, opts?: { maxAgeMs?: number }): CacheEntry<T> | null {
    if (memCache.has(key)) {
      const entry = memCache.get(key) as CacheEntry<T>;
      if (opts?.maxAgeMs && Date.now() - entry.ts > opts.maxAgeMs) {
        return null;
      }
      return entry;
    }
    if (!isBrowser()) return null;
    try {
      const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
      if (!raw) return null;
      const tsRaw = window.localStorage.getItem(TIMESTAMP_PREFIX + key);
      const ts = tsRaw ? parseInt(tsRaw, 10) : Date.now();
      const value = JSON.parse(raw) as T;
      const entry: CacheEntry<T> = { value, ts };
      memCache.set(key, entry as CacheEntry<unknown>);
      if (opts?.maxAgeMs && Date.now() - entry.ts > opts.maxAgeMs) {
        return null;
      }
      return entry;
    } catch {
      return null;
    }
  },

  /**
   * 캐시 저장. 즉시 메모리 + localStorage 양쪽에 반영.
   * 큰 객체는 JSON.stringify 가 느릴 수 있으니 호출 빈도 적당히 유지.
   */
  set<T>(key: string, value: T): void {
    const entry: CacheEntry<T> = { value, ts: Date.now() };
    memCache.set(key, entry as CacheEntry<unknown>);
    if (!isBrowser()) return;
    try {
      window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
      window.localStorage.setItem(TIMESTAMP_PREFIX + key, String(entry.ts));
    } catch {
      // localStorage quota 초과 등 — 메모리 cache 는 그대로 유지.
    }
  },

  /**
   * 정확히 일치하는 key 또는 prefix 로 시작하는 모든 key 삭제.
   * pull-to-refresh 시 화면 단위로 호출 (예: invalidate('hero:user123:')).
   */
  invalidate(keyOrPrefix: string): void {
    // 메모리
    for (const k of Array.from(memCache.keys())) {
      if (k === keyOrPrefix || k.startsWith(keyOrPrefix)) {
        memCache.delete(k);
      }
    }
    if (!isBrowser()) return;
    try {
      const fullPrefix = STORAGE_PREFIX + keyOrPrefix;
      const tsFullPrefix = TIMESTAMP_PREFIX + keyOrPrefix;
      const toRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (!k) continue;
        if (k.startsWith(fullPrefix) || k.startsWith(tsFullPrefix)) {
          toRemove.push(k);
        }
      }
      toRemove.forEach(k => window.localStorage.removeItem(k));
    } catch {}
    emitInvalidated(keyOrPrefix);
  },

  /**
   * 모든 캐시 삭제. 로그아웃 / 계정 변경 시 사용.
   * 옛 앱 버전 prefix 도 같이 정리해서 디스크 영구 점유 방지.
   */
  clearAll(): void {
    memCache.clear();
    if (!isBrowser()) return;
    try {
      const toRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (!k) continue;
        if (k.startsWith('routinist_cache_v1_') || k.startsWith('routinist_cache_ts_v1_')) {
          toRemove.push(k);
        }
      }
      toRemove.forEach(k => window.localStorage.removeItem(k));
    } catch {}
    emitInvalidated('');  // 빈 prefix = 전체 무효화
  },

  /**
   * 캐시가 있으면 그대로, 없거나 stale 이면 fetcher 호출 + 저장.
   * stale-while-revalidate 가 필요하면 호출자가 직접 get() 해서 보여주고 별도로 fetcher 호출하는 패턴 권장.
   */
  async getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    opts?: { maxAgeMs?: number },
  ): Promise<{ value: T; fromCache: boolean; ts: number }> {
    const cached = this.get<T>(key, opts);
    if (cached) return { value: cached.value, fromCache: true, ts: cached.ts };
    const value = await fetcher();
    this.set(key, value);
    return { value, fromCache: false, ts: Date.now() };
  },

  /**
   * 마지막 갱신 시각만 빠르게 조회 — FreshnessBadge 가 저장된 데이터를 다시 안 읽고도 ts 표시 가능.
   */
  getTimestamp(key: string): number | null {
    if (memCache.has(key)) return memCache.get(key)!.ts;
    if (!isBrowser()) return null;
    try {
      const tsRaw = window.localStorage.getItem(TIMESTAMP_PREFIX + key);
      return tsRaw ? parseInt(tsRaw, 10) : null;
    } catch {
      return null;
    }
  },
};

// 자주 쓰는 key prefix 모음 — 오타 방지 + 검색성.
export const CACHE_KEYS = {
  userActivities: (userId: string) => `userdata:activities:${userId}`,
  userGoals: (userId: string) => `userdata:goals:${userId}`,
  heroRank: (userId: string, axis: string) => `hero:rank:${userId}:${axis}`,
  rankNeighbors: (userId: string) => `hero:neighbors:${userId}`,
  friendsLeaderboard: (userId: string) => `home:friends:${userId}`,
  todayLocalTop: (userId: string) => `home:localtop:${userId}`,
  onThisDay: (userId: string) => `home:onthisday:${userId}`,
  winnerPrediction: (userId: string) => `home:prediction:${userId}`,
  routinePhotos: (scope: string) => `photos:${scope}`,
  // user 별 prefix — 로그아웃 후 다른 계정 로그인 시 invalidate(`user:${oldId}`) 한 번이면 정리.
  userPrefix: (userId: string) => `user:${userId}`,
} as const;
