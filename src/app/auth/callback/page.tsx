'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { getSupabase } from '@/lib/supabase';
import { handleOAuthCallback } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';

type Phase = 'processing' | 'email-success' | 'email-failed';

function CallbackHandler() {
  const { tt } = useI18n();
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
    // Supabase verify endpoint 실패 시엔 ?error=... 또는 #error=... 로 옴 (token 만료/이미 사용 등).
    const verifyError = url.searchParams.get('error')
      || url.hash.match(/error=([^&]+)/)?.[1]
      || null;
    const verifyErrorDesc = url.searchParams.get('error_description')
      || url.hash.match(/error_description=([^&]+)/)?.[1]
      || null;

    const goToDashboard = () => {
      window.location.replace('/dashboard');
    };

    const goToLogin = (q?: string) => {
      window.location.replace(`/login${q ? `?${q}` : ''}`);
    };

    const handleAuth = async () => {
      // 이메일 인증 경로: Supabase 의 verify 엔드포인트가 이미 email_confirmed_at 을
      // 채워준 상태로 redirect 됨 (linkabd... /auth/v1/verify → app.routinist.kr).
      // 사용자는 보통 PC 브라우저에서 메일을 여는데, PKCE code verifier 는 가입할 때
      // 사용한 모바일 앱에만 있으므로 exchangeCode 는 PC 에서 항상 실패함.
      // 하지만 **인증 자체는 이미 완료**되어 있으므로 성공 화면을 보여주면 됨.
      if (fromEmail) {
        if (verifyError) {
          // 진짜 verify 실패 (토큰 만료/이미 사용 등) — 사용자에게 재발송 안내.
          setReason(verifyErrorDesc ? decodeURIComponent(verifyErrorDesc).replace(/\+/g, ' ') : verifyError);
          setPhase('email-failed');
          return;
        }
        // 혹시 같은 브라우저에서 가입했다면 세션이 만들어질 수도 — 있으면 정리.
        // (PC 브라우저 세션은 모바일 앱과 무관하므로 정리해서 혼동 방지)
        try {
          const { data: { session: existing } } = await getSupabase().auth.getSession();
          if (existing) {
            await getSupabase().auth.signOut({ scope: 'local' }).catch(() => {});
          }
        } catch {}
        setPhase('email-success');
        return;
      }

      // OAuth 등 일반 콜백: 기존 동작 (자동 redirect)
      let session = null;
      try {
        session = await handleOAuthCallback(window.location.href);
      } catch (err) {
        console.error('[Auth Callback] 처리 실패:', err);
        if (err instanceof Error) setReason(err.message);
      }
      if (!session) {
        const { data: { session: existing } } = await getSupabase().auth.getSession();
        session = existing;
      }
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
            <h1 className="text-2xl font-bold text-gray-900">{tt('이메일 인증 완료!')}</h1>
            <p className="mt-2 text-sm text-gray-600 leading-relaxed">
              {tt('인증이 정상적으로 처리됐어요.')}
              <br />
              {tt('이제 앱(또는 웹)으로 돌아가 로그인해주세요.')}
            </p>
          </div>
          <a
            href="routinist://auth/login"
            className="block w-full py-3.5 rounded-xl text-white font-semibold"
            style={{ backgroundColor: '#0F766E' }}
          >
            {tt('앱 열기')}
          </a>
          <a
            href="/login"
            className="block w-full py-3 rounded-xl border border-emerald-500 bg-white text-emerald-700 font-semibold"
          >
            {tt('웹에서 로그인 계속하기')}
          </a>
          <p className="text-[11px] text-gray-400 leading-relaxed">
            {tt('앱이 안 열리면 App Store 에서 Routinist 를 먼저 설치해주세요.')}
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
            <h1 className="text-xl font-bold text-gray-900">{tt('인증 링크가 만료됐어요')}</h1>
            <p className="mt-2 text-sm text-gray-600 leading-relaxed">
              {tt('링크가 이미 사용됐거나 시간이 지났을 수 있어요.')}
              <br />
              {tt('로그인 화면에서 메일을 다시 받아주세요.')}
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
            {tt('로그인 화면으로')}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-3 border-[var(--accent)] border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-xs text-[var(--muted)]">{tt('로그인 처리 중...')}</p>
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
