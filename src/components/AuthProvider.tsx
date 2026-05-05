'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getSupabase } from '@/lib/supabase';
import { getProfile, initializeSocialLogin, handleOAuthCallback } from '@/lib/auth';
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

  const loadProfile = useCallback(async (userId: string) => {
    const p = await getProfile(userId);
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

  // 웹 환경에서 비밀번호 재설정 메일·기존 세션 등으로 딥링크가 들어올 가능성에 대비.
  // 네이티브 OAuth 콜백은 더 이상 사용하지 않음 (capgo SocialLogin 이 idToken 직접 반환).
  useEffect(() => {
    if (!isNativePlatform()) return;
    let removeUrlListener: (() => void) | null = null;
    let processing = false;

    const processCallbackUrl = async (url: string) => {
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
