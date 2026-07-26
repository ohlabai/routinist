// iPhone → Apple Watch 컨텍스트 브리지 (watch v9).
// Capacitor Preferences 로 UserDefaults(CapacitorStorage.watch_ctx) 에 JSON 을 심으면
// 네이티브 WatchBridge (AppDelegate) 가 앱 활성화 때 WCSession 으로 워치에 push 한다.
// 워치 사용처: max_hr → 심박 존 정밀화, 이달 챌린지 → 시작 화면 진행률 칩.

import { Preferences } from '@capacitor/preferences';

export interface WatchContext {
  maxHr?: number | null;
  challengeProgressKm?: number;
  challengeTargetKm?: number;
}

export async function setWatchContext(ctx: WatchContext): Promise<void> {
  try {
    const raw = (await Preferences.get({ key: 'watch_ctx' })).value;
    const existing = raw ? (JSON.parse(raw) as WatchContext) : {};
    const merged: WatchContext = { ...existing, ...ctx };
    // null/undefined 필드 제거
    Object.keys(merged).forEach(k => {
      const kk = k as keyof WatchContext;
      if (merged[kk] == null) delete merged[kk];
    });
    await Preferences.set({ key: 'watch_ctx', value: JSON.stringify(merged) });
  } catch {
    // 웹/미지원 환경 — 조용히 무시
  }
}
