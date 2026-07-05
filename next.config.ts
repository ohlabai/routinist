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
  // 이 옵션은 runtime redirect 만 끄므로 (양쪽 경로 모두 핸들러 도달) Capacitor 정적
  // export 의 폴더/index.html 레이아웃에는 영향 없음.
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
