// 공유 랜딩 페이지 (build 136 — 사용자 피드백 #10).
// 카톡/인스타에 https://routinist.kr/r/{activity_id} 가 떨어지면 OG 카드 + 앱 진입 유도.
//
// 흐름:
//  1. Vercel SSR 에서 OG 메타 (title/description/image) 렌더 → Kakao 등 크롤러가 미리보기 카드 생성
//  2. 사용자 탭 → 앱 deep link 시도 → 1.5s 안에 visibility 안 바뀌면 store URL 로 폴백
//
// 정적 export 모드(Capacitor) 에서는 [id] 동적 라우트가 불가하지만 — 이 페이지는 Vercel 웹 전용.
// Capacitor 빌드는 production routinist.kr 도메인을 호출하지 않으므로 영향 없음.

import type { Metadata } from 'next';
import Link from 'next/link';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const url = `https://routinist.kr/r/${id}`;
  const title = '러닝 기록 공유 · Routinist';
  const description = '오늘의 한 줄 일기와 함께한 러닝. Routinist 에서 더 많은 러너의 기록을 만나보세요.';
  const ogImage = 'https://routinist.kr/apple-touch-icon.png';
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
    metadataBase: new URL('https://routinist.kr'),
  };
}

// 정적 export 빌드(Capacitor) 와 호환되도록 ID 별 페이지가 아닌 force-dynamic SSR. Vercel 만 동작.
export const dynamic = 'force-dynamic';

export default async function ShareLandingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deepLink = `routinist://activity?id=${id}`;
  const webFallback = `/activity?id=${id}`;
  // 환경변수로 store URL 관리 — App Store 승인 후 실제 ID 로 갱신 (rebuild 없이 Vercel env 만 변경).
  const iosStoreUrl = process.env.NEXT_PUBLIC_IOS_APP_STORE_URL
    || 'https://apps.apple.com/kr/app/routinist';
  const androidStoreUrl = process.env.NEXT_PUBLIC_ANDROID_PLAY_STORE_URL
    || 'https://play.google.com/store/apps/details?id=com.routinist.app';

  return (
    <div style={{ minHeight: '100vh', background: '#ecfdf5', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      {/* 클라이언트 분기 — 페이지 진입 즉시 deep link 시도, 안 열리면 store. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function () {
              var ua = navigator.userAgent || '';
              var isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
              var isAndroid = /Android/i.test(ua);
              if (!isIOS && !isAndroid) return;
              var openedAt = Date.now();
              var fallbackTimer = setTimeout(function () {
                if (Date.now() - openedAt < 2500 && document.visibilityState === 'visible') {
                  window.location.href = isIOS ? ${JSON.stringify(iosStoreUrl)} : ${JSON.stringify(androidStoreUrl)};
                }
              }, 1500);
              document.addEventListener('visibilitychange', function () {
                if (document.visibilityState === 'hidden') clearTimeout(fallbackTimer);
              });
              window.location.href = ${JSON.stringify(deepLink)};
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
