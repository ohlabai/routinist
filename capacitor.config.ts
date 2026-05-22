import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.routinist.app',
  appName: 'Routinist',
  webDir: 'out',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    // Cafe24 쇼핑몰 iframe + 한국 PG 결제 팝업 허용.
    // 와일드카드(*) 는 서브도메인 스푸핑(예: evil.cafe24.com) 위험이 있어 명시 호스트로 한정.
    // 결제사 도메인은 PG 사가 사용하는 공식 호스트만. 새 결제 도메인 추가 시 여기에 명시할 것.
    allowNavigation: [
      // Cafe24 쇼핑몰 (Routinist 스토어)
      // routinist.kr = cafe24 외부 쇼핑몰. app.routinist.kr = 우리 네이티브 앱.
      // 두 도메인 모두 네비게이션 허용 (앱에서 외부 cafe24 mall 도 열 수 있도록).
      'routinist.cafe24.com',
      'shop.cafe24.com',
      'pay.cafe24.com',
      'routinist.kr',
      'www.routinist.kr',
      'app.routinist.kr',
      // 이니시스
      'inicis.com',
      'mobile.inicis.com',
      'stdpay.inicis.com',
      'wallet.inicis.com',
      // 나이스페이
      'nicepay.co.kr',
      'pay.nicepay.co.kr',
      'web.nicepay.co.kr',
      // 카카오페이
      'kakaopay.com',
      'mockup-pg-web.kakaopay.com',
      'pg-web.kakaopay.com',
      // 토스페이먼츠 — build 183: payment-gateway / js / api 서브도메인 누락 fix.
      // requestPayment() 호출 시 window.location 이 payment-gateway.tosspayments.com 로
      // 이동하는데 거기 미등록이면 Capacitor 가 외부 Safari 로 열어 흐름 끊김.
      'tosspayments.com',
      'pay.tosspayments.com',
      'payment-gateway.tosspayments.com',
      'js.tosspayments.com',
      'api.tosspayments.com',
      'event.tosspayments.com',
      // KCP / 카드사 안심클릭 인증 페이지
      'kcp.co.kr',
      'pay.kcp.co.kr',
      'spay.kcp.co.kr',
      // 네이버페이
      'naverpay.com',
      'mbrowser.pay.naver.com',
      // 금결원
      'kftc-bokr.org',
      'pay.kftc-bokr.org',
    ],
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      showSpinner: false,
      backgroundColor: '#ecfdf5',
    },
    SocialLogin: {
      // Apple·Google 만 사용. Facebook·Twitter 는 번들 제외해 앱 크기 절감.
      providers: {
        google: true,
        apple: true,
        facebook: false,
        twitter: false,
      },
      logLevel: 0,
    },
  },
};

export default config;
