// 공유 랜딩 페이지 (build 136 → 141 도메인 fix → 292 동적 OG).
// 카톡/인스타에 https://app.routinist.kr/r/{activity_id} 가 떨어지면 OG 카드 + 앱 진입 유도.
// build 141: 도메인을 app.routinist.kr 로 (routinist.kr 는 cafe24 mall — 잘못된 도메인 회귀 fix).
// build 141: force-dynamic 제거 → Next.js 16 의 기본 dynamic params SSR 로 (Vercel 404 회귀 fix).
// build 292: OG 를 활동 데이터로 동적 생성 — anon supabase 로 public 활동 조회
//   (activities RLS 가 visibility='public' anon 읽기 허용). 활동 없으면 기존 정적 fallback.
//
// 흐름:
//  1. Vercel SSR 에서 OG 메타 (title/description/image) 렌더 → Kakao 등 크롤러가 미리보기 카드 생성
//  2. 사용자 탭 → 앱 deep link 시도. 앱 미설치는 페이지 buttons UI 로
//
// 정적 export 모드(Capacitor) 에서는 [id] 동적 라우트가 불가하지만 — 이 페이지는 Vercel 웹 전용.
// build-ios.mjs 가 Capacitor 빌드 시 /r 디렉토리를 임시 격리.

import type { Metadata } from 'next';
import Link from 'next/link';
import { cache } from 'react';
import { createClient } from '@supabase/supabase-js';

const APP_DOMAIN = 'https://app.routinist.kr';

interface SharedActivity {
  activity_date: string;
  distance_km: number;
  pace_avg_sec_per_km: number | null;
  map_snapshot_url: string | null;
  display_name: string | null;
}

// generateMetadata + 페이지 본문이 같은 데이터를 쓰므로 React cache() 로 요청당 1회만 fetch.
const fetchSharedActivity = cache(async (id: string): Promise<SharedActivity | null> => {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return null;
    // 서버 컴포넌트 — 세션 없는 순수 anon 클라이언트 (RLS: public 활동만 보임).
    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: activity } = await supabase
      .from('activities')
      .select('user_id, activity_date, distance_km, pace_avg_sec_per_km, map_snapshot_url')
      .eq('id', id)
      .maybeSingle();
    if (!activity) return null;
    // 닉네임 — profiles RLS 는 is_public=true 행 anon 읽기 허용. 실패해도 활동 정보는 노출.
    const { data: prof } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', activity.user_id)
      .maybeSingle();
    return {
      activity_date: activity.activity_date,
      distance_km: Number(activity.distance_km),
      pace_avg_sec_per_km: activity.pace_avg_sec_per_km,
      map_snapshot_url: activity.map_snapshot_url,
      display_name: prof?.display_name ?? null,
    };
  } catch {
    // 잘못된 id (uuid 아님) / 네트워크 실패 등 — 정적 fallback 으로.
    return null;
  }
});

function formatKm(km: number): string {
  const rounded = Math.round(km * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}'${String(s).padStart(2, '0')}"`;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const url = `${APP_DOMAIN}/r/${id}`;
  const activity = await fetchSharedActivity(id);

  // 활동 조회 실패 시 기존 정적 fallback 유지.
  let title = '러닝 기록 공유 · Routinist';
  let description = '오늘의 한 줄 일기와 함께한 러닝. Routinist 에서 더 많은 러너의 기록을 만나보세요.';
  let ogImage = `${APP_DOMAIN}/apple-touch-icon.png`;
  let imageSize: { width: number; height: number } | null = { width: 512, height: 512 };

  if (activity) {
    const runner = activity.display_name || 'Runner';
    title = `${runner} ran ${formatKm(activity.distance_km)}km · Routinist`;
    const pacePart = activity.pace_avg_sec_per_km
      ? ` · ${formatPace(activity.pace_avg_sec_per_km)}/km`
      : '';
    description = `${activity.activity_date}${pacePart} · 오늘의 한 줄 일기와 함께한 러닝. Routinist 에서 만나보세요.`;
    if (activity.map_snapshot_url) {
      ogImage = activity.map_snapshot_url;
      imageSize = null; // 스냅샷 크기는 가변 — 크롤러가 직접 읽게 둠
    }
  }

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: 'Routinist',
      images: [imageSize ? { url: ogImage, ...imageSize, alt: 'Routinist' } : { url: ogImage, alt: 'Routinist' }],
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
  const activity = await fetchSharedActivity(id);
  const deepLink = `routinist://activity?id=${id}`;
  const webFallback = `/activity?id=${id}`;
  // build 164 #5: App Store URL 하드코딩 fallback — 사용자 제공 URL (id6762175125).
  // 환경변수가 있으면 override (Vercel 에서 빠르게 변경 가능).
  const iosStoreUrl = process.env.NEXT_PUBLIC_IOS_APP_STORE_URL
    || 'https://apps.apple.com/kr/app/%EB%8B%AC%EB%A6%AC%EB%8A%94-%EC%8A%B5%EA%B4%80-%EB%A3%A8%ED%8B%B0%EB%8B%88%EC%8A%A4%ED%8A%B8/id6762175125';
  // build 292 fix: Android 스토어 URL 이 없으면 iOS URL 로 보내던 버그 — env 없으면 버튼 숨김 + redirect 안 함.
  const androidStoreUrl = process.env.NEXT_PUBLIC_ANDROID_PLAY_STORE_URL || null;

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
                if (!fallback) return; // Android 스토어 미등록 — 페이지에 머무름
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

        {/* build 292: 활동 미니 프리뷰 — 닉네임·거리·날짜 (public 활동만 조회됨) */}
        {activity && (
          <div style={{
            marginTop: 16, padding: '16px 18px', borderRadius: 18,
            background: 'white', border: '1.5px solid #d1fae5',
            boxShadow: '0 4px 18px rgba(16,185,129,0.12)',
          }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#065f46' }}>
              {activity.display_name || 'Runner'}
            </p>
            <p style={{ marginTop: 4, fontSize: 32, fontWeight: 800, color: '#059669', lineHeight: 1.1 }}>
              {formatKm(activity.distance_km)}<span style={{ fontSize: 16, fontWeight: 700 }}> km</span>
            </p>
            <p style={{ marginTop: 6, fontSize: 12, color: '#6b7280' }}>
              {activity.activity_date}
              {activity.pace_avg_sec_per_km ? ` · ${formatPace(activity.pace_avg_sec_per_km)}/km` : ''}
            </p>
          </div>
        )}

        <p style={{ marginTop: 12, fontSize: 14, color: '#065f46', lineHeight: 1.5 }}>
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
          {androidStoreUrl && (
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
          )}
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
