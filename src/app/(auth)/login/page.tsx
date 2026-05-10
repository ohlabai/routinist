'use client';

import { useState, useEffect, useRef } from 'react';
import { signInWithProvider, signInWithEmail, signUpWithEmail, sendPasswordResetEmail } from '@/lib/auth';
import { useAuth } from '@/components/AuthProvider';
import type { Provider } from '@supabase/supabase-js';
import AppLogo from '@/components/AppLogo';
import Link from 'next/link';

// 로그인 화면은 브랜드 톤(라이트) 고정 — 다크모드 시스템 설정과 무관하게 일관된 온보딩 경험
type Mode = 'social' | 'email-login' | 'email-signup';
type CapacitorWindow = Window & {
  Capacitor?: unknown;
};

export default function LoginPage() {
  const { user, loading } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('social');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showDebug, setShowDebug] = useState(false);
  const [debugLog, setDebugLog] = useState('');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!loading && user) {
      window.location.replace('/dashboard');
    }
  }, [user, loading]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // Safari/인앱 브라우저에서 앱으로 복귀(= 포그라운드 진입) 감지 → 로딩 스피너 리셋
  // 사용자가 OAuth 취소/뒤로가기한 경우에도 UI가 즉시 풀림
  useEffect(() => {
    const isNative = typeof window !== 'undefined' && (window as CapacitorWindow).Capacitor !== undefined;
    if (!isNative) return;
    let remove: (() => void) | null = null;
    import('@capacitor/app').then(({ App }) => {
      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive && loadingProvider) {
          // 조금 기다렸다 풀기 — 딥링크 처리가 먼저 완료되어 dashboard 이동할 시간을 줌
          setTimeout(() => setLoadingProvider(null), 1500);
        }
      }).then(handle => { remove = () => handle.remove(); });
    }).catch(() => {});
    return () => { remove?.(); };
  }, [loadingProvider]);

  // /login?debug=1 접근 시 진단 로그 패널 표시
  // /login?reason=session_expired 접근 시 안내 배너 (refreshSession 실패로 강제 로그아웃된 경우)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.has('debug')) setShowDebug(true);
    if (params.get('reason') === 'session_expired') {
      setInfo('로그인이 만료되어 자동으로 로그아웃했어요. 다시 로그인해주세요.');
    } else if (params.get('reason') === 'force_fresh') {
      setInfo('세션을 초기화했어요. 다시 로그인해주세요.');
    }
  }, []);

  const refreshDebug = () => {
    try {
      setDebugLog(window.localStorage.getItem('routinist_auth_log') || '(로그 없음)');
    } catch {
      setDebugLog('(로그 접근 실패)');
    }
  };

  const handleSocialLogin = async (provider: Provider) => {
    setError(null);
    setInfo(null);
    setLoadingProvider(provider);
    try {
      await signInWithProvider(provider);
      timeoutRef.current = setTimeout(() => setLoadingProvider(null), 30000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '로그인 중 오류가 발생했습니다.';
      setError(`로그인 실패: ${msg}`);
      setLoadingProvider(null);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoadingProvider('email');
    try {
      if (mode === 'email-login') {
        await signInWithEmail(email.trim(), password);
      } else {
        await signUpWithEmail(email.trim(), password, displayName.trim() || undefined);
        setInfo('가입 확인 메일을 보냈습니다. 메일함에서 링크를 눌러 완료해주세요.');
      }
    } catch (e2) {
      const msg = e2 instanceof Error ? e2.message : '오류가 발생했습니다.';
      // 사용자 피드백 #7: 가입 안 된 이메일로 로그인 시도 → 회원가입 모드로 자동 안내
      if (mode === 'email-login' && /invalid login credentials/i.test(msg)) {
        setMode('email-signup');
        setInfo('가입되지 않은 이메일이거나 비밀번호가 틀렸어요.\n처음이라면 아래에서 회원가입을 진행해주세요.');
        setLoadingProvider(null);
        return;
      }
      // 이미 가입된 이메일로 회원가입 시도
      if (mode === 'email-signup' && /already registered|already exists|user already/i.test(msg)) {
        setMode('email-login');
        setInfo('이미 가입된 이메일이에요. 비밀번호로 로그인해주세요.');
        setLoadingProvider(null);
        return;
      }
      setError(msg);
    } finally {
      setLoadingProvider(null);
    }
  };

  const handleResetPassword = async () => {
    if (!email.trim()) {
      setError('비밀번호 재설정을 위해 이메일을 먼저 입력해주세요.');
      return;
    }
    try {
      await sendPasswordResetEmail(email.trim());
      setInfo('비밀번호 재설정 메일을 보냈습니다.');
    } catch (e) {
      setError(e instanceof Error ? e.message : '재설정 메일 전송 실패');
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 relative overflow-hidden bg-gradient-to-br from-blue-50 via-white to-green-50 text-gray-900 py-10">
      <div className="absolute top-[-80px] right-[-60px] w-64 h-64 rounded-full bg-blue-200/30 blur-3xl" />
      <div className="absolute bottom-[-60px] left-[-40px] w-48 h-48 rounded-full bg-green-200/30 blur-3xl" />

      <div className="flex flex-col items-center text-center mb-10 relative z-10">
        <div className="mb-4">
          <AppLogo size={80} />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Routinist</h1>
        <p className="text-sm text-gray-500 mt-2">Run Your Routine!</p>
      </div>

      <div className="w-full max-w-sm relative z-10">
        {mode === 'social' && (
          <div className="space-y-3">
            <button
              onClick={() => handleSocialLogin('google')}
              disabled={loadingProvider !== null}
              className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-50 text-gray-700 font-semibold py-3.5 rounded-xl transition-all text-base border border-gray-300 disabled:opacity-50"
            >
              {loadingProvider === 'google' ? (
                <div className="animate-spin w-5 h-5 border-2 border-gray-500 border-t-transparent rounded-full" />
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
              )}
              {loadingProvider === 'google' ? 'Google로 이동 중...' : 'Google로 시작하기'}
            </button>

            <button
              onClick={() => handleSocialLogin('apple')}
              disabled={loadingProvider !== null}
              className="w-full flex items-center justify-center gap-3 bg-black hover:bg-gray-900 text-white font-semibold py-3.5 rounded-xl transition-all text-base disabled:opacity-50"
            >
              {loadingProvider === 'apple' ? (
                <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                  <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                </svg>
              )}
              {loadingProvider === 'apple' ? 'Apple로 이동 중...' : 'Apple로 시작하기'}
            </button>

            <div className="flex items-center gap-3 py-2">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400">또는</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            <button
              onClick={() => setMode('email-signup')}
              disabled={loadingProvider !== null}
              className="w-full py-3 rounded-xl border border-emerald-500 bg-white text-emerald-700 font-semibold hover:bg-emerald-50 disabled:opacity-50"
            >
              이메일로 회원가입
            </button>
            <button
              onClick={() => setMode('email-login')}
              disabled={loadingProvider !== null}
              className="w-full py-2.5 text-sm text-gray-500 hover:text-gray-800 disabled:opacity-50"
            >
              이미 계정이 있어요 — 이메일로 로그인
            </button>
          </div>
        )}

        {(mode === 'email-login' || mode === 'email-signup') && (
          <form onSubmit={handleEmailSubmit} className="space-y-3">
            <h2 className="text-lg font-bold text-center mb-2">
              {mode === 'email-login' ? '이메일 로그인' : '이메일 회원가입'}
            </h2>
            {mode === 'email-signup' && (
              <input
                type="text"
                placeholder="닉네임 (선택)"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-base"
              />
            )}
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="이메일"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-base"
            />
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === 'email-login' ? 'current-password' : 'new-password'}
              placeholder="비밀번호 (6자 이상)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-base"
            />
            <button
              type="submit"
              disabled={loadingProvider !== null}
              className="w-full py-3.5 rounded-xl bg-[var(--accent,#0F766E)] text-white font-semibold disabled:opacity-50"
              style={{ backgroundColor: '#0F766E' }}
            >
              {loadingProvider === 'email'
                ? '처리 중...'
                : mode === 'email-login' ? '로그인' : '가입하기'}
            </button>
            {mode === 'email-login' && (
              <button
                type="button"
                onClick={handleResetPassword}
                className="w-full text-xs text-gray-500 underline"
              >
                비밀번호를 잊으셨나요?
              </button>
            )}
            <button
              type="button"
              onClick={() => { setMode('social'); setError(null); setInfo(null); }}
              className="w-full py-2 text-sm text-gray-500"
            >
              ← 소셜 로그인으로 돌아가기
            </button>
          </form>
        )}
      </div>

      {loadingProvider && loadingProvider !== 'email' && (
        <p className="mt-4 text-xs text-gray-500 text-center max-w-xs">
          외부 브라우저에서 인증을 완료해주세요. 인증이 끝나면 앱이 자동으로 돌아옵니다.
        </p>
      )}

      {info && (
        <p className="mt-4 text-sm text-emerald-600 text-center max-w-xs whitespace-pre-line">{info}</p>
      )}
      {error && (
        <p className="mt-4 text-sm text-red-500 text-center max-w-xs whitespace-pre-line">{error}</p>
      )}

      {showDebug && (
        <div className="mt-6 w-full max-w-sm relative z-10 bg-white/80 border border-gray-300 rounded-xl p-3 text-[10px] text-gray-700">
          <div className="flex items-center justify-between mb-1">
            <span className="font-bold">진단 로그 (/login?debug=1)</span>
            <button onClick={refreshDebug} className="text-blue-600 underline">새로고침</button>
          </div>
          <pre className="whitespace-pre-wrap break-all max-h-64 overflow-auto">{debugLog || '(새로고침 눌러 로그 보기)'}</pre>
        </div>
      )}

      <p className="mt-8 text-sm text-gray-500 text-center max-w-xs relative z-10">
        시작하면{' '}
        <Link href="/terms" className="underline font-semibold text-emerald-700">
          이용약관
        </Link>
        과{' '}
        <Link href="/privacy" className="underline font-semibold text-emerald-700">
          개인정보처리방침
        </Link>
        에 동의하는 것으로 간주합니다.
      </p>
    </div>
  );
}
