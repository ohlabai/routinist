'use client';

import { useAuth } from '@/components/AuthProvider';
import { UserDataProvider } from '@/components/UserDataProvider';
import { useRouter, usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Home, Trophy, User, ShoppingBag, Users } from 'lucide-react';
import { syncHealthData, isNativeApp } from '@/lib/health-sync';
import AppLogo from '@/components/AppLogo';
import { useI18n, getCurrentLocale } from '@/lib/i18n';
import { getSupabase } from '@/lib/supabase';
import AnalyticsAutoTracker from '@/components/AnalyticsAutoTracker';
import { fetchUnreadNotificationSummary, markNotificationsRead, SOCIAL_KINDS } from '@/lib/notifications-data';
import { setAppBadge } from '@/lib/app-badge';
import { getUnreadCount as getUnreadMessageCount } from '@/lib/message-data';

// 5탭 구조 (build 100 재편): 홈 / 랭킹 / 소셜 / 쇼핑 / 내정보.
// 지도는 홈 캘린더 아래 미니맵으로 흡수. 랭킹 ↔ 소셜 분리 (이전 /social 의 me, mileage 서브탭이 랭킹으로 이전).
const TABS_BASE: {
  href: string;
  labelKey: 'nav.home' | 'nav.ranking' | 'nav.social' | 'nav.shop' | 'nav.profile';
  Icon: typeof Home;
  activeFor?: string[];
}[] = [
  { href: '/dashboard', labelKey: 'nav.home', Icon: Home, activeFor: ['/map'] },
  { href: '/ranking', labelKey: 'nav.ranking', Icon: Trophy },
  { href: '/social', labelKey: 'nav.social', Icon: Users },
  { href: '/shop', labelKey: 'nav.shop', Icon: ShoppingBag },
  {
    href: '/profile',
    labelKey: 'nav.profile',
    Icon: User,
    activeFor: ['/messages', '/mileage', '/goals', '/connect', '/awards', '/support', '/privacy'],
  },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  // iOS Capacitor 환경에서 pathname 이 '/shop' / '/shop/' / '/shop/index.html' 등으로 변할 수 있어
  // 단순 `=== '/shop'` 비교가 미스매치하는 케이스 방어. startsWith + endsWith 같이.
  // build 74: trailing slash / query 차이를 정규화. iOS Capacitor 환경에서 pathname 변형
  // ('/shop/' / '/shop?...' / '/shop/index.html' 등) 모두 동일하게 매칭.
  const normalizedPath = pathname.replace(/\?.*$/, '').replace(/\/+$/, '') || '/';
  const isShop = normalizedPath === '/shop' || normalizedPath.startsWith('/shop/');
  // 게스트 진입 허용 — 고객지원/약관 등 정보성 페이지. (app) 내부에 있지만 로그인 강제 안 함.
  // (Apple App Review 가 미로그인 상태에서 우연히 진입할 가능성 — 무반응처럼 보임 방지.)
  const isGuestAllowed = isShop ||
    normalizedPath === '/support' ||
    normalizedPath === '/privacy' ||
    normalizedPath === '/terms';
  const isChat = normalizedPath === '/messages/chat' || normalizedPath.startsWith('/messages/chat/');
  // 메인 탭 5개 중 자체 sticky header 를 가진 페이지들 — layout 공통 헤더 중복 회피 (사용자 신고).
  // map 은 자체 헤더가 없어 layout 헤더 유지. dashboard/social/profile 은 본인 페이지의 sticky header 만 사용.
  const isHome = normalizedPath === '/dashboard';
  const isSocial = normalizedPath === '/social';
  const isProfile = normalizedPath === '/profile';
  const isRanking = normalizedPath === '/ranking';
  const isMap = normalizedPath === '/map';
  // build 209 #6: /track 도 자체 header (← 뒤로, 달리는 중, LIVE 배지) 가 있으므로 layout header 숨김.
  const isTrack = normalizedPath === '/track' || normalizedPath.startsWith('/track/');
  const hideLayoutHeader = isShop || isChat || isHome || isSocial || isProfile || isRanking || isMap || isTrack;
  const lastSyncRef = useRef<number>(0);
  const [loadingTimeout, setLoadingTimeout] = useState(false);

  // PAGE_TITLES 동적 (locale 따라 변경) — 한글 키는 i18n 미적용 페이지의 fallback
  const PAGE_TITLES: Record<string, string> = {
    '/dashboard': t('nav.home'),
    '/map': '지도',
    '/ranking': t('nav.ranking'),
    '/social': t('nav.social'),
    '/profile': t('nav.profile'),
    '/goals': '목표 설정',
    '/history': '히스토리',
    '/connect': '건강 앱 연동',
    '/calendar': '캘린더',
    '/shop': 'Routinist Store',
    '/messages': '쪽지함',
    '/mileage': '마일리지',
    '/support': '고객 지원',
    '/privacy': '개인정보처리방침',
  };

  useEffect(() => {
    if (!loading && !user) {
      // 쇼핑 + 정보성(고객지원/약관) 페이지는 비로그인 게스트 허용.
      // 그 외 (app) 페이지는 로그인 강제.
      if (!isGuestAllowed) {
        router.replace('/login');
      }
    }
  }, [user, loading, router, isGuestAllowed]);

  useEffect(() => {
    if (!loading) { setLoadingTimeout(false); return; }
    const t = setTimeout(() => setLoadingTimeout(true), 8000);
    return () => clearTimeout(t);
  }, [loading]);

  // build 261: 소셜 탭 unread 배지. 응원·댓글·팔로우 신규 카운트.
  // mount + 5분마다 + visibility 복귀 + window focus 시 갱신.
  // 소셜 탭 진입 시 자동 markRead → 배지 0 으로 즉시 사라짐.
  // build 262: 쪽지 unread 도 같이 fetch 해서 iOS 앱 아이콘 배지 합산 (소셜 + 쪽지).
  const [socialUnread, setSocialUnread] = useState(0);
  const [messageUnread, setMessageUnread] = useState(0);
  const refreshBadges = useCallback(async () => {
    if (!user) { setSocialUnread(0); setMessageUnread(0); void setAppBadge(0); return; }
    const [s, m] = await Promise.all([
      fetchUnreadNotificationSummary(),
      getUnreadMessageCount(user.id).catch(() => 0),
    ]);
    const social = s.total;
    setSocialUnread(social);
    setMessageUnread(m);
    void setAppBadge(social + m);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void refreshBadges();
    const interval = window.setInterval(() => { void refreshBadges(); }, 5 * 60 * 1000);
    const onVis = () => { if (!document.hidden) void refreshBadges(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', refreshBadges);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', refreshBadges);
    };
  }, [user, refreshBadges]);

  // 소셜 탭 진입 시 자동 markRead — pathname 이 /social 또는 그 하위 경로면 한 번 호출.
  useEffect(() => {
    if (!user) return;
    if (!normalizedPath.startsWith('/social')) return;
    // 비동기 시작 — 응답 받지 않고 즉시 0 으로 optimistic update.
    setSocialUnread(0);
    void setAppBadge(messageUnread); // 앱 아이콘 배지에서 social 분 제거 (쪽지만 남김)
    void markNotificationsRead(SOCIAL_KINDS);
  }, [user, normalizedPath, messageUnread]);

  // build 291: locale/timezone 을 profiles 에 동기화 — push 다국어·로컬 저녁 발송용.
  // 세션당 1회, 값이 바뀌었을 때만 UPDATE (fire-and-forget).
  useEffect(() => {
    if (!user) return;
    try {
      const locale = getCurrentLocale();
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
      const snapshot = `${locale}|${timezone}`;
      const key = `profile_locale_tz:${user.id}`;
      if (window.localStorage.getItem(key) === snapshot) return;
      void getSupabase()
        .from('profiles')
        .update({ locale, timezone })
        .eq('id', user.id)
        .then(({ error }) => {
          if (!error) window.localStorage.setItem(key, snapshot);
        });
    } catch {
      // Intl/localStorage 불가 환경 — 무시 (push 는 KST/ko 기본값으로 동작)
    }
  }, [user]);

  // 신문 모델 (build 57): 자동 sync 제거.
  // 첫 로그인 직후 1회만 환영 sync (localStorage flag), 이후엔 사용자가 직접 동기화 버튼을 눌러야 sync.
  // 이전엔 layout mount 마다 (=화면 이동마다) sync 가 발사 → SDK lock + 60s timeout 회귀의 근원.
  // build 142: 첫 paint 블로킹 회피 — 2초 defer 후 background 실행. timeout 25s → 60s 로 늘리되
  // 절대 화면 블로킹 안 함 (useEffect fire-and-forget).
  useEffect(() => {
    if (!user) return;
    if (!isNativeApp()) return;

    const flagKey = `first_sync_done:${user.id}`;
    if (typeof window === 'undefined') return;
    const alreadyDone = window.localStorage.getItem(flagKey);
    if (alreadyDone) return;

    // 첫 paint 이후로 defer (홈 hero 렌더 후 background 진입).
    const deferTimer = setTimeout(() => {
      (async () => {
        try {
          const now = Date.now();
          lastSyncRef.current = now;
          const r = await Promise.race([
            syncHealthData(user.id),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('first-sync timeout 60s')), 60000)
            ),
          ]);
          if (r.success) {
            window.localStorage.setItem(flagKey, String(Date.now()));
          }
        } catch (e) {
          console.warn('[layout] 첫 sync 예외 (재시도 가능):', e);
        }
      })();
    }, 2000);

    return () => clearTimeout(deferTimer);
  }, [user]);

  if (loading) {
    // 단일 로딩 화면 — iOS LaunchScreen 과 배경 톤 통일(밝은 민트/화이트).
    // 8초 이상 멈추면 "다시 시도" 버튼 제공 → OAuth 실패 시 무한 대기 방지.
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-emerald-50/40 gap-3 px-6">
        <div className="animate-[fadeInUp_0.4s_ease-out]">
          <AppLogo size={84} />
        </div>
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Routinist</h1>
        <p className="text-base font-semibold text-emerald-600">Run Your Routine!</p>
        {!loadingTimeout ? (
          <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full mt-2" />
        ) : (
          <div className="mt-3 flex flex-col items-center gap-2">
            <p className="text-sm text-slate-600">로그인이 지연되고 있어요</p>
            <button
              onClick={() => window.location.replace('/login')}
              className="px-5 py-2.5 rounded-xl bg-emerald-500 text-white text-base font-semibold shadow-sm"
            >
              다시 로그인하기
            </button>
          </div>
        )}
      </div>
    );
  }

  // 게스트 허용 페이지(/shop, /support, /privacy, /terms) — !user 여도 렌더.
  if (!user && !isGuestAllowed) return null;

  // h-[100dvh] + overflow-hidden 으로 flex 컨테이너를 뷰포트 높이에 고정.
  // 이전 min-h-screen 구조에서 iOS WebView 의 바운스/에러 상태 시 sticky bottom 탭바가
  // 스크롤에 밀려 올라가는 버그가 발생 — 내부 main 에서만 스크롤되도록 제한.
  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-[var(--background)]">
      {/* 헤더 — 자체 sticky header 가 없는 페이지에만 공통 헤더 렌더 (중복 방지) */}
      {!hideLayoutHeader && (
        <header className="flex-shrink-0 z-40 border-b border-[var(--card-border)] bg-[var(--header-bg)] backdrop-blur-xl pt-[env(safe-area-inset-top)]">
          <div className="px-4 h-14 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Link href="/dashboard"><AppLogo size={28} /></Link>
              <h1 className="text-xl font-bold tracking-tight text-[var(--foreground)]">
                {PAGE_TITLES[pathname] || Object.entries(PAGE_TITLES).find(([k]) => pathname.startsWith(k + '/'))?.[1] || 'Routinist'}
              </h1>
            </div>
          </div>
        </header>
      )}
      {/* 자체 헤더 페이지에선 status bar 영역만 padding (헤더 자리 비워둠) */}
      {hideLayoutHeader && (
        <div className="flex-shrink-0 bg-[var(--background)] pt-[env(safe-area-inset-top)]" />
      )}

      {/* 메인 컨텐츠 — 유일한 스크롤 영역 */}
      <main className="flex-1 overflow-y-auto overscroll-contain">
        <AnalyticsAutoTracker />
        <UserDataProvider>{children}</UserDataProvider>
      </main>

      {/* 하단 5탭 네비게이션 — flex-shrink-0 로 고정, sticky 제거.
          채팅 페이지에선 입력창이 가리는 문제로 nav 숨김 (사용자 신고 build 67). */}
      <nav className={`flex-shrink-0 z-40 border-t border-[var(--card-border)] bg-[var(--header-bg)] backdrop-blur-xl pb-[max(env(safe-area-inset-bottom),4px)] ${isChat || isTrack ? 'hidden' : ''}`}>
        <div className="flex justify-around items-center h-14">
          {TABS_BASE.map((tab) => {
            const isActive =
              pathname === tab.href ||
              pathname.startsWith(tab.href + '/') ||
              (tab.activeFor?.some(p => pathname === p || pathname.startsWith(p + '/')) ?? false);
            // build 261: 소셜 탭에만 unread 배지. 응원·댓글·팔로우 신규.
            const badgeCount = tab.href === '/social' ? socialUnread : 0;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-2xl transition-all duration-200 ${
                  isActive
                    ? 'text-[var(--accent)] bg-[var(--accent)]/10'
                    : 'text-[var(--muted)]'
                }`}
              >
                <div className="relative">
                  <tab.Icon size={isActive ? 24 : 22} strokeWidth={isActive ? 2.5 : 1.75} />
                  {badgeCount > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-extrabold flex items-center justify-center leading-none shadow-md shadow-rose-500/30 tabular-nums">
                      {badgeCount > 99 ? '99+' : badgeCount}
                    </span>
                  )}
                </div>
                <span className={`text-[13px] ${isActive ? 'font-bold' : 'font-medium'}`}>{t(tab.labelKey)}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
