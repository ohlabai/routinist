import { getSupabase } from './supabase';
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

function getRedirectTo(): string {
  if (isNativeApp()) return APP_URL_SCHEME;
  return `${window.location.origin}${WEB_CALLBACK_PATH}`;
}

// 네이티브 브라우저 닫기 — 닫혀있어도 OK, 못 닫혀도 흐름 막지 않음
async function closeNativeBrowser(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.close();
  } catch {}
}

// 진단 로그 기록 — /login?debug=1 에서 확인 가능
function logAuth(message: string) {
  if (typeof window === 'undefined') return;
  try {
    const prev = window.localStorage.getItem('routinist_auth_log') || '';
    const ts = new Date().toISOString().slice(11, 19);
    const next = `${prev}\n[${ts}] ${message}`.trim().split('\n').slice(-40).join('\n');
    window.localStorage.setItem('routinist_auth_log', next);
  } catch {}
}

// 소셜 로그인
// 모든 플랫폼에서 Supabase OAuth + redirect URL 플로우를 사용한다.
// iOS 네이티브 SocialLogin 경로는 Apple AuthenticationServices error 1000과
// Google 플러그인 대기 상태가 발생해 TestFlight에서 불안정했다.
export async function signInWithProvider(provider: Provider) {
  const supabase = getSupabase();
  const native = isNativeApp();
  const nativePlatform = getNativePlatform();
  const redirectTo = getRedirectTo();

  logAuth(`signInWithProvider(${provider}) platform=${nativePlatform ?? (native ? 'native' : 'web')} redirectTo=${redirectTo}`);

  return await signInWithOAuthProvider(supabase, provider, native, redirectTo);
}

async function signInWithOAuthProvider(
  supabase: ReturnType<typeof getSupabase>,
  provider: Provider,
  native: boolean,
  redirectTo: string,
) {
  if (native && redirectTo !== APP_URL_SCHEME) {
    throw new Error(`네이티브 OAuth redirect가 잘못되었습니다: ${redirectTo}`);
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: native,
      queryParams: provider === 'google'
        ? { prompt: 'select_account' }
        : undefined,
    },
  });

  if (error) {
    logAuth(`signInWithOAuth error: ${error.message}`);
    throw error;
  }

  if (!data?.url) {
    logAuth(`signInWithOAuth returned empty url (provider=${provider})`);
    throw new Error('OAuth URL을 받지 못했어요. Supabase 설정(Site URL / Redirect URLs)을 확인해주세요.');
  }

  logAuth(`OAuth URL length=${data.url.length} starts=${data.url.slice(0, 80)}`);

  if (native) {
    try {
      const { Browser } = await import('@capacitor/browser');
      await closeNativeBrowser();
      await Browser.open({ url: data.url, presentationStyle: 'fullscreen' });
      logAuth('Browser.open success');
    } catch (e) {
      logAuth(`Browser.open 실패: ${e instanceof Error ? e.message : e}`);
      window.location.href = data.url;
    }
  }

  return data;
}

// Capacitor 딥링크에서 세션 토큰 추출 및 설정
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
    await closeNativeBrowser();
    const desc = queryParams.get('error_description') || hashParams.get('error_description') || '';
    const lower = `${oauthError} ${desc}`.toLowerCase();
    // 같은 이메일이 다른 provider 로 이미 가입된 경우 — 한국어로 명확 안내
    if (lower.includes('database error') || lower.includes('already') || lower.includes('email')) {
      throw new Error('이미 다른 방법(Google·이메일 등)으로 가입된 계정입니다. 처음 가입했던 방법으로 로그인해주세요.');
    }
    if (lower.includes('access_denied') || lower.includes('cancel')) {
      throw new Error('로그인이 취소됐어요.');
    }
    throw new Error(`OAuth 프로바이더 에러: ${oauthError} ${desc}`);
  }

  // 세션 교환을 **먼저** 처리하고 Browser.close() 는 마지막에 호출 —
  // 첫 실행 시 Browser.close() 가 webview 포커스 전환을 일으켜 exchangeCodeForSession 타이밍에
  // 영향을 주는 케이스를 차단.
  let resolvedSession: Session | null = null;

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      await closeNativeBrowser();
      console.error('[Auth] exchangeCode 실패:', error.message);
      throw new Error(`exchangeCode 실패: ${error.message}`);
    }
    resolvedSession = data.session;
  } else if (accessToken && refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) {
      await closeNativeBrowser();
      console.error('[Auth] setSession 실패:', error.message);
      throw new Error(`setSession 실패: ${error.message}`);
    }
    resolvedSession = data.session;
  } else {
    // 토큰/코드 없음 — 이미 세션이 붙어 있는지 폴링 (iOS WebKit localStorage 지연)
    for (let i = 0; i < 4 && !resolvedSession; i++) {
      await new Promise(r => setTimeout(r, 250));
      const { data: { session } } = await supabase.auth.getSession();
      if (session) resolvedSession = session;
    }
  }

  // 세션 확정 후 Browser.close() — 포커스 전환이 AuthProvider 의 상태 업데이트를 방해하지 않도록
  await closeNativeBrowser();

  if (!resolvedSession) {
    console.warn('[Auth] OAuth callback에서 토큰/코드를 찾을 수 없음:', url);
  }
  return resolvedSession;
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
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: getRedirectTo() });
  if (error) throw error;
}

// 로그아웃
// 주의: scope:'global' 은 토큰이 무효한 경우 401 + 네트워크 hang 으로 멈춤.
// 로컬 세션만 비우는 'local' 로 호출 + 3초 timeout + 어떤 실패도 swallow → 항상 빠르게 완료.
// 호출부에서는 await signOut() 후 무조건 /login 으로 이동하면 OK.
export async function signOut() {
  const supabase = getSupabase();
  logAuth('signOut start');

  // Browser.close 는 fire-and-forget — signOut 흐름을 막지 않도록 await 하지 않음
  void closeNativeBrowser();

  try {
    await Promise.race([
      supabase.auth.signOut({ scope: 'local' }),
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ]);
    logAuth('signOut done');
  } catch (e) {
    logAuth(`signOut swallowed: ${e instanceof Error ? e.message : e}`);
  }
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
