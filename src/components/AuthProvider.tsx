'use client';

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { getSupabase } from '@/lib/supabase';
import { getProfile, initializeSocialLogin, handleOAuthCallback } from '@/lib/auth';
import { dataCache } from '@/lib/data-cache';
import type { Profile } from '@/types';
import type { User, Session } from '@supabase/supabase-js';

type CapacitorWindow = Window & {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
  };
};

interface AuthState {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  profile: null,
  session: null,
  loading: true,
  refreshProfile: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

function authLog(msg: string, extra?: unknown) {
  try {
    const line = `[${new Date().toISOString()}] ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`;
    console.log('[Auth]', msg, extra ?? '');
    if (typeof window !== 'undefined') {
      const key = 'routinist_auth_log';
      const prev = window.localStorage.getItem(key) || '';
      const next = (prev + '\n' + line).split('\n').slice(-50).join('\n');
      window.localStorage.setItem(key, next);
    }
  } catch {}
}

function isNativePlatform(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as CapacitorWindow).Capacitor;
  if (!cap) return false;
  if (cap.isNativePlatform?.()) return true;
  const p = cap.getPlatform?.();
  return p === 'ios' || p === 'android';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // 다른 계정으로 변경된 걸 감지하기 위해 직전 user.id 보관. 변경되면 캐시 invalidate.
  const lastUserIdRef = useRef<string | null>(null);
  // race 가드: 빠른 SIGNED_IN(A) → SIGNED_OUT → SIGNED_IN(B) 시퀀스에서 A 의 늦은 응답이
  // B 의 profile 을 덮어쓰는 회귀 차단. 매 호출마다 gen 증가 후 결과 적용 전 비교.
  const loadGenRef = useRef(0);

