import { getSupabase, resetSupabaseClient } from './supabase';
import { dataCache } from './data-cache';
import type { Profile } from '@/types';
import type { Provider, Session, User } from '@supabase/supabase-js';

type NativePlatform = 'ios' | 'android';
type CapacitorBridge = {
  getPlatform?: () => string;
  isNativePlatform?: () => boolean;
};
type CapacitorWindow = Window & {
  Capacitor?: CapacitorBridge;
};

const APP_URL_SCHEME = 'routinist://auth/callback';
const WEB_CALLBACK_PATH = '/auth/callback';

// Google iOS Client IDs (Supabase 에 등록된 두 개 중 iOS / Web)
const GOOGLE_IOS_CLIENT_ID =
  '947408039210-ot86ap8tj2095noj2tfq9mkmbrh5me8b.apps.googleusercontent.com';
const GOOGLE_WEB_CLIENT_ID =
  '947408039210-2etn4o8629ivj30dr80nsiei3ihtri3p.apps.googleusercontent.com';
// Apple Services ID — capgo plugin 은 iOS 에서 OS 에 전달하지 않고 식별용으로만 사용.
const APPLE_SERVICES_ID = 'kr.routinist.auth';

function getNativePlatform(): NativePlatform | null {
  if (typeof window === 'undefined') return null;
  const capacitor = (window as CapacitorWindow).Capacitor;
  const platform = capacitor?.getPlatform?.();
  return platform === 'ios' || platform === 'android' ? platform : null;
}

function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  const capacitor = (window as CapacitorWindow).Capacitor;
  if (!capacitor) return false;
  if (capacitor.isNativePlatform?.()) return true;
  return getNativePlatform() !== null;
}

function logAuth(message: string) {
  if (typeof window === 'undefined') return;
  try {
    const prev = window.localStorage.getItem('routinist_auth_log') || '';
    const ts = new Date().toISOString().slice(11, 19);
    const next = `${prev}\n[${ts}] ${message}`.trim().split('\n').slice(-40).join('\n');
    window.localStorage.setItem('routinist_auth_log', next);
  } catch {}
}

// Apple nonce: 랜덤 raw nonce 를 SHA-256 해시해 Apple 요청에 넣고,
// raw nonce 는 Supabase 검증용으로 보관. Supabase 가 raw → SHA-256 해서 idToken 의 nonce claim 과 비교.
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateRawNonce(): string {
  // crypto.randomUUID 는 모든 모던 브라우저·iOS WebView 에서 사용 가능
  return crypto.randomUUID().replace(/-/g, '');
}

// 네이티브 SocialLogin 초기화 — AuthProvider mount 시 1회 호출.
let socialLoginInitialized = false;
export async function initializeSocialLogin(): Promise<void> {
  if (socialLoginInitialized) return;
  if (!isNativeApp()) return;
  try {
    const { SocialLogin } = await import('@capgo/capacitor-social-login');
    await SocialLogin.initialize({
      apple: { clientId: APPLE_SERVICES_ID },
      google: {
        iOSClientId: GOOGLE_IOS_CLIENT_ID,
        iOSServerClientId: GOOGLE_WEB_CLIENT_ID,
        mode: 'online',
      },
    });
    socialLoginInitialized = true;
    logAuth('SocialLogin initialized');
  } catch (e) {
    logAuth(`SocialLogin init 실패: ${e instanceof Error ? e.message : e}`);
  }
}

// 소셜 로그인 — 네이티브에선 capgo 플러그인으로 idToken 받아 Supabase 에 직접 교환,
// 웹에선 기존 signInWithOAuth + redirect 흐름.
export async function signInWithProvider(provider: Provider) {
  const native = isNativeApp();
  // 디버그용으로 window.Capacitor 상태 함께 기록 — '왜 web 으로 빠졌는지' 추적용
  let capState = 'no-window';
  if (typeof window !== 'undefined') {
    const cap = (window as CapacitorWindow).Capacitor;
    capState = cap
      ? `cap.isNative=${cap.isNativePlatform?.()} platform=${cap.getPlatform?.()}`
      : 'cap-undefined';
  }
  logAuth(`signInWithProvider(${provider}) native=${native} ${capState}`);

  if (native) {
    return await signInNative(provider);
  }
  return await signInWebOAuth(provider);
}

