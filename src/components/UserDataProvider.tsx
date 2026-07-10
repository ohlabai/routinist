'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from './AuthProvider';
import { fetchActivities, fetchMonthlyGoals } from '@/lib/routinist-data';
import { logClientInfo, logClientWarn, logClientError } from '@/lib/error-logger';
import { dataCache, CACHE_KEYS } from '@/lib/data-cache';
import type { Activity, UserMonthlyGoal } from '@/types';

interface UserDataState {
  activities: Activity[];
  goals: UserMonthlyGoal[];
  loading: boolean;
  /** 마지막 fetch (네트워크) 시각. 캐시 fall-through 면 캐시 저장 시각. */
  lastUpdated: number | null;
  /** 사용자가 명시적으로 새로고침을 요청할 때만 호출 (PullToRefresh / 새로고침 버튼). */
  refresh: () => Promise<void>;
}

const UserDataContext = createContext<UserDataState>({
  activities: [],
  goals: [],
  loading: true,
  lastUpdated: null,
  refresh: async () => {},
});

export function useUserData() {
  return useContext(UserDataContext);
}

export function UserDataProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [goals, setGoals] = useState<UserMonthlyGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  // 신문 모델 (build 57): 캐시 우선, 없거나 새로고침 명시 요청 시에만 네트워크.
  // realtime postgres_changes 는 제거 — 매 변경마다 reload 가 SDK lock 을 만들고 사용자가 안 보고 있는데도 query 가 도는 비효율.
  // 대신 사용자가 PullToRefresh 또는 새로고침 버튼으로 명시적으로 갱신.
  const loadData = useCallback(async (opts?: { force?: boolean }) => {
    if (!user) {
      setActivities([]);
      setGoals([]);
      setLoading(false);
      setLastUpdated(null);
      return;
    }

    const actKey = CACHE_KEYS.userActivities(user.id);
    const goalKey = CACHE_KEYS.userGoals(user.id);

    // 1. 캐시 우선 — 즉시 화면 표시. 사용자는 stale 데이터라도 빈 화면보다 나음.
    if (!opts?.force) {
      const actCached = dataCache.get<Activity[]>(actKey);
      const goalCached = dataCache.get<UserMonthlyGoal[]>(goalKey);
      if (actCached && goalCached) {
        setActivities(actCached.value);
        setGoals(goalCached.value);
        setLastUpdated(Math.min(actCached.ts, goalCached.ts));
        setLoading(false);
        // build 297: 캐시 히트여도 6시간 이상 묵었으면 백그라운드 재검증 (SWR).
        // 웹 (app.routinist.kr) 은 PullToRefresh 가 없어 캐시가 화석화됐음 —
        // hans 신고: 48일 전 캐시로 활동/목표 전부 0 표시. iOS 도 장기 미접속 복귀 케이스 커버.
        const ageMs = Date.now() - Math.min(actCached.ts, goalCached.ts);
        if (ageMs <= 6 * 60 * 60 * 1000) {
          return; // 신선 — 신문 모델 그대로 (화면 이동 시 RPC 0건)
        }
        // fall through: loading 표시 없이 조용히 fresh fetch → 도착 시 화면 갱신
      }
    }

    const t0 = Date.now();
    logClientInfo('UserDataProvider', 'loadData fetch start', { userId: user.id, force: !!opts?.force });

    const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
      Promise.race<T>([
        p,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`${label} ${ms / 1000}s timeout`)), ms)
        ),
      ]);

    const timed = async <T,>(p: Promise<T>): Promise<{ ok: true; value: T; ms: number } | { ok: false; reason: string; ms: number }> => {
      const start = Date.now();
      try {
        const value = await p;
        return { ok: true, value, ms: Date.now() - start };
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : String(e), ms: Date.now() - start };
      }
    };

    try {
      const [actRes, goalRes] = await Promise.all([
        timed(withTimeout(fetchActivities(user.id), 12000, 'fetchActivities')),
        timed(withTimeout(fetchMonthlyGoals(user.id), 8000, 'fetchMonthlyGoals')),
      ]);

      if (actRes.ok) {
        setActivities(actRes.value);
        dataCache.set(actKey, actRes.value);
        logClientInfo('UserDataProvider', 'fetchActivities ok', { count: actRes.value.length, ms: actRes.ms });
      } else {
        logClientError('UserDataProvider', 'fetchActivities fail', { reason: actRes.reason, ms: actRes.ms });
      }

      if (goalRes.ok) {
        setGoals(goalRes.value);
        dataCache.set(goalKey, goalRes.value);
        logClientInfo('UserDataProvider', 'fetchMonthlyGoals ok', { count: goalRes.value.length, ms: goalRes.ms });
      } else {
        logClientError('UserDataProvider', 'fetchMonthlyGoals fail', { reason: goalRes.reason, ms: goalRes.ms });
      }

      // 신문 모델 (build 59): 사용자가 명시 새로고침 (force=true) 했으면
      // fetch 실패해도 "지금 갱신 시도함" 의 의미로 lastUpdated 갱신.
      // 사용자가 "1시간 전" 그대로 보이는 회귀 차단.
      if (actRes.ok || goalRes.ok || opts?.force) setLastUpdated(Date.now());
      logClientInfo('UserDataProvider', 'loadData fetch done', {
        totalMs: Date.now() - t0, actOk: actRes.ok, goalOk: goalRes.ok,
      });
    } catch (e) {
      logClientWarn('UserDataProvider', 'loadData unexpected throw', {
        err: e instanceof Error ? e.message : String(e), totalMs: Date.now() - t0,
      });
      if (opts?.force) setLastUpdated(Date.now());
    } finally {
      setLoading(false);
    }
  }, [user]);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    // 사용자가 명시 새로고침 — 해당 사용자 캐시 무효화 후 fresh fetch.
    dataCache.invalidate(CACHE_KEYS.userActivities(user.id));
    dataCache.invalidate(CACHE_KEYS.userGoals(user.id));
    await loadData({ force: true });
  }, [loadData, user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <UserDataContext.Provider value={{ activities, goals, loading, lastUpdated, refresh }}>
      {children}
    </UserDataContext.Provider>
  );
}