  const loadProfile = useCallback(async (userId: string) => {
    const gen = ++loadGenRef.current;
    const p = await getProfile(userId);
    if (gen !== loadGenRef.current) return; // 더 새로운 호출이 진행 중 — stale drop
    setProfile(p);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) {
      await loadProfile(user.id);
    }
  }, [user, loadProfile]);

  // 네이티브 SocialLogin 플러그인 초기화 — 1회만
  useEffect(() => {
    void initializeSocialLogin();
  }, []);

  // 푸시 알림 초기화 — 로그인 후 1회만 (user 가 있어야 토큰 → DB 저장 가능)
  const pushInitedRef = useRef(false);
  useEffect(() => {
    if (!user || pushInitedRef.current) return;
    pushInitedRef.current = true;
    import('@/lib/push-notifications').then(({ initPushNotifications }) => {
      void initPushNotifications();
    }).catch(() => {});
  }, [user]);

  useEffect(() => {
    const supabase = getSupabase();
    let initialSettled = false;

    const settleInitial = (s: Session | null, source: string) => {
      if (initialSettled) return;
      initialSettled = true;
      authLog(`initial settled via ${source}`, { hasSession: !!s });
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        // 다른 계정 → 캐시 비움. 이전 사용자 데이터 노출 차단.
        if (lastUserIdRef.current && lastUserIdRef.current !== s.user.id) {
          dataCache.clearAll();
        }
        lastUserIdRef.current = s.user.id;
        void loadProfile(s.user.id);
      }
      setLoading(false);
    };

    // Supabase 는 초기화 시 INITIAL_SESSION 이벤트를 발사하지만 LTE 등 네트워크가 느릴 때
    // 토큰 갱신 라운드트립 때문에 수 초 지연될 수 있음. 1.5초 후에도 INITIAL_SESSION 이 안 오면
    // getSession() 으로 명시적 폴백 — "로그인이 지연되고 있어요" 8초 화면이 더 일찍 풀림.
    const fallbackTimer = setTimeout(() => {
      if (initialSettled) return;
      authLog('INITIAL_SESSION 지연 — getSession() 폴백');
      // SDK 가 internally lock 된 케이스 대비 — getSession 자체에 5초 timeout.
      const sessionPromise = supabase.auth.getSession();
      Promise.race([
        sessionPromise.then(({ data: { session: s } }) => ({ s, src: 'getSession-fallback' as const })),
        new Promise<{ s: null; src: 'getSession-timeout' }>((resolve) =>
          setTimeout(() => resolve({ s: null, src: 'getSession-timeout' }), 5000)
        ),
      ]).then(({ s, src }) => {
        if (src === 'getSession-timeout') authLog('getSession 폴백 5초 timeout — 미로그인 처리');
        settleInitial(s, src);
      }).catch((e) => {
        authLog(`getSession 폴백 실패: ${e instanceof Error ? e.message : e}`);
        settleInitial(null, 'getSession-fallback-error');
      });
    }, 1500);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, s) => {
        authLog('onAuthStateChange', { event, hasSession: !!s });

        // 진단 로그 (build 62): 로그인 풀림 패턴 분석용. SIGNED_OUT 이벤트가 사용자 명시 또는 토큰 만료인지 추적.
        if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !s)) {
          import('@/lib/error-logger').then(({ logClientWarn }) => {
            logClientWarn('AuthProvider', `세션 풀림: ${event}`, {
              event,
              hadSession: initialSettled,
              priorUserId: lastUserIdRef.current,
            });
          }).catch(() => {});
        } else if (event === 'TOKEN_REFRESHED') {
          import('@/lib/error-logger').then(({ logClientInfo }) => {
            logClientInfo('AuthProvider', 'token refreshed ok', { hasSession: !!s });
          }).catch(() => {});
        }

        if (!initialSettled) {
          settleInitial(s, `event:${event}`);
          return;
        }
        // 후속 이벤트 (TOKEN_REFRESHED, SIGNED_IN, SIGNED_OUT 등)
        setSession(s);
        setUser(s?.user ?? null);
        if (s?.user) {
          // fire-and-forget — auth event 콜백을 차단하지 않음. profile 로딩이 hang 해도
          // 다음 auth event (예: SIGNED_OUT) 가 즉시 처리됨.
          void loadProfile(s.user.id);
        } else {
          setProfile(null);
        }
      }
    );

    return () => {
      clearTimeout(fallbackTimer);
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  // 웹 환경에서 비밀번호 재설정 메일·기존 세션 등으로 딥링크가 들어올 가능성에 대비.
  // 네이티브 OAuth 콜백은 더 이상 사용하지 않음 (capgo SocialLogin 이 idToken 직접 반환).
  useEffect(() => {
    if (!isNativePlatform()) return;
    let removeUrlListener: (() => void) | null = null;
    let processing = false;

    const processCallbackUrl = async (url: string) => {
      // build 136: 공유 링크로 들어온 routinist://activity?id=... → 활동 상세로 라우팅.
      // 카톡/인스타에서 routinist.kr/r/{id} 클릭 → /r/{id} 페이지가 deep link 호출 → 앱이 열리면 이 핸들러.
      try {
        const parsed = new URL(url);
        if (parsed.protocol === 'routinist:' && parsed.host === 'activity') {
          const aid = parsed.searchParams.get('id');
          if (aid) {
            // 라우터 push 가능한 위치라면 사용, 아니면 location 으로.
            window.location.replace(`/activity?id=${encodeURIComponent(aid)}`);
            return;
          }
        }
      } catch { /* 잘못된 URL — fallthrough */ }

      // 비밀번호 재설정 같은 deep link 만 처리. 일반 OAuth 콜백은 안 옴.
      if (!(url.includes('auth/callback') || url.includes('access_token') || url.includes('code='))) {
        return;
      }
      if (processing) return;
      processing = true;
      try {
        const s = await handleOAuthCallback(url);
        if (s && !window.location.pathname.startsWith('/dashboard')) {
          await new Promise((r) => setTimeout(r, 300));
          window.location.replace('/dashboard');
        }
      } catch (e) {
        authLog('딥링크 콜백 처리 실패', { error: String(e) });
      } finally {
        processing = false;
      }
    };

    import('@capacitor/app').then(({ App }) => {
      App.addListener('appUrlOpen', async ({ url }) => {
        await processCallbackUrl(url);
      }).then((handle) => {
        removeUrlListener = () => handle.remove();
      });
      App.getLaunchUrl().then((result) => {
        if (result?.url) processCallbackUrl(result.url);
      }).catch(() => {});
    }).catch(() => {});

    return () => {
      removeUrlListener?.();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, session, loading, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}
