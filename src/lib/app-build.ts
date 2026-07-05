// 앱 빌드 번호 단일 소스 — push 토큰 진단(push-notifications)·ErrorBoundary 로그에 찍힘.
// 이전엔 두 파일에 '99' 하드코딩 + "매 빌드 갱신" 주석만 있어 build 99 이후 한 번도 안 올라감
// (진단 데이터 오염 — 리뷰 P2). 여기 한 곳만 빌드 bump 때 같이 올리면 된다.
// (CURRENT_PROJECT_VERSION 과 맞출 것 — ios/App/App.xcodeproj)
export const APP_BUILD = '291';
