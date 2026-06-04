// 자체 native Capacitor 플러그인 wrapper.
// iOS: BackgroundLocationPlugin.swift (CLLocationManager + allowsBackgroundLocationUpdates)
// Android: TODO (Health Connect + foreground service — Android 트랙에서 작업)
//
// 왜 별도 플러그인인가:
//   @capacitor/geolocation 의 watchPosition 은 JS callback 의존이라 백그라운드 (화면 잠금 /
//   다른 앱 전환) 시 WebView JS runtime suspend → 좌표가 sparse 하게 들어옴 (54초~수분 간격).
//   본 플러그인은 native 단에서 CLLocationManager 가 계속 좌표를 수신·누적하고
//   JS 는 foreground 로 돌아왔을 때 flush() 로 일괄 회수합니다.

import { registerPlugin, PluginListenerHandle } from '@capacitor/core';

export interface BgCoord {
  lat: number;
  lng: number;
  alt: number;
  ts: number;       // unix ms
  accuracy: number;
  speed: number;
}

export interface BackgroundLocationPlugin {
  requestPermission(): Promise<{ status: string }>;
  start(options?: { distanceFilter?: number; accuracy?: 'high' | 'bestForNavigation' | 'ten' }): Promise<{ started: boolean; authorization: string }>;
  stop(): Promise<{ coords: BgCoord[] }>;
  /** native 가 백그라운드/포어그라운드 동안 누적한 좌표를 회수 + 버퍼 비움. 세션은 그대로 활성. */
  flush(): Promise<{ coords: BgCoord[] }>;
  addListener(eventName: 'location', listenerFunc: (data: BgCoord) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'error', listenerFunc: (data: { message: string }) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'authorizationChange', listenerFunc: (data: { status: string }) => void): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

export const BackgroundLocation = registerPlugin<BackgroundLocationPlugin>('BackgroundLocation');

function isNativeIos(): boolean {
  if (typeof window === 'undefined') return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cap = (window as any).Capacitor;
  return cap?.isNativePlatform?.() && cap?.getPlatform?.() === 'ios';
}

export function isBackgroundLocationAvailable(): boolean {
  // 현재는 iOS native 만 구현. 웹/Android 는 호출자가 @capacitor/geolocation 폴백 사용.
  return isNativeIos();
}
