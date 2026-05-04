'use client';

import { useEffect, useRef } from 'react';
import { getSupabase } from '@/lib/supabase';
import { handleOAuthCallback } from '@/lib/auth';
import { Suspense } from 'react';

function CallbackHandler() {
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const goToDashboard = () => {
      window.location.replace('/dashboard');
    };

    const goToLogin = () => {
      window.location.replace('/login');
    };

    const handleAuth = async () => {
      // handleOAuthCallback 가 폴링·재시도 책임 보유. 여기서는 단발 시도 + 단발 폴백.
      let session = null;
      try {
        session = await handleOAuthCallback(window.location.href);
      } catch (err) {
        console.error('[Auth Callback] 처리 실패:', err);
      }

      if (!session) {
        // exchangeCode 실패해도 세션이 이미 저장됐을 수 있음 (web flow 의 detectSessionInUrl).
        const supabase = getSupabase();
        const { data: { session: existing } } = await supabase.auth.getSession();
        session = existing;
      }

      if (session) {
        await new Promise(r => setTimeout(r, 400));
        goToDashboard();
      } else {
        console.warn('[Auth Callback] 세션 확인 실패, 로그인 페이지로 이동');
        goToLogin();
      }
    };

    handleAuth();
  }, []);

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