async function signInNative(provider: Provider) {
  if (provider !== 'apple' && provider !== 'google') {
    throw new Error(`네이티브 ${provider} 로그인은 지원되지 않아요.`);
  }
  logAuth(`signInNative(${provider}) start, initialized=${socialLoginInitialized}`);
  await initializeSocialLogin();
  logAuth(`signInNative(${provider}) init done, initialized=${socialLoginInitialized}`);

  const { SocialLogin } = await import('@capgo/capacitor-social-login');
  const supabase = getSupabase();

  if (provider === 'apple') {
    const rawNonce = generateRawNonce();
    const hashedNonce = await sha256Hex(rawNonce);
    logAuth('signInNative(apple) calling SocialLogin.login');
    const res = await SocialLogin.login({
      provider: 'apple',
      options: { scopes: ['email', 'name'], nonce: hashedNonce },
    });
    logAuth(`signInNative(apple) login resolved provider=${res.provider}`);
    if (res.provider !== 'apple') throw new Error('예상하지 못한 provider 응답');
    const idToken = res.result.idToken;
    if (!idToken) {
      logAuth('Apple idToken 없음');
      throw new Error('Apple 로그인이 취소됐거나 토큰을 받지 못했어요.');
    }
    logAuth(`Apple idToken length=${idToken.length}, calling Supabase signInWithIdToken`);
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: idToken,
      nonce: rawNonce,
    });
    if (error) {
      logAuth(`Apple signInWithIdToken 실패: ${error.message}`);
      const m = error.message.toLowerCase();
      // Supabase 가 cross-provider 충돌을 "Database error saving new user" 로 반환 (email 중복)
      if (m.includes('database error') || m.includes('already')) {
        throw new Error('이 이메일은 이미 Google 또는 이메일로 가입되어 있어요. 처음 가입했던 방법으로 다시 시도해주세요.');
      }
      if (m.includes('network') || m.includes('fetch')) {
        throw new Error('네트워크 연결을 확인하고 다시 시도해주세요.');
      }
      throw new Error(`Apple 로그인 실패: ${error.message}`);
    }
    logAuth('Apple 로그인 성공');
    return data;
  }

  // Google
  // 주: nonce 는 capgo iOS GoogleProvider 에서 GIDSignIn 에 전달하나 일부 빌드에서 hang 보고된 적 있어
  // 일단 nonce 없이 가고, 동작 확인 후 별도 PR 로 nonce 보강할 것.
  logAuth('signInNative(google) calling SocialLogin.login');
  const res = await SocialLogin.login({
    provider: 'google',
    options: { scopes: ['email', 'profile'] },
  });
  logAuth(`signInNative(google) login resolved provider=${res.provider}`);
  if (res.provider !== 'google') throw new Error('예상하지 못한 provider 응답');
  const result = res.result;
  if (result.responseType !== 'online') {
    throw new Error('Google 로그인 응답 형식이 올바르지 않아요.');
  }
  const idToken = result.idToken;
  if (!idToken) {
    logAuth('Google idToken 없음');
    throw new Error('Google 로그인이 취소됐거나 토큰을 받지 못했어요.');
  }
  logAuth(`Google idToken length=${idToken.length}, calling Supabase signInWithIdToken`);
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });
  if (error) {
    logAuth(`Google signInWithIdToken 실패: ${error.message}`);
    const m = error.message.toLowerCase();
    if (m.includes('database error') || m.includes('already')) {
      throw new Error('이 이메일은 이미 Apple 또는 이메일로 가입되어 있어요. 처음 가입했던 방법으로 다시 시도해주세요.');
    }
    if (m.includes('network') || m.includes('fetch')) {
      throw new Error('네트워크 연결을 확인하고 다시 시도해주세요.');
    }
    throw new Error(`Google 로그인 실패: ${error.message}`);
  }
  logAuth('Google 로그인 성공');
  return data;
}

// 웹용 — 기존 signInWithOAuth 흐름. 브라우저 dev/배포 환경에서만 사용.
async function signInWebOAuth(provider: Provider) {
  const supabase = getSupabase();
  const redirectTo = `${window.location.origin}${WEB_CALLBACK_PATH}`;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined,
    },
  });
  if (error) {
    logAuth(`signInWithOAuth(web) error: ${error.message}`);
    throw error;
  }
  if (!data?.url) {
    throw new Error('OAuth URL 을 받지 못했어요.');
  }
  return data;
}

