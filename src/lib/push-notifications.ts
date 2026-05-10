// 푸시 알림 클라이언트 — iOS/Android 토큰 등록 + 권한 요청.
//
// 사용 흐름:
//   1. AuthProvider 가 user 로그인 후 initPushNotifications() 호출
//   2. iOS: 권한 요청 → APN 토큰 → register_device_token RPC → DB 저장
//   3. 알림 도착 시 listener 가 deep link 열어줌 (/shop/order?id=...)
//
// 비-네이티브 환경에서는 noop. 권한 거부 시 silent fail.

import { getSupabase } from './supabase';

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

const APP_BUILD = '81';   // ErrorBoundary 와 sync — 매 빌드 갱신

let initialized = false;

export async function initPushNotifications(opts?: {
  onTokenRegistered?: (token: string) => void;
  onNotificationTap?: (deepLink: string) => void;
}): Promise<void> {
  if (initialized) return;
  if (!isNative()) {
    console.log('[push] non-native, skipping');
    return;
  }
  initialized = true;

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    // 권한 요청
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') {
      console.log('[push] permission denied');
      return;
    }

    // 토큰 등록 — register() 가 비동기로 'registration' 이벤트 발사
    await PushNotifications.register();

    // 등록 완료
    await PushNotifications.addListener('registration', async (token) => {
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
          console.warn('[push] token register RPC fail', error);
        } else {
          console.log('[push] token registered');
          opts?.onTokenRegistered?.(token.value);
        }
      } catch (e) {
        console.warn('[push] token save fail', e);
      }
    });

    // 등록 실패
    await PushNotifications.addListener('registrationError', (e) => {
      console.warn('[push] registration error', e);
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
    });
  } catch (e) {
    console.warn('[push] init fail', e);
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
