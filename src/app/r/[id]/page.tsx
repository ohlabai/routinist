// 공유 랜딩 페이지 (build 136 → 141 도메인 fix).
// 카톡/인스타에 https://app.routinist.kr/r/{activity_id} 가 떨어지면 OG 카드 + 앱 진입 유도.
// build 141: 도메인을 app.routinist.kr 로 (routinist.kr 는 cafe24 mall — 잘못된 도메인 회귀 fix).
// build 141: force-dynamic 제거 → Next.js 16 의 기본 dynamic params SSR 로 (Vercel 404 회귀 fix).
//
// 흐름:
//  1. Vercel SSR 에서 OG 메타 (title/description/image) 렌더 → Kakao 등 크롤러가 미리보기 카드 생성
//  2. 사용자 탭 → 앱 deep link 시도. 앱 미설치는 페이지 buttons UI 로
//
// 정적 export 모드(Capacitor) 에서는 [id] 동적 라우트가 불가하지만 — 이 페이지는 Vercel 웹 전용.
// build-ios.mjs 가 Capacitor 빌드 시 /r 디렉토리를 임시 격리.

import type { Metadata } from 'next';
import Link from 'next/link';

const APP_DOMAIN = 'https://app.routinist.kr';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const url = `${APP_DOMAIN}/r/${id}`;
  const title = '러닝 기록 공유 · Routinist';
  const description = '오늘의 한 줄 일기와 함께한 러닝. Routinist 에서 더 많은 러너의 기록을 만나보세요.';
  const ogImage = `${APP_DOMAIN}/apple-touch-icon.png`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: 'Routinist',
      images: [{ url: ogImage, width: 512, height: 512, alt: 'Routinist' }],
      locale: 'ko_KR',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
    },
    metadataBase: new URL(APP_DOMAIN),
  };
}

// build 141: force-dynamic 제거 — Vercel 빌드에서 /r/[id] 가 누락되는 회귀 회피.
// dynamic params 만으로 Next.js 16 이 알아서 dynamic SSR (캐시 가능).
export const dynamicParams = true;

export default async function ShareLandingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deepLink = `routinist://activity?id=${id}`;
  const webFallback = `/activity?id=${id}`;
  // build 164 #5: App Store URL 하드코딩 fallback — 사용자 제공 URL (id6762175125).
  // 환경변수가 있으면 override (Vercel 에서 빠르게 변경 가능).
  const iosStoreUrl = process.env.NEXT_PUBLIC_IOS_APP_STORE_URL
    || 'https://apps.apple.com/kr/app/%EB%8B%AC%EB%A6%AC%EB%8A%94-%EC%8A%B5%EA%B4%80-%EB%A3%A8%ED%8B%B0%EB%8B%88%EC%8A%A4%ED%8A%B8/id6762175125';
  const androidStoreUrl = process.env.NEXT_PUBLIC_ANDROID_PLAY_STORE_URL
    || iosStoreUrl;

  return (
    <div style={{ minHeight: '100vh', background: '#ecfdf5', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      {/* build 164 #5: 표준 deep-link 패턴으로 자동 진입.
            1) hidden iframe 으로 routinist:// 시도 (메인 페이지 navigation 없음 — 깜빡임 제거)
            2) 1.6초 후에도 페이지가 살아 있으면 (visibilitychange 미발생) 앱 미설치로 판단 → App Store 로 redirect
          KakaoTalk in-app 웹뷰는 보통 iframe scheme 을 그대로 OS 로 전달 — 앱 있으면 진입, 없으면 page 그대로.
          window.location.href 직접 변경 방식은 KakaoTalk 에서 검정/흰 깜빡임 회귀가 있었음. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function () {
              var ua = navigator.userAgent || '';
              var isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
              var isAndroid = /Android/i.test(ua);
              if (!isIOS && !isAndroid) return;
              var deepLink = ${JSON.stringify(deepLink)};
              var storeUrl = ${JSON.stringify(iosStoreUrl)};
              var androidStore = ${JSON.stringify(androidStoreUrl)};
              var fallback = isAndroid ? androidStore : storeUrl;
              var leftPage = false;
              function markLeft() { leftPage = true; }
              document.addEventListener('visibilitychange', markLeft);
              window.addEventListener('pagehide', markLeft);
              window.addEventListener('blur', markLeft);
              try {
                var iframe = document.createElement('iframe');
                iframe.style.display = 'none';
                iframe.src = deepLink;
                document.body.appendChild(iframe);
              } catch (e) {}
              setTimeout(function () {
                if (leftPage || document.hidden) return;
                window.location.replace(fallback);
              }, 1600);
            })();
          `,
        }}
      />
      <div style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/apple-touch-icon.png" alt="Routinist" width={88} height={88} style={{ borderRadius: 22, boxShadow: '0 6px 30px rgba(16,185,129,0.25)' }} />
        <h1 style={{ marginTop: 18, fontSize: 22, fontWeight: 800, color: '#064e3b' }}>러닝 기록 공유</h1>
        <p style={{ marginTop: 8, fontSize: 14, color: '#065f46', lineHeight: 1.5 }}>
          Routinist 앱에서 이 기록과 한 줄 일기를 만나보세요.<br />앱이 없으면 자동으로 설치 페이지로 안내합니다.
        </p>

        <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <a
            href={deepLink}
            style={{
              display: 'inline-block', padding: '14px 18px', borderRadius: 14,
              background: 'linear-gradient(135deg, #10b981, #059669)',
              color: 'white', fontWeight: 800, textDecoration: 'none', fontSize: 15,
              boxShadow: '0 4px 14px rgba(16,185,129,0.3)',
            }}
          >
            앱에서 열기
          </a>
          <a
            href={iosStoreUrl}
            style={{
              display: 'inline-block', padding: '12px 18px', borderRadius: 14,
              background: 'white', color: '#065f46', fontWeight: 700, textDecoration: 'none', fontSize: 14,
              border: '1.5px solid #d1fae5',
            }}
          >
            iOS 앱 설치
          </a>
          <a
            href={androidStoreUrl}
            style={{
              display: 'inline-block', padding: '12px 18px', borderRadius: 14,
              background: 'white', color: '#065f46', fontWeight: 700, textDecoration: 'none', fontSize: 14,
              border: '1.5px solid #d1fae5',
            }}
          >
            Android 앱 설치
          </a>
          <Link
            href={webFallback}
            style={{
              display: 'inline-block', padding: '10px 18px', borderRadius: 14,
              color: '#10b981', fontWeight: 700, textDecoration: 'none', fontSize: 13,
            }}
          >
            웹으로 보기 →
          </Link>
        </div>

        <p style={{ marginTop: 28, fontSize: 11, color: '#6b7280' }}>#Routinist · Run Your Routine.</p>
      </div>
    </div>
  );
}
