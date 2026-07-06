import type { NextConfig } from "next";

const isCapacitor = process.env.BUILD_TARGET === 'capacitor';

const nextConfig: NextConfig = {
  // Capacitor 빌드 시에만 정적 export
  ...(isCapacitor ? { output: "export" } : {}),
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
  // build 292: trailingSlash 의 308 redirect 가 /api/* 를 죽이던 문제의 근본 fix.
  // Vercel cron / Toss webhook / 외부 POST 는 redirect 를 안 따라가서 6/7~7/6 한 달간
  // cron 8종 전면 중단됐었다 (vercel.json 경로에 slash 를 붙여도 Vercel cron 미발사).
  //
  // ⚠️ build 295 회귀 교훈: 이 옵션을 Capacitor 정적 export 에도 켜면 클라이언트 라우터의
  // /login → /login/ 정규화까지 꺼져서 RSC fetch 실패 → browser navigation → 정적 파일
  // (login/index.html) 미발견 → 무한 리로드 (v1.2.7 build 294 흰/검 번쩍임 사고).
  // 반드시 서버 (Vercel) 빌드에서만 켠다.
  ...(isCapacitor ? {} : { skipTrailingSlashRedirect: true }),
};

export default nextConfig;
