// 푸시 알림 클라이언트 — iOS/Android 토큰 등록 + 권한 요청.
//
// 사용 흐름:
//   1. AuthProvider 가 user 로그인 후 initPushNotifications() 호출
//   2. iOS: 권한 요청 → APN 토큰 → register_device_token RPC → DB 저장
//   3. 알림 도착 시 listener 가 deep link 열어줌 (/shop/order?id=...)
//
// 비-네이티브 환경에서는 noop. 권한 거부 시 silent fail.

import { getSupabase } from './supabase';
import { logClientInfo, logClientWarn } from './error-logger';

interface CapacitorWindow extends Window {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
  };
}

function isNative(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as CapacitorWindow).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

function getPlatform(): 'ios' | 'android' | 'web' {
  if (typeof window === 'undefined') return 'web';
  const cap = (window as CapacitorWindow).Capacitor;
  const p = cap?.getPlatform?.();
  if (p === 'ios') return 'ios';
  if (p === 'android') return 'android';
  return 'web';
}

import { APP_BUILD } from './app-build';

let initialized = false;

export async function initPushNotifications(opts?: {
  onTokenRegistered?: (token: string) => void;
  onNotificationTap?: (deepLink: string) => void;
}): Promise<void> {
  if (initialized) return;
  if (!isNative()) {
    void logClientInfo('push-init', 'skip non-native', {});
    return;
  }
  initialized = true;

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    // 권한 요청
    let perm = await PushNotifications.checkPermissions();
    void logClientInfo('push-init', 'permission check', { initial: perm.receive });
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
      void logClientInfo('push-init', 'permission requested', { after: perm.receive });
    }
    if (perm.receive !== 'granted') {
      void logClientWarn('push-init', 'permission denied', { receive: perm.receive });
      return;
    }

    // 토큰 등록 — register() 가 비동기로 'registration' 이벤트 발사
    await PushNotifications.register();
    void logClientInfo('push-init', 'register() called', {});

    // 등록 완료
    await PushNotifications.addListener('registration', async (token) => {
      void logClientInfo('push-init', 'registration event', { tokenLen: token.value.length });
      try {
        const supabase = getSupabase();
        const { error } = await supabase.rpc('register_device_token', {
          p_platform: getPlatform(),
          p_token: token.value,
          p_bundle_id: 'com.routinist.app',
          p_device_name: navigator.userAgent.slice(0, 100),
          p_app_build: APP_BUILD,
        });
        if (error) {
          void logClientWarn('push-init', 'register_device_token RPC fail', { message: error.message });
        } else {
          void logClientInfo('push-init', 'token registered ok', {});
          opts?.onTokenRegistered?.(token.value);
        }
      } catch (e) {
        void logClientWarn('push-init', 'token save fail', { message: e instanceof Error ? e.message : String(e) });
      }
    });

    // 등록 실패
    await PushNotifications.addListener('registrationError', (e) => {
      void logClientWarn('push-init', 'registrationError event', { error: String(e?.error ?? e) });
    });

    // 알림 도착 (foreground)
    await PushNotifications.addListener('pushNotificationReceived', (notif) => {
      console.log('[push] received', notif);
      // foreground 일 땐 시스템 banner 가 안 뜨므로 in-app toast 로 보여주는 것도 가능 (선택)
    });

    // 알림 탭 (사용자가 알림을 누름)
    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const deepLink = action.notification.data?.deep_link as string | undefined;
      if (deepLink && opts?.onNotificationTap) {
        opts.onNotificationTap(deepLink);
      } else if (deepLink && typeof window !== 'undefined') {
        window.location.href = deepLink;
      }
      // 알림 탭 = 사용자가 확인함 → 뱃지 정리
      void clearAppBadge();
    });

    // build 224: 앱 포어그라운드 진입 시 자동 뱃지 정리. App.addListener('appStateChange') 사용.
    try {
      const { App } = await import('@capacitor/app');
      await App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) void clearAppBadge();
      });
      // 첫 init 시 한 번 호출 — 이미 카운트가 쌓여 있어도 정리.
      void clearAppBadge();
    } catch (e) {
      console.warn('[push] appStateChange listener fail', e);
    }
  } catch (e) {
    console.warn('[push] init fail', e);
  }
}

// build 224: 앱 포어그라운드 진입 시 호출 — 누적된 푸시를 정리해서 앱 아이콘 뱃지를 0 으로.
// PushNotifications.removeAllDeliveredNotifications() 는 iOS 에서 delivered notification list 를 비우고
// 시스템이 자동으로 badge 를 0 으로 재계산해줌.
export async function clearAppBadge(): Promise<void> {
  if (!isNative()) return;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.removeAllDeliveredNotifications();
  } catch (e) {
    console.warn('[push] clear badge fail', e);
  }
}

export async function unregisterPushToken(token: string): Promise<void> {
  try {
    const supabase = getSupabase();
    await supabase.rpc('unregister_device_token', { p_token: token });
  } catch (e) {
    console.warn('[push] unregister fail', e);
  }
}

export type PushPermissionState = 'granted' | 'denied' | 'prompt' | 'unavailable';

export async function checkPushPermission(): Promise<PushPermissionState> {
  if (!isNative()) return 'unavailable';
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'granted') return 'granted';
    if (perm.receive === 'denied') return 'denied';
    return 'prompt';
  } catch {
    return 'unavailable';
  }
}

/**
 * 사용자가 한 번 거부한 후 다시 허용하려면 iOS 시스템 설정으로 가야 함 (앱이 직접 못 켬).
 * 첫 prompt 단계라면 다시 호출 가능. 거부 상태면 안내만.
 */
export async function requestPushPermissionAgain(): Promise<{ ok: boolean; needSettings: boolean; message: string }> {
  const state = await checkPushPermission();
  if (state === 'unavailable') return { ok: false, needSettings: false, message: '이 기기에선 푸시를 사용할 수 없어요' };
  if (state === 'granted') return { ok: true, needSettings: false, message: '이미 푸시가 켜져있어요' };
  if (state === 'denied') {
    return { ok: false, needSettings: true, message: 'iOS 설정 → 알림 → 루티니스트 에서 알림을 켜주세요' };
  }
  // prompt 상태
  initialized = false;  // 다시 init 가능하도록
  await initPushNotifications();
  const after = await checkPushPermission();
  return {
    ok: after === 'granted',
    needSettings: after === 'denied',
    message: after === 'granted' ? '푸시가 켜졌어요 🔔' : '권한이 부여되지 않았어요',
  };
}
