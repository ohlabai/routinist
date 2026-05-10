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
      'routinist.cafe24.com',
      'shop.cafe24.com',
      'pay.cafe24.com',
      'routinist.kr',
      'www.routinist.kr',
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
      // 토스페이먼츠
      'tosspayments.com',
      'pay.tosspayments.com',
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
      backgroundColor: '#ffffff',
    },
    SocialLogin: {
      // Apple·Google 만 사용. Facebook·Twitter 는 번들 제외해 앱 크기 절감.
      providers: {
        google: true,
        apple: true,
        facebook: false,
        twitter: false,
      },
      logLevel: 1,
    },
  },
};

export default config;
