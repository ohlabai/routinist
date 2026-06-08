// build 262: iOS 앱 아이콘 빨간 숫자 배지 wrapper.
// 자체 native plugin BadgeManagerPlugin.swift 호출.

import { registerPlugin } from '@capacitor/core';
import { logClientWarn } from './error-logger';

interface BadgeManagerPlugin {
  setBadge(opts: { count: number }): Promise<{ count: number }>;
  clearBadge(): Promise<{ count: number }>;
  getBadge(): Promise<{ count: number }>;
}

const BadgeManager = registerPlugin<BadgeManagerPlugin>('BadgeManager');

function isNativeIos(): boolean {
  if (typeof window === 'undefined') return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cap = (window as any).Capacitor;
  return cap?.isNativePlatform?.() && cap?.getPlatform?.() === 'ios';
}

export async function setAppBadge(count: number): Promise<void> {
  if (!isNativeIos()) return;
  try {
    await BadgeManager.setBadge({ count: Math.max(0, count) });
  } catch (e) {
    void logClientWarn('app-badge', 'setBadge fail', {
      count, message: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function clearAppBadge(): Promise<void> {
  if (!isNativeIos()) return;
  try {
    await BadgeManager.clearBadge();
  } catch (e) {
    void logClientWarn('app-badge', 'clearBadge fail', {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
