'use client';

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { getProfile, initializeSocialLogin, handleOAuthCallback } from '@/lib/auth';
import { dataCache } from '@/lib/data-cache';
import AppToast from '@/components/AppToast';
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
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // 다른 계정으로 변경된 걸 감지하기 위해 직전 user.id 보관. 변경되면 캐시 invalidate.
  const lastUserIdRef = useRef<string | null>(null);
  // race 가드: 빠른 SIGNED_IN(A) → SIGNED_OUT → SIGNED_IN(B) 시퀀스에서 A 의 늦은 응답이
  // B 의 profile 을 덮어쓰는 회귀 차단. 매 호출마다 gen 증가 후 결과 적용 전 비교.
  const loadGenRef = useRef(0);
  // build 292: routinist://invite?code= 딥링크 claim 성공 토스트.
  const [referralToast, setReferralToast] = useState<string | null>(null);

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

  // 푸시 알림 초기화 — 로그인 후 1회만 (user 가 있어야 토큰 → DB 저장 가능).
  // build 140: 첫 paint 블로킹 회피 — requestIdleCallback / 1500ms delay.
  // 푸시 init 은 native plugin 로드 + 토큰 요청 + DB upsert 라 200~500ms 비용. 홈 첫 paint 이후로 미룸.
  const pushInitedRef = useRef(false);
  useEffect(() => {
    if (!user || pushInitedRef.current) return;
    pushInitedRef.current = true;
    const run = () => {
      import('@/lib/push-notifications').then(({ initPushNotifications }) => {
        // 알림 탭 딥링크 — router.push 로 SPA 이동 (window.location.href full reload 는
        // build 165 에서 금지한 검정 flash 패턴). 앱 내 경로만 처리, 외부 URL 은 무시.
        void initPushNotifications({
          // build 298: 로그인 직후엔 이미 허용한 유저만 조용히 등록 (promptIfNeeded: false).
          // 무맥락 프롬프트가 거부율을 키워 토큰 보유 21%에 그쳤음 — 프롬프트는
          // promptPushPermission() 으로 첫 기록 저장/건강 연동 성공 순간에 띄운다.
          promptIfNeeded: false,
          onNotificationTap: (link) => {
            let path = link;
            if (path.startsWith('routinist://')) {
              // routinist://activity?id=x → /activity?id=x
              path = '/' + path.slice('routinist://'.length).replace(/^\/+/, '');
            }
            if (path.startsWith('/')) router.push(path);
          },
        });
      }).catch(() => {});
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number };
    if (typeof w.requestIdleCallback === 'function') {
      w.requestIdleCallback(run, { timeout: 3000 });
    } else {
      setTimeout(run, 1500);
    }
  }, [user, router]);

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

    /** 초대 코드 저장 + (로그인 상태면) 즉시 claim. 스킴·https 두 경로 공용. */
    const claimInviteCode = async (code: string | null) => {
      if (!code) return;
      try {
        const { storePendingReferral, claimPendingReferral, claimSuccessMessage } = await import('@/lib/referral-data');
        storePendingReferral(code);
        const { data: { session: s } } = await getSupabase().auth.getSession();
        if (s?.user) {
          const ok = await claimPendingReferral();
          if (ok) setReferralToast(claimSuccessMessage());
        }
      } catch { /* RPC 미배포 등 — 조용히 (pending 은 이미 저장됨) */ }
    };

    const processCallbackUrl = async (url: string) => {
      // build 136: 공유 링크로 들어온 routinist://activity?id=... → 활동 상세로 라우팅.
      // 카톡/인스타에서 routinist.kr/r/{id} 클릭 → /r/{id} 페이지가 deep link 호출 → 앱이 열리면 이 핸들러.
      // build 165 #5: window.location.replace 는 WebView 전체 리로드 → 검정 flash + 더블 splash.
      // Next.js router.replace 로 교체 (SPA navigation = WebView 안 깜빡임).
      try {
        const parsed = new URL(url);
        if (parsed.protocol === 'routinist:' && parsed.host === 'activity') {
          const aid = parsed.searchParams.get('id');
          if (aid) {
            // build 165 #5: race 차단 — /page.tsx (LandingPage) 가 auth 로드 완료 후
            // /dashboard 로 router.replace 하는 useEffect 와 동시에 여기서도 router.replace 하면
            // 사용자는 /page → /dashboard → /activity 흐름으로 splash 가 여러 번 깜빡.
            // window 플래그를 먼저 세팅 → LandingPage 가 이 플래그를 보면 자기 라우팅 skip.
            (window as Window & { __routinist_pending_deep_link?: string }).__routinist_pending_deep_link = aid;
            router.replace(`/activity?id=${encodeURIComponent(aid)}`);
            return;
          }
        }
        // 2026-08-03: 잠금화면 Live Activity 탭 → 러닝 화면 직행 (routinist://track)
        if (parsed.protocol === 'routinist:' && parsed.host === 'track') {
          (window as Window & { __routinist_pending_deep_link?: string }).__routinist_pending_deep_link = 'track';
          router.replace('/track');
          return;
        }

        // build 292: 친구 초대 딥링크 routinist://invite?code=ABC123 (/invite 랜딩의 "앱에서 가입하기").
        // 로그인 상태면 즉시 claim + 성공 토스트, 아니면 pending 저장 → 로그인 후 (app)/layout 이 claim.
        if (parsed.protocol === 'routinist:' && parsed.host === 'invite') {
          await claimInviteCode(parsed.searchParams.get('code'));
          return;
        }

        // 2026-08-09: 유니버설 링크 / Android App Links (https://app.routinist.kr/...) 라우팅.
        // iOS AASA(applinks:app.routinist.kr)는 이미 앱을 열어주는데 아래 분기가 전부
        // `routinist:` 스킴만 검사해서 "앱만 열리고 아무 일도 안 일어나는" 상태였다.
        // 공유·광고 링크의 종착점이라 여기서 인앱 화면으로 보내줘야 유입이 완성된다.
        if ((parsed.protocol === 'https:' || parsed.protocol === 'http:')
            && (parsed.host === 'app.routinist.kr' || parsed.host === 'routinist.kr')) {
          const path = parsed.pathname.replace(/\/+$/, '');   // trailingSlash:true 대응
          const share = path.match(/^\/r\/([^/]+)$/);
          if (share) {
            const aid = decodeURIComponent(share[1]);
            (window as Window & { __routinist_pending_deep_link?: string }).__routinist_pending_deep_link = aid;
            router.replace(`/activity?id=${encodeURIComponent(aid)}`);
            return;
          }
          if (path === '/invite') {
            await claimInviteCode(parsed.searchParams.get('code'));
            router.replace('/dashboard');
            return;
          }
          if (path === '/activity') {
            const aid = parsed.searchParams.get('id');
            if (aid) {
              (window as Window & { __routinist_pending_deep_link?: string }).__routinist_pending_deep_link = aid;
              router.replace(`/activity?id=${encodeURIComponent(aid)}`);
              return;
            }
          }
          // 그 밖의 앱 내 경로 (클럽 초대 등) 는 경로 그대로 이동 — 없으면 홈으로.
          if (path && path !== '/') {
            router.replace(`${path}${parsed.search}`);
            return;
          }
        }

        // build 189: 토스 결제 후 routinist:// 스킴 deep link 복귀 처리.
        // appScheme='routinist' 옵션 + 외부 카드 ACS 흐름에서 토스가 결제 완료 시
        // routinist://shop/payment/success?paymentKey=...&orderId=...&amount=... 로 콜백.
        // 핸들러 없으면 앱이 root(홈)로 떨어져 결제 confirm 안 됨.
        if (parsed.protocol === 'routinist:') {
          const fullPath = `${parsed.host}${parsed.pathname}`.replace(/^\/+/, '');
          const idx = fullPath.indexOf('shop/payment/');
          if (idx >= 0) {
            const route = '/' + fullPath.substring(idx);
            router.replace(`${route}${parsed.search}`);
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
          router.replace('/dashboard');
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
    // router 는 next/navigation 에서 안정적인 instance — deps 에 안 넣어도 안전.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, session, loading, refreshProfile }}>
      {children}
      {/* build 292: 초대 딥링크 claim 성공 토스트 */}
      {referralToast && (
        <AppToast text={referralToast} tone="ok" onClose={() => setReferralToast(null)} durationMs={3500} />
      )}
    </AuthContext.Provider>
  );
}
