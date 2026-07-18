'use client';

import { useAuth } from '@/components/AuthProvider';
import { UserDataProvider } from '@/components/UserDataProvider';
import { useRouter, usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Home, Trophy, User, Users, Play } from 'lucide-react';
import { syncHealthData, isNativeApp } from '@/lib/health-sync';
import AppLogo from '@/components/AppLogo';
import { useI18n, getCurrentLocale } from '@/lib/i18n';
import { getSupabase } from '@/lib/supabase';
import AnalyticsAutoTracker from '@/components/AnalyticsAutoTracker';
import ActiveRunBanner from '@/components/track/ActiveRunBanner';
import { fetchUnreadNotificationSummary, BADGE_REFRESH_EVENT } from '@/lib/notifications-data';
import { setAppBadge } from '@/lib/app-badge';
import { getUnreadCount as getUnreadMessageCount } from '@/lib/message-data';
import AppToast from '@/components/AppToast';
import WelcomeSyncSheet from '@/components/WelcomeSyncSheet';

// 4탭 구조 (단순화 B 트랙, 2026-07-11): 홈 / 랭킹 / 소셜 / 내정보.
// 쇼핑 탭 강등 — /shop/** 라우트는 전부 유지, 진입점은 /profile 액션 그리드로 이동.
// 쇼핑 안에 있을 때는 내정보 탭 활성 (activeFor '/shop').
const TABS_BASE: {
  href: string;
  labelKey: 'nav.home' | 'nav.ranking' | 'nav.social' | 'nav.profile';
  Icon: typeof Home;
  activeFor?: string[];
}[] = [
  { href: '/dashboard', labelKey: 'nav.home', Icon: Home, activeFor: ['/map'] },
  { href: '/ranking', labelKey: 'nav.ranking', Icon: Trophy },
  { href: '/social', labelKey: 'nav.social', Icon: Users },
  {
    href: '/profile',
    labelKey: 'nav.profile',
    Icon: User,
    activeFor: ['/shop', '/messages', '/mileage', '/goals', '/connect', '/awards', '/support', '/privacy'],
  },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { t, tt } = useI18n();
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
  // build 293: /activity 도 게스트 허용 — /r/{id} 공유 랜딩의 "웹으로 보기" → /activity?id= 가
  // 로그인 벽 없이 read-only 로 열리게 (RLS 가 visibility=public 활동 anon 읽기 허용).
  // 페이지 내부에서 비로그인 시 댓글/응원/공유 숨김 + 가입 CTA (activity/page.tsx).
  const isGuestAllowed = isShop ||
    normalizedPath === '/support' ||
    normalizedPath === '/privacy' ||
    normalizedPath === '/terms' ||
    normalizedPath === '/activity';
  const isChat = normalizedPath === '/messages/chat' || normalizedPath.startsWith('/messages/chat/');
  // 메인 탭 4개 중 자체 sticky header 를 가진 페이지들 — layout 공통 헤더 중복 회피 (사용자 신고).
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
  const [messageUnread, setMessageUnread] = useState(0);
  const refreshBadges = useCallback(async () => {
    if (!user) { setMessageUnread(0); void setAppBadge(0); return; }
    const [s, m] = await Promise.all([
      fetchUnreadNotificationSummary(),
      getUnreadMessageCount(user.id).catch(() => 0),
    ]);
    setMessageUnread(m);
    void setAppBadge(s.total + m);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void refreshBadges();
    const interval = window.setInterval(() => { void refreshBadges(); }, 5 * 60 * 1000);
    const onVis = () => { if (!document.hidden) void refreshBadges(); };
    const onBadgeEvent = () => { void refreshBadges(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', refreshBadges);
    // build 298: 알림함에서 읽음 처리 직후 SPA 내 즉시 갱신 (focus/5분 주기로는 못 잡음)
    window.addEventListener(BADGE_REFRESH_EVENT, onBadgeEvent);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', refreshBadges);
      window.removeEventListener(BADGE_REFRESH_EVENT, onBadgeEvent);
    };
  }, [user, refreshBadges]);

  // build 298: /social 진입 시 자동 markRead 제거 (2026-07-11 피드백 — 아이콘 배지 숫자를 보고
  // 들어와도 어디서 알림이 떴는지 확인하기 전에 배지가 사라졌음). 이제 읽음 처리는
  // /notifications 에서 항목 탭(개별) 또는 "모두 읽음" 버튼으로만 일어난다.

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

  // build 292: /login?ref=CODE 또는 초대 딥링크가 저장한 pending 초대 코드 — 로그인 후 1회 자동 claim.
  // 결과 무관 키 삭제 (claimPendingReferral 내부). 성공 시에만 토스트, 실패는 조용히 (RPC 미배포 안전).
  const pendingRefTriedRef = useRef(false);
  const [referralToast, setReferralToast] = useState<string | null>(null);
  useEffect(() => {
    if (!user || pendingRefTriedRef.current) return;
    pendingRefTriedRef.current = true;
    import('@/lib/referral-data')
      .then(async ({ claimPendingReferral, claimSuccessMessage }) => {
        const ok = await claimPendingReferral();
        if (ok) setReferralToast(claimSuccessMessage());
      })
      .catch(() => {});
  }, [user]);

  // build 299: 환영 sync 보상 순간 — 첫 sync 가 러닝을 가져왔으면 (synced > 0) 축하 시트 1회.
  // 신규 유저 대부분이 import 경로인데 지금까진 무음이었음 (완주→축하 루프 부재).
  const [welcomeSyncCount, setWelcomeSyncCount] = useState<number | null>(null);

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
            // build 299: 가져온 활동이 있으면 환영 축하 시트 — user 당 1회 (localStorage).
            const celebratedKey = `welcome_sync_celebrated:${user.id}`;
            if (r.synced > 0 && !window.localStorage.getItem(celebratedKey)) {
              window.localStorage.setItem(celebratedKey, '1');
              setWelcomeSyncCount(r.synced);
            }
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

      {/* build 292: 초대 코드 자동 claim 성공 토스트 */}
      {referralToast && (
        <AppToast text={referralToast} tone="ok" onClose={() => setReferralToast(null)} durationMs={3500} />
      )}

      {/* build 299: Apple Health 환영 sync 완료 축하 시트 (user 당 1회) */}
      {welcomeSyncCount !== null && welcomeSyncCount > 0 && (
        <WelcomeSyncSheet count={welcomeSyncCount} onClose={() => setWelcomeSyncCount(null)} />
      )}

      {/* 메인 컨텐츠 — 유일한 스크롤 영역 */}
      <main className="flex-1 overflow-y-auto overscroll-contain">
        <AnalyticsAutoTracker />
        {/* build 297: 진행 중 러닝 전역 배너 — 어느 탭에서든 세션 복귀 경로 제공
            (hans 신고: 1시간 달리고 앱 열었더니 홈이 세션 존재를 안 보여줌) */}
        {user && <ActiveRunBanner />}
        <UserDataProvider>{children}</UserDataProvider>
      </main>

      {/* 하단 4탭 네비게이션 — flex-shrink-0 로 고정, sticky 제거.
          채팅 페이지에선 입력창이 가리는 문제로 nav 숨김 (사용자 신고 build 67). */}
      <nav className={`flex-shrink-0 z-40 border-t border-[var(--card-border)] bg-[var(--header-bg)] backdrop-blur-xl pb-[max(env(safe-area-inset-bottom),4px)] ${isChat || isTrack ? 'hidden' : ''}`}>
        <div className="flex justify-around items-center h-14">
          {/* 2026-07-18 (hans): "달리기 시작"을 홈 헤더 칩 → 탭바 정중앙 원형 버튼으로.
              헤더 (종+칩) 이 복잡해졌다는 피드백 + NRC/Strava 문법 — 어느 탭에서든
              엄지로 바로 시작. 탭 2개 | 시작 | 탭 2개 배치. */}
          {TABS_BASE.slice(0, 2).map(renderTab)}
          <Link
            href="/track"
            aria-label={tt('달리기 시작하기')}
            className="relative -mt-7 w-[60px] h-[60px] rounded-full bg-gradient-to-br from-emerald-400 via-emerald-500 to-emerald-600 shadow-lg shadow-emerald-500/40 border-4 border-[var(--background)] flex items-center justify-center active:scale-90 transition"
          >
            <Play size={26} className="text-white ml-1" fill="currentColor" strokeWidth={0} />
          </Link>
          {TABS_BASE.slice(2).map(renderTab)}
        </div>
      </nav>
    </div>
  );

  function renderTab(tab: (typeof TABS_BASE)[number]) {
    const isActive =
      pathname === tab.href ||
      pathname.startsWith(tab.href + '/') ||
      (tab.activeFor?.some(p => pathname === p || pathname.startsWith(p + '/')) ?? false);
    // build 261→2026-07-15: 소셜 탭 배지 제거 (사용자 결정) — 탭 배지를 보고 소셜에
    // 들어가도 알림이 어디 있는지 안 보였음. 알림 unread 는 홈/소셜 헤더 종 배지
    // (NotificationBell) + 앱 아이콘 배지가 담당.
    // build 298: 내정보 탭 쪽지 unread 배지는 유지 (쪽지 진입점이 내정보 안).
    const badgeCount = tab.href === '/profile' ? messageUnread : 0;
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
  }
}
