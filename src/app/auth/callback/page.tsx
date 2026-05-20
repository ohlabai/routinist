'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { getSupabase } from '@/lib/supabase';
import { handleOAuthCallback } from '@/lib/auth';

type Phase = 'processing' | 'email-success' | 'email-failed';

function CallbackHandler() {
  const handled = useRef(false);
  const [phase, setPhase] = useState<Phase>('processing');
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    // 이메일 confirm 링크에서 온 경우는 자동 dashboard 로 보내지 않고 명시적 성공 화면을 띄움.
    // 사용자는 보통 PC 브라우저에서 메일을 열기 때문에, 모바일 앱으로 가서 로그인해야 한다는 안내가 필요.
    const url = new URL(window.location.href);
    const fromEmail = url.searchParams.get('from') === 'email'
      || url.searchParams.get('type') === 'signup'
      || url.hash.includes('type=signup');

    const goToDashboard = () => {
      window.location.replace('/dashboard');
    };

    const goToLogin = (q?: string) => {
      window.location.replace(`/login${q ? `?${q}` : ''}`);
    };

    const handleAuth = async () => {
      // handleOAuthCallback 가 폴링·재시도 책임 보유. 여기서는 단발 시도 + 단발 폴백.
      let session = null;
      try {
        session = await handleOAuthCallback(window.location.href);
      } catch (err) {
        console.error('[Auth Callback] 처리 실패:', err);
        if (err instanceof Error) setReason(err.message);
      }

      if (!session) {
        // exchangeCode 실패해도 세션이 이미 저장됐을 수 있음 (web flow 의 detectSessionInUrl).
        const supabase = getSupabase();
        const { data: { session: existing } } = await supabase.auth.getSession();
        session = existing;
      }

      // 이메일 인증 경로: 성공/실패 화면 표시 (자동 redirect X)
      if (fromEmail) {
        if (session) {
          // 인증 직후 세션이 PC 브라우저에 만들어졌어도, 모바일 앱에는 없음.
          // 모바일 앱에서 다시 로그인해야 하므로 PC 세션은 정리.
          await getSupabase().auth.signOut({ scope: 'local' }).catch(() => {});
          setPhase('email-success');
        } else {
          setPhase('email-failed');
        }
        return;
      }

      // OAuth 등 일반 콜백: 기존 동작 (자동 redirect)
      if (session) {
        await new Promise((r) => setTimeout(r, 400));
        goToDashboard();
      } else {
        console.warn('[Auth Callback] 세션 확인 실패, 로그인 페이지로 이동');
        goToLogin();
      }
    };

    handleAuth();
  }, []);

  if (phase === 'email-success') {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-6 bg-gradient-to-br from-blue-50 via-white to-green-50"
        style={{
          paddingTop: 'max(40px, env(safe-area-inset-top))',
          paddingBottom: 'max(40px, env(safe-area-inset-bottom))',
        }}
      >
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-emerald-100 p-7 text-center space-y-5">
          <div className="mx-auto w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#0F766E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">이메일 인증 완료!</h1>
            <p className="mt-2 text-sm text-gray-600 leading-relaxed">
              인증이 정상적으로 처리됐어요.
              <br />
              이제 앱(또는 웹)으로 돌아가 로그인해주세요.
            </p>
          </div>
          <a
            href="routinist://auth/login"
            className="block w-full py-3.5 rounded-xl text-white font-semibold"
            style={{ backgroundColor: '#0F766E' }}
          >
            앱 열기
          </a>
          <a
            href="/login"
            className="block w-full py-3 rounded-xl border border-emerald-500 bg-white text-emerald-700 font-semibold"
          >
            웹에서 로그인 계속하기
          </a>
          <p className="text-[11px] text-gray-400 leading-relaxed">
            앱이 안 열리면 App Store 에서 Routinist 를 먼저 설치해주세요.
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'email-failed') {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-6 bg-gradient-to-br from-rose-50 via-white to-orange-50"
        style={{
          paddingTop: 'max(40px, env(safe-area-inset-top))',
          paddingBottom: 'max(40px, env(safe-area-inset-bottom))',
        }}
      >
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-rose-100 p-7 text-center space-y-5">
          <div className="mx-auto w-20 h-20 rounded-full bg-rose-50 flex items-center justify-center">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#e11d48" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">인증 링크가 만료됐어요</h1>
            <p className="mt-2 text-sm text-gray-600 leading-relaxed">
              링크가 이미 사용됐거나 시간이 지났을 수 있어요.
              <br />
              로그인 화면에서 메일을 다시 받아주세요.
            </p>
            {reason && (
              <p className="mt-2 text-[11px] text-rose-500 break-all">{reason}</p>
            )}
          </div>
          <a
            href="/login"
            className="block w-full py-3.5 rounded-xl text-white font-semibold"
            style={{ backgroundColor: '#0F766E' }}
          >
            로그인 화면으로
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-3 border-[var(--accent)] border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-xs text-[var(--muted)]">로그인 처리 중...</p>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <div className="animate-spin w-8 h-8 border-3 border-[var(--accent)] border-t-transparent rounded-full" />
      </div>
    }>
      <CallbackHandler />
    </Suspense>
  );
}
