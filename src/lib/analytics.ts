// 클라이언트 이벤트 트래커 (build 115 Phase B).
// 사용: import { track } from '@/lib/analytics'; track('event_name', { ... });
// - 자동 batching (5초 debounce 또는 10건 누적 즉시)
// - sessionStorage 기반 session_id
// - beforeunload/pagehide 시 강제 flush

import { getSupabase } from './supabase';

interface QueuedEvent {
  event_name: string;
  properties: Record<string, unknown>;
  path: string | null;
  session_id: string;
  created_at: string;
}

const QUEUE: QueuedEvent[] = [];
const BATCH_SIZE = 10;
const DEBOUNCE_MS = 5000;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function getSessionId(): string {
  if (typeof window === 'undefined') return 'ssr';
  let id = window.sessionStorage.getItem('analytics_session_id');
  if (!id) {
    id = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    window.sessionStorage.setItem('analytics_session_id', id);
  }
  return id;
}

function getPath(): string | null {
  if (typeof window === 'undefined') return null;
  return window.location.pathname || null;
}

async function flushNow(): Promise<void> {
  if (QUEUE.length === 0) return;
  const batch = QUEUE.splice(0, QUEUE.length);
  try {
    const supabase = getSupabase();
    await supabase.rpc('track_events', { p_events: batch });
  } catch (e) {
    // 실패한 이벤트는 다시 queue 에 넣지 않음 — 손실 OK (analytics 가 critical path 아님).
    if (process.env.NODE_ENV === 'development') {
      console.warn('[analytics] flush 실패', e);
    }
  }
}

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushNow();
  }, DEBOUNCE_MS);
}

export function track(eventName: string, properties: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;  // SSR 무시
  QUEUE.push({
    event_name: eventName,
    properties,
    path: getPath(),
    session_id: getSessionId(),
    created_at: new Date().toISOString(),
  });
  if (QUEUE.length >= BATCH_SIZE) {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    void flushNow();
  } else {
    scheduleFlush();
  }
}

// 페이지뷰 (path 만 다르면 자동) — AnalyticsAutoTracker 가 호출.
export function trackPageView(path: string, extra?: Record<string, unknown>): void {
  track('page_view', { ...extra, path });
}

// 명시적 flush — beforeunload / route change 직전에 호출.
export function flushAnalytics(): void {
  void flushNow();
}

// app lifecycle 리스너 등록 (앱 시작 시 1회)
let lifecycleAttached = false;
export function attachAnalyticsLifecycle(): void {
  if (typeof window === 'undefined' || lifecycleAttached) return;
  lifecycleAttached = true;
  // beforeunload 는 모바일에서 비신뢰. pagehide 는 안정적.
  const flushHandler = () => { void flushNow(); };
  window.addEventListener('pagehide', flushHandler);
  window.addEventListener('beforeunload', flushHandler);
  // visibilitychange — 백그라운드 진입 시
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushNow();
  });
}
