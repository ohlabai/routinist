'use client';

// 2026-07-18 (hans): 알림 발견성 — 앱 아이콘 배지("알림 1")를 보고 앱을 열면 홈에 떨어지는데,
// 알림 진입점(종)이 소셜 페이지에만 있어 "알림이 어디 있는지" 찾아 헤매는 문제.
// 소셜 페이지의 종+빨간 카운트 배지를 공용 컴포넌트로 추출해 홈 헤더에도 배치 —
// 아이콘 배지 → 앱 열기 → 홈 우상단 종에 같은 숫자가 바로 보이는 동선.
// (소셜 탭 하단 빨간 점은 7/15 사용자 결정으로 제거 — 재도입하지 않음)

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { fetchUnreadNotificationSummary, BADGE_REFRESH_EVENT } from '@/lib/notifications-data';

function BellBadge() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let mounted = true;
    const load = () => fetchUnreadNotificationSummary().then(s => { if (mounted) setCount(s.total); }).catch(() => {});
    void load();
    // 2026-07-15 리뷰 fix 계승: mount 1회만으론 백그라운드 복귀 중 도착한 알림이 반영 안 됨.
    const onVis = () => { if (!document.hidden) void load(); };
    window.addEventListener(BADGE_REFRESH_EVENT, load);
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      mounted = false;
      window.removeEventListener(BADGE_REFRESH_EVENT, load);
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  if (count <= 0) return null;
  return (
    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[12px] font-extrabold flex items-center justify-center leading-none shadow-md shadow-rose-500/30 tabular-nums">
      {count > 99 ? '99+' : count}
    </span>
  );
}

/** 헤더용 알림 종 아이콘 + unread 빨간 카운트 배지. /notifications 로 이동. */
export default function NotificationBell() {
  return (
    <Link
      href="/notifications"
      aria-label="Notifications"
      className="relative w-10 h-10 rounded-full flex items-center justify-center hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90"
    >
      <Bell size={20} strokeWidth={1.8} />
      <BellBadge />
    </Link>
  );
}
