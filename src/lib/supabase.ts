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
