'use client';

// 자동 페이지뷰 트래커 (build 115).
// app/(app)/layout 에 마운트. usePathname 변경 시 page_view 이벤트 push.

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { trackPageView, attachAnalyticsLifecycle } from '@/lib/analytics';

export default function AnalyticsAutoTracker() {
  const pathname = usePathname();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    attachAnalyticsLifecycle();
  }, []);

  useEffect(() => {
    if (!pathname) return;
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    // pathname 만 — query/hash 는 분석 시 노이즈
    trackPageView(pathname);
  }, [pathname]);

  return null;
}