// 웹 /auth/callback 경로에서 호출 — 네이티브에선 사용 안 함.
export async function handleOAuthCallback(url: string): Promise<Session | null> {
  const supabase = getSupabase();

  const hashPart = url.includes('#') ? url.split('#')[1] : '';
  const queryPart = url.includes('?') ? url.split('?')[1]?.split('#')[0] : '';
  const hashParams = new URLSearchParams(hashPart);
  const queryParams = new URLSearchParams(queryPart);

  const accessToken = hashParams.get('access_token') || queryParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token') || queryParams.get('refresh_token');
  const code = hashParams.get('code') || queryParams.get('code');
  const oauthError = queryParams.get('error') || hashParams.get('error');

  if (oauthError) {
    const desc = queryParams.get('error_description') || hashParams.get('error_description') || '';
    const lower = `${oauthError} ${desc}`.toLowerCase();
    if (lower.includes('database error') || lower.includes('already')) {
      throw new Error('이 이메일은 이미 다른 방식으로 가입되어 있어요. 처음 가입했던 방법으로 다시 시도해주세요.');
    }
    if (lower.includes('email')) {
      throw new Error('이메일 정보를 받지 못했어요. 권한 요청 화면에서 이메일 공유를 허용해주세요.');
    }
    if (lower.includes('access_denied') || lower.includes('cancel')) {
      throw new Error('로그인이 취소됐어요.');
    }
    throw new Error(`OAuth 프로바이더 에러: ${oauthError} ${desc}`);
  }

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw new Error(`exchangeCode 실패: ${error.message}`);
    return data.session;
  }
  if (accessToken && refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw new Error(`setSession 실패: ${error.message}`);
    return data.session;
  }

  // 폴백: detectSessionInUrl 등 다른 경로로 이미 세션이 저장됐을 수 있음.
  // exponential backoff: 200ms, 400ms, 800ms, 1.2s, 1.6s → 합 ~4.2초.
  // 이전 1초 (250×4) 는 토큰 교환이 느릴 때 자주 null 로 떨어졌음.
  const delays = [200, 400, 800, 1200, 1600];
  for (const ms of delays) {
    await new Promise((r) => setTimeout(r, ms));
    const { data: { session } } = await supabase.auth.getSession();
    if (session) return session;
  }
  return null;
}

// 이메일/비밀번호 회원가입
export async function signUpWithEmail(email: string, password: string, displayName?: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: displayName ? { display_name: displayName } : undefined,
    },
  });
  if (error) throw error;
  return data;
}

// 이메일/비밀번호 로그인
export async function signInWithEmail(email: string, password: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// 비밀번호 재설정 메일
export async function sendPasswordResetEmail(email: string) {
  const supabase = getSupabase();
  const redirectTo = isNativeApp()
    ? APP_URL_SCHEME
    : `${window.location.origin}${WEB_CALLBACK_PATH}`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

// 로그아웃 — scope:'local' + 3초 timeout 으로 hang 방지. 네이티브 SocialLogin 도 정리.
export async function signOut() {
  const supabase = getSupabase();
  logAuth('signOut start');

  if (isNativeApp() && socialLoginInitialized) {
    // SocialLogin 세션 정리 — fire-and-forget. 실패해도 흐름 막지 않음.
    void (async () => {
      try {
        const { SocialLogin } = await import('@capgo/capacitor-social-login');
        // 어떤 provider 였는지 모르면 둘 다 시도 (각각 독립적으로 동작, 실패 무시)
        await Promise.allSettled([
          SocialLogin.logout({ provider: 'apple' }),
          SocialLogin.logout({ provider: 'google' }),
        ]);
      } catch {}
    })();
  }

  try {
    await Promise.race([
      supabase.auth.signOut({ scope: 'local' }),
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ]);
    logAuth('signOut done');
  } catch (e) {
    logAuth(`signOut swallowed: ${e instanceof Error ? e.message : e}`);
  }

  // 모듈-level singleton 초기화 — broken state 누적 방지.
  // 다음 getSupabase() 호출 시 fresh client 생성. 새 로그인이 fresh 상태에서 시작 가능.
  resetSupabaseClient();

  // 신문 모델 (build 57): 로그아웃 시 모든 캐시 삭제. 다른 계정 로그인 시 이전 사용자 데이터 노출 차단.
  dataCache.clearAll();
}

// 현재 세션
export async function getSession(): Promise<Session | null> {
  const supabase = getSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

// 현재 유저
export async function getUser(): Promise<User | null> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// 프로필 조회
export async function getProfile(userId: string): Promise<Profile | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) return null;
  return data as Profile;
}

// 프로필 업데이트
export async function updateProfile(userId: string, updates: Partial<Pick<Profile, 'display_name' | 'avatar_url' | 'privacy_zone_lat' | 'privacy_zone_lng' | 'privacy_zone_radius_m'>>) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select()
    .single();

  if (error) throw error;
  return data as Profile;
}

// 아바타 업로드
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const supabase = getSupabase();
  const ext = file.name.split('.').pop() || 'jpg';
  const path = `${userId}/avatar.${ext}`;

  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true });

  if (error) throw error;

  const { data: { publicUrl } } = supabase.storage
    .from('avatars')
    .getPublicUrl(path);

  return publicUrl;
}
