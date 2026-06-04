import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _supabase: SupabaseClient | null = null;

type CapacitorWindow = Window & {
  Capacitor?: {
    getPlatform?: () => string;
    isNativePlatform?: () => boolean;
  };
};

function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  const capacitor = (window as CapacitorWindow).Capacitor;
  if (!capacitor) return false;
  if (capacitor.isNativePlatform?.()) return true;
  const platform = capacitor.getPlatform?.();
  return platform === 'ios' || platform === 'android';
}

// 네이티브 영구 저장소 어댑터.
// 사용자 보고 (2026-06-04): "한 번 로그인해도 앱 재시작마다 풀림" — iOS WKWebView 의 localStorage 가
// 1) OS storage 압박 시 wipe, 2) capacitor:// / https://localhost origin 이 "비-persistent" 로 취급되는
// 이슈로 세션이 종종 사라짐. Capacitor Preferences (iOS UserDefaults / Android SharedPreferences) 로
// 옮기면 WebView 와 무관한 native KV 저장 → 영구 보장. 웹 환경은 그대로 localStorage 폴백.
//
// build 245: localStorage 에 이미 저장된 세션이 있으면 1회 migrate (사용자가 다시 로그인 안 해도 되도록).
const nativeStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!isNativeApp()) return window.localStorage.getItem(key);
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key });
    if (value != null) return value;
    // 첫 호출 시 localStorage 에서 migrate
    const legacy = window.localStorage.getItem(key);
    if (legacy != null) {
      await Preferences.set({ key, value: legacy });
      return legacy;
    }
    return null;
  },
  async setItem(key: string, value: string): Promise<void> {
    if (!isNativeApp()) { window.localStorage.setItem(key, value); return; }
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key, value });
  },
  async removeItem(key: string): Promise<void> {
    if (!isNativeApp()) { window.localStorage.removeItem(key); return; }
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.remove({ key });
  },
};

export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Supabase 환경변수가 설정되지 않았습니다. .env.local 파일을 확인하세요.');
    }
    _supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        // PKCE: `?code=`를 쓰는 보안 흐름. 네이티브 딥링크와도 호환.
        // 명시 고정해야 supabase-js 버전마다 바뀌는 기본값에 휘둘리지 않음.
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        // 네이티브에서 앱 URL(capacitor://localhost/...)은 OAuth 콜백이 아니므로 자동 파싱 비활성화.
        // 딥링크는 AuthProvider가 직접 handleOAuthCallback으로 처리.
        detectSessionInUrl: !isNativeApp(),
        // 세션 영구 저장소 — 네이티브 KV. localStorage wipe / origin 취급 이슈 회피.
        storage: nativeStorage,
        storageKey: 'sb-routinist-auth-token',
      },
    });
  }
  return _supabase;
}

// 모듈-level singleton 의 broken state 누적 문제 회복.
// 시나리오: refreshSession hang → 같은 client 의 다른 모든 query 도 stuck →
// logout/login 해도 같은 _supabase 인스턴스 재사용 → 회복 불가.
// 이 함수는 강제 로그아웃 / 세션 만료 감지 / "강제 fresh" 버튼 등에서 호출.
// 이후 getSupabase() 가 새 client 인스턴스를 만들어 깨끗한 상태로 시작.
export function resetSupabaseClient(): void {
  _supabase = null;
}

export const supabase = typeof window !== 'undefined'
  ? (() => { try { return getSupabase(); } catch { return null as unknown as SupabaseClient; } })()
  : (null as unknown as SupabaseClient);
