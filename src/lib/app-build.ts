// 앱 빌드 번호 단일 소스 — push 토큰 진단(push-notifications)·ErrorBoundary 로그에 찍힘.
//
// 이력: 원래 두 파일에 '99' 하드코딩 + "매 빌드 갱신" 주석만 있어 build 99 이후 한 번도 안 올라갔다.
// 그래서 이 파일로 모았는데, **여기서도 똑같이 굳었다** ('304' 로 박힌 채 build 360 까지 옴 —
// 2026-08-16 발견). 사람이 기억해서 올리는 방식은 두 번 다 실패했다.
//
// → 이제 손으로 올리지 않는다. scripts/build-ios.mjs 가 pbxproj 의 CURRENT_PROJECT_VERSION 을
//   읽어 NEXT_PUBLIC_APP_VERSION 으로 주입하므로 그걸 그대로 쓴다 (data-cache·error-logger 와 동일 소스).
//   주입이 없는 환경(Vercel 웹, 안드로이드 `npm run build`)은 'dev' — 틀린 숫자보다 낫다.
//   안드로이드도 정확한 값을 남기려면 빌드 시 NEXT_PUBLIC_APP_VERSION=<versionCode> 를 넘길 것.
export const APP_BUILD = process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev';
