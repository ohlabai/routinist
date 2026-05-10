// A/B 테스트 클라이언트 — assign + track.
// 사용 예:
//   const variant = useExperiment('shop_cta_text');
//   variant === 'A' ? '결제하기' : '주문 완료'
//
// 1세션당 한 번 assign — 같은 변종 유지를 위해 sessionStorage 캐시.

import { useEffect, useState } from 'react';
import { getSupabase } from './supabase';

const SESSION_KEY = 'experiment_cache_v1';

interface ExperimentCache { [name: string]: string }

function loadCache(): ExperimentCache {
  if (typeof window === 'undefined') return {};
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) as ExperimentCache : {};
  } catch { return {}; }
}

function saveCache(c: ExperimentCache): void {
  if (typeof window === 'undefined') return;
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(c)); } catch {}
}

export async function assignExperiment(name: string): Promise<string> {
  const cache = loadCache();
  if (cache[name]) return cache[name];
  try {
    const supabase = getSupabase();
    const { data } = await supabase.rpc('assign_experiment', { p_name: name });
    const variant = (typeof data === 'string' ? data : 'control') || 'control';
    cache[name] = variant;
    saveCache(cache);
    return variant;
  } catch {
    return 'control';
  }
}

export async function trackExperimentEvent(
  name: string,
  eventName: string,
  value?: number,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const supabase = getSupabase();
    await supabase.rpc('track_experiment_event', {
      p_name: name,
      p_event_name: eventName,
      p_value: value ?? null,
      p_metadata: metadata ?? null,
    });
  } catch {
    // 실패는 silent — 분석 손실은 사용자 경험보다 낮은 우선순위
  }
}

/** React hook — 컴포넌트 마운트 시 assign. 'control' → 결정될 때 변경. */
export function useExperiment(name: string): string {
  const [variant, setVariant] = useState<string>(() => loadCache()[name] ?? 'control');
  useEffect(() => {
    let cancelled = false;
    void assignExperiment(name).then(v => { if (!cancelled) setVariant(v); });
    return () => { cancelled = true; };
  }, [name]);
  return variant;
}
