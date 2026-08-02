'use client';

// 친구 초대 랜딩 (build 292 성장 루프) — https://app.routinist.kr/invite?code=ABC123
// /r/[id] 처럼 게스트 접근 (root 레벨 — (app) 로그인 gate 밖, privacy/terms 패턴).
// 정적 export (Capacitor) 와도 호환 — 쿼리는 window.location 에서 클라 파싱 (useSearchParams 불필요).
//
// 흐름:
//  - "앱에서 가입하기" 탭 → routinist://invite?code= 딥링크 시도 → 1.6초 내 앱 전환 없으면 스토어 fallback
//  - "웹으로 가입하기" → /login?ref={code} (login 이 localStorage 에 저장 → 로그인 후 자동 claim)
// ko/en 은 navigator 기반 locale 분기 (게스트라 프로필 locale 없음).
// useSearchParams 는 Suspense 필수 (정적 export 에선 boundary 까지 CSR bailout — 의도된 동작).

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import AppLogo from '@/components/AppLogo';
import { useI18n } from '@/lib/i18n';

const IOS_STORE_URL = process.env.NEXT_PUBLIC_IOS_APP_STORE_URL
  || 'https://apps.apple.com/kr/app/%EB%8B%AC%EB%A6%AC%EB%8A%94-%EC%8A%B5%EA%B4%80-%EB%A3%A8%ED%8B%B0%EB%8B%88%EC%8A%A4%ED%8A%B8/id6762175125';
// Android 스토어는 env 없으면 버튼/redirect 모두 생략 (iOS URL 로 보내는 회귀 금지).
const ANDROID_STORE_URL = process.env.NEXT_PUBLIC_ANDROID_PLAY_STORE_URL || null;

function InviteLanding() {
  const { locale } = useI18n();
  const en = locale === 'en';
  const searchParams = useSearchParams();
  const code = (searchParams.get('code') || '').trim().toUpperCase();

  // /r/[id] 의 딥링크 패턴 재사용 — hidden iframe 시도 후 페이지가 살아 있으면 스토어로.
  const openInApp = () => {
    const deepLink = code
      ? `routinist://invite?code=${encodeURIComponent(code)}`
      : 'routinist://invite';
    const ua = navigator.userAgent || '';
    const isAndroid = /Android/i.test(ua);
    let leftPage = false;
    const markLeft = () => { leftPage = true; };
    document.addEventListener('visibilitychange', markLeft);
    window.addEventListener('pagehide', markLeft);
    window.addEventListener('blur', markLeft);
    try {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = deepLink;
      document.body.appendChild(iframe);
    } catch { /* iframe 차단 웹뷰 — timeout fallback 만 */ }
    setTimeout(() => {
      document.removeEventListener('visibilitychange', markLeft);
      window.removeEventListener('pagehide', markLeft);
      window.removeEventListener('blur', markLeft);
      if (leftPage || document.hidden) return;
      const fallback = isAndroid ? ANDROID_STORE_URL : IOS_STORE_URL;
      if (fallback) window.location.href = fallback;
    }, 1600);
  };

  const webSignupHref = code ? `/login?ref=${encodeURIComponent(code)}` : '/login';

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50 flex items-center justify-center p-5">
      <div className="w-full max-w-md text-center">
        <div className="flex justify-center">
          <AppLogo size={80} />
        </div>
        <h1 className="mt-5 text-2xl font-extrabold text-emerald-950">
          {en ? "You're invited to Routinist! 🎉" : 'Routinist 에 초대됐어요! 🎉'}
        </h1>
        <p className="mt-2 text-sm text-emerald-800 leading-relaxed">
          {en
            ? 'Sign up with this code and you both get 100P. Run your routine together!'
            : '이 코드로 가입하면 친구와 나 모두 100P 를 받아요. 함께 루틴을 달려봐요!'}
        </p>

        {code && (
          <div className="mt-6 mx-auto max-w-xs rounded-2xl bg-white border-2 border-emerald-200 shadow-lg shadow-emerald-100/60 px-6 py-5">
            <p className="text-[13px] font-bold text-emerald-600 uppercase tracking-wide">
              {en ? 'Invite code' : '초대 코드'}
            </p>
            <p className="mt-1 text-4xl font-extrabold text-emerald-700 tracking-[0.3em]">{code}</p>
          </div>
        )}

        <div className="mt-7 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={openInApp}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-[15px] font-extrabold shadow-lg shadow-emerald-500/30 active:scale-[0.98] transition"
          >
            {en ? 'Sign up in the app' : '앱에서 가입하기'}
          </button>
          <Link
            href={webSignupHref}
            className="w-full py-3 rounded-2xl bg-white border-[1.5px] border-emerald-200 text-emerald-800 text-sm font-bold active:scale-[0.98] transition"
          >
            {en ? 'Sign up on the web' : '웹으로 가입하기'}
          </Link>
          <a
            href={IOS_STORE_URL}
            className="w-full py-3 rounded-2xl text-emerald-600 text-[13px] font-bold"
          >
            {en ? 'Install iOS app' : 'iOS 앱 설치'}
          </a>
          {ANDROID_STORE_URL && (
            <a
              href={ANDROID_STORE_URL}
              className="w-full py-3 rounded-2xl text-emerald-600 text-[13px] font-bold"
            >
              {en ? 'Install Android app' : 'Android 앱 설치'}
            </a>
          )}
        </div>

        <p className="mt-8 text-[13px] text-gray-500">#Routinist · Run Your Routine.</p>
      </div>
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50" />}>
      <InviteLanding />
    </Suspense>
  );
}
