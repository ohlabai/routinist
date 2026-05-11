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

// SocialLogin.login hang / unsupported 대응 — timeout race.
// 사용자 명시적 취소 ('cancel' 메시지 포함 reject) 는 그대로 통과.
function withSocialLoginTimeout<T>(p: PromiseLike<T>, ms: number, provider: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`${provider} 로그인 응답이 ${ms / 1000}초 안에 도착하지 않았어요`));
    }, ms);
    Promise.resolve(p).then(
      (v) => { if (settled) return; settled = true; clearTimeout(timer); resolve(v); },
      (e) => { if (settled) return; settled = true; clearTimeout(timer); reject(e); },
    );
  });
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
  try {
    await initializeSocialLogin();
  } catch (e) {
    logAuth(`signInNative(${provider}) init 실패: ${e instanceof Error ? e.message : e}`);
  }
  logAuth(`signInNative(${provider}) init done, initialized=${socialLoginInitialized}`);

  const { SocialLogin } = await import('@capgo/capacitor-social-login');
  const supabase = getSupabase();

  if (provider === 'apple') {
    const rawNonce = generateRawNonce();
    const hashedNonce = await sha256Hex(rawNonce);
    logAuth('signInNative(apple) calling SocialLogin.login');
    // Apple 심사 거절 (Submission ab0f5a3b, iPad Air M3 / iPadOS 26.4.2):
    // capgo plugin 의 iPadOS 호환성 이슈로 SocialLogin.login 이 hang 가능.
    // 30s timeout + 실패 시 즉시 web OAuth 폴백 → 사용자가 Safari 시트로 로그인 진행.
    let res: Awaited<ReturnType<typeof SocialLogin.login>>;
    try {
      res = await withSocialLoginTimeout(
        SocialLogin.login({
          provider: 'apple',
          options: { scopes: ['email', 'name'], nonce: hashedNonce },
        }),
        30000,
        'apple',
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logAuth(`signInNative(apple) plugin fail: ${msg} — fallback to web OAuth`);
      // 사용자 취소 (사용자가 명시적 취소) 는 폴백 안 함 — 그냥 throw
      if (/cancel|canceled|cancelled/i.test(msg)) {
        throw new Error('로그인이 취소됐어요.');
      }
      // hang / timeout / "not supported" 등 → 웹 OAuth 폴백
      logAuth('signInNative(apple) falling back to signInWebOAuth');
      return await signInWebOAuth('apple');
    }
    logAuth(`signInNative(apple) login resolved provider=${res.provider}`);
    if (res.provider !== 'apple') throw new Error('예상하지 못한 provider 응답');
    const appleResult = res.result as { idToken?: string };
    const idToken = appleResult.idToken;
    if (!idToken) {
      logAuth('Apple idToken 없음 → web OAuth 폴백');
      return await signInWebOAuth('apple');
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

  // Google — 같은 폴백 패턴.
  logAuth('signInNative(google) calling SocialLogin.login');
  let res: Awaited<ReturnType<typeof SocialLogin.login>>;
  try {
    res = await withSocialLoginTimeout(
      SocialLogin.login({
        provider: 'google',
        options: { scopes: ['email', 'profile'] },
      }),
      30000,
      'google',
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logAuth(`signInNative(google) plugin fail: ${msg} — fallback to web OAuth`);
    if (/cancel|canceled|cancelled/i.test(msg)) {
      throw new Error('로그인이 취소됐어요.');
    }
    return await signInWebOAuth('google');
  }
  logAuth(`signInNative(google) login resolved provider=${res.provider}`);
  if (res.provider !== 'google') throw new Error('예상하지 못한 provider 응답');
  const googleResult = res.result as { responseType?: string; idToken?: string };
  if (googleResult.responseType !== 'online') {
    throw new Error('Google 로그인 응답 형식이 올바르지 않아요.');
  }
  const idToken = googleResult.idToken;
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

// signInWithOAuth — 웹 + 네이티브 폴백 둘 다 지원.
// native 환경: skipBrowserRedirect:true 로 URL 만 받아 Capacitor Browser 로 Safari 시트 띄움.
// → routinist:// 딥링크로 앱 복귀 시 AuthProvider 의 appUrlOpen 리스너가 토큰 처리.
async function signInWebOAuth(provider: Provider) {
  const supabase = getSupabase();
  const native = isNativeApp();
  const redirectTo = native
    ? APP_URL_SCHEME
    : `${window.location.origin}${WEB_CALLBACK_PATH}`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: native, // 네이티브에선 자동 redirect 안 하고 URL 만 받기
      queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined,
    },
  });
  if (error) {
    logAuth(`signInWithOAuth(${provider}) error: ${error.message}`);
    throw error;
  }
  if (!data?.url) {
    throw new Error('OAuth URL 을 받지 못했어요.');
  }

  if (native) {
    // Capacitor Browser 로 Safari 시트 열기.
    // 사용자가 시트 안에서 OAuth 완료 → Apple/Google 이 routinist:// 로 redirect → 앱 복귀.
    logAuth(`signInWithOAuth(${provider}) native — opening Capacitor Browser`);
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({
        url: data.url,
        windowName: '_self',
        presentationStyle: 'popover',  // iPad popover 호환
      });
    } catch (e) {
      logAuth(`Browser.open 실패, fallback to window.open: ${e instanceof Error ? e.message : e}`);
      window.location.href = data.url;
    }
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

// 이메일/비밀번호 회원가입 — Supabase 가 confirm 메일 보냄 (Dashboard 의 Confirm email ON 필수).
// emailRedirectTo: 메일의 confirm 링크 클릭 후 돌아올 곳 (네이티브는 딥링크).
export async function signUpWithEmail(email: string, password: string, displayName?: string) {
  const supabase = getSupabase();
  const emailRedirectTo = isNativeApp()
    ? APP_URL_SCHEME
    : `${typeof window !== 'undefined' ? window.location.origin : 'https://routinist.kr'}${WEB_CALLBACK_PATH}`;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: displayName ? { display_name: displayName } : undefined,
      emailRedirectTo,
    },
  });
  if (error) throw error;
  return data;
}

// 이메일/비밀번호 로그인. 이메일 미확인 사용자는 차단 (사용자 피드백 — 인증 과정 강제).
export async function signInWithEmail(email: string, password: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (data.user && !data.user.email_confirmed_at) {
    // 이메일 확인 안 된 계정 — 즉시 로그아웃 + 명확한 안내.
    await supabase.auth.signOut().catch(() => {});
    throw new Error('이메일 인증이 완료되지 않았어요. 가입 시 보낸 메일에서 링크를 눌러주세요.');
  }
  return data;
}

// 인증 메일 재전송
export async function resendEmailConfirmation(email: string) {
  const supabase = getSupabase();
  const emailRedirectTo = isNativeApp()
    ? APP_URL_SCHEME
    : `${typeof window !== 'undefined' ? window.location.origin : 'https://routinist.kr'}${WEB_CALLBACK_PATH}`;
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo },
  });
  if (error) throw error;
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
