import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.routinist.app',
  appName: 'Routinist',
  webDir: 'out',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    // Cafe24 쇼핑몰 iframe + 한국 PG 결제 팝업 허용
    allowNavigation: [
      '*.cafe24.com',
      'routinist.cafe24.com',
      'routinist.kr',
      '*.routinist.kr',
      '*.inicis.com',
      '*.nicepay.co.kr',
      '*.kakaopay.com',
      '*.tosspayments.com',
      '*.naverpay.com',
      '*.kftc-bokr.org',
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
