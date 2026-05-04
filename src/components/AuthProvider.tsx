'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getSupabase } from '@/lib/supabase';
import { getProfile, handleOAuthCallback } from '@/lib/auth';
import type { Profile } from '@/types';
import type { User, Session } from '@supabase/supabase-js';

type CapacitorWindow = Window & {
  Capacitor?: unknown;
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

// 로그인 진단 로그 — 사용자가 실기기에서 /login?debug=1 을 열면 화면에서 확인 가능
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string) => {
    const p = await getProfile(userId);
    setProfile(p);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) {
      await loadProfile(user.id);
    }
  }, [user, loadProfile]);

  useEffect(() => {
    const supabase = getSupabase();

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        loadProfile(s.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, s) => {
        authLog('onAuthStateChange', { event, hasSession: !!s });
        setSession(s);
        setUser(s?.user ?? null);
        if (s?.user) {
          await loadProfile(s.user.id);
        } else {
          setProfile(null);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [loadProfile]);

  // Capacitor 딥링크 처리 — OAuth 콜백 URL을 받아서 세션 설정
  useEffect(() => {
    const isNative = typeof window !== 'undefined' &&
      (window as CapacitorWindow).Capacitor !== undefined;
    if (!isNative) return;

    let removeUrlListener: (() => void) | null = null;

    // 중복 실행 방지 — appUrlOpen + getLaunchUrl 이 동일 URL 로 2번 불릴 수 있음.
    // 첫 시도가 code 를 소비한 뒤 두 번째 시도가 invalid_grant 로 실패 → "첫 로그인 실패" 버그의 주원인.
    let processing = false;
    let lastProcessedUrl = '';

    const processCallbackUrl = async (url: string) => {
      authLog('딥링크 수신', { url: url.slice(0, 200) });
      if (!(url.includes('auth/callback') || url.includes('access_token') || url.includes('code='))) {
        authLog('auth 관련 URL 아님 — 스킵');
        return;
      }
      if (processing || lastProcessedUrl === url) {
        authLog('중복 콜백 스킵', { processing, sameUrl: lastProcessedUrl === url });
        return;
      }
      processing = true;
      lastProcessedUrl = url;

      let resolvedSession: Session | null = null;
      let lastError: unknown = null;
      try {
        // handleOAuthCallback 가 폴링·재시도 책임 보유. 여기서는 단발 호출 + 단발 폴백만.
        try {
          resolvedSession = await handleOAuthCallback(url);
          if (resolvedSession) authLog('OAuth 콜백 성공');
        } catch (e) {
          lastError = e;
          authLog('OAuth 콜백 에러', { error: String(e) });
          // exchangeCode 가 throw 해도 세션이 저장됐을 수 있음 — 단발 확인
          const supabase = getSupabase();
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            resolvedSession = session;
            authLog('에러 폴백: 세션 발견');
          }
        }

        if (resolvedSession) {
          // onAuthStateChange 가 user 를 업데이트할 시간을 주고 이동.
          await new Promise(r => setTimeout(r, 400));
          if (!window.location.pathname.startsWith('/dashboard')) {
            window.location.replace('/dashboard');
          }
        } else {
          authLog('모든 OAuth 시도 실패', { lastError: String(lastError) });
        }
      } finally {
        processing = false;
      }
    };

    import('@capacitor/app').then(({ App }) => {
      // 1) 앱이 이미 열린 상태에서 딥링크가 들어오는 경우
      App.addListener('appUrlOpen', async ({ url }) => {
        await processCallbackUrl(url);
      }).then(handle => {
        removeUrlListener = () => handle.remove();
      });

      // 2) 콜드 스타트: 앱이 완전히 종료됐다가 딥링크로 되살아난 경우
      //    appUrlOpen 이벤트가 리스너 등록 전에 발생해 유실될 수 있음 → getLaunchUrl로 회수
      App.getLaunchUrl().then(result => {
        if (result?.url) {
          authLog('콜드 스타트 launchUrl', { url: result.url.slice(0, 200) });
          processCallbackUrl(result.url);
        }
      }).catch(() => {});
    }).catch(() => {});

    return () => { removeUrlListener?.(); };
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, session, loading, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}
