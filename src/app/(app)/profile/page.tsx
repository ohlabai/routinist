'use client';

import { useMemo, useState, useRef } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/components/UserDataProvider';
import { signOut, uploadAvatar, updateProfile } from '@/lib/auth';
import { getWeeklyStreak } from '@/lib/routinist-data';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronRight, HelpCircle, Shield, Heart, Award, LogOut, MapPin,
  MessageCircle, Coins, Gift, Sun, Moon, Monitor, Settings, Activity as ActivityIcon,
  AlertTriangle, X, FileText, Bell, BellOff, PenLine, Camera, ShoppingBag,
} from 'lucide-react';
import { useEffect } from 'react';
import { checkPushPermission, requestPushPermissionAgain, type PushPermissionState } from '@/lib/push-notifications';
import { isAdminEmail } from '@/lib/admin-emails';
import AppLogo from '@/components/AppLogo';
import { useTheme } from '@/components/ThemeProvider';
import { useI18n, SUPPORTED_LOCALES } from '@/lib/i18n';
import { getSupabase } from '@/lib/supabase';
import AppToast from '@/components/AppToast';
import { logClientWarn } from '@/lib/error-logger';
import UnitToggle from '@/components/profile/UnitToggle';
import InviteFriendCard from '@/components/profile/InviteFriendCard';

function formatPace(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}'${String(s).padStart(2, '0')}"`;
}

function formatDur(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}` : `${m}분`;
}

export default function ProfilePage() {
  const { user, profile, refreshProfile } = useAuth();
  const { activities } = useUserData();
  const router = useRouter();
  const isAdmin = isAdminEmail(user?.email);
  const [pushState, setPushState] = useState<PushPermissionState>('unavailable');
  const [pushBusy, setPushBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  // build 169 #14: 프로필 사진 직접 탭 → 파일 선택 → 즉시 업로드 → refresh.
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const handleAvatarTap = () => {
    if (avatarUploading) return;
    avatarInputRef.current?.click();
  };
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setAvatarUploading(true);
    try {
      const url = await uploadAvatar(user.id, file);
      await updateProfile(user.id, { avatar_url: url });
      await refreshProfile();
      setToast({ text: tt('프로필 사진을 변경했어요 ✨'), tone: 'ok' });
      setTimeout(() => setToast(null), 2500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logClientWarn('ProfilePage', '아바타 업로드 실패', { reason: msg });
      setToast({ text: `${tt('사진 업로드 실패')} — ${msg.slice(0, 80)}`, tone: 'warn' });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setAvatarUploading(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  useEffect(() => {
    checkPushPermission().then(setPushState).catch(() => {});
  }, []);

  // build 173.1 #1: /profile mount 시 직접 mileage_balance 재조회.
  // AuthProvider 의 profile 캐시는 선물·차감 직후 stale → 별도 state 로 fresh 잔액 유지.
  const [freshBalance, setFreshBalance] = useState<number | null>(null);
  useEffect(() => {
    if (!user?.id) return;
    import('@/lib/mileage-data').then(m => m.fetchMileageBalance(user.id)).then(setFreshBalance).catch(() => {});
  }, [user?.id]);
  const displayBalance = freshBalance !== null ? freshBalance : Number(profile?.mileage_balance ?? 0);

  // build 278: 받은 응원 카운트 — 통산 km 옆 chip.
  const [cheerCounts, setCheerCounts] = useState<{ total: number; thisWeek: number }>({ total: 0, thisWeek: 0 });
  useEffect(() => {
    if (!user?.id) return;
    import('@/lib/cheer-data').then(m => m.getReceivedCheerCounts(user.id)).then(setCheerCounts).catch(() => {});
  }, [user?.id]);

  // 쪽지함 미읽음 카운트 — receiver(나) + read_at IS NULL. build 175 신설, build 179 refresh 보강.
  // mount + visibility 복귀 + window focus 시마다 재요청 → 채팅 읽고 돌아왔을 때 stale 배지 회피.
  const [unreadMessages, setUnreadMessages] = useState(0);
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const fetchUnread = async () => {
      try {
        const sb = getSupabase();
        const { data: convs } = await sb.from('conversations')
          .select('id, user_a, user_b')
          .or(`user_a.eq.${user.id},user_b.eq.${user.id}`);
        const convIds = (convs ?? []).map((c: { id: string }) => c.id);
        if (convIds.length === 0) { if (!cancelled) setUnreadMessages(0); return; }
        const { count } = await sb.from('messages')
          .select('*', { count: 'exact', head: true })
          .in('conversation_id', convIds)
          .neq('sender_id', user.id)
          .is('read_at', null);
        if (!cancelled) setUnreadMessages(count ?? 0);
      } catch { /* silent */ }
    };
    fetchUnread();
    const onVisible = () => { if (document.visibilityState === 'visible') fetchUnread(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', fetchUnread);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', fetchUnread);
    };
  }, [user?.id]);

  const handlePushToggle = async () => {
    setPushBusy(true);
    try {
      const res = await requestPushPermissionAgain();
      setToast({ text: res.message, tone: res.ok ? 'ok' : 'warn' });
      setTimeout(() => setToast(null), 3500);
      const next = await checkPushPermission();
      setPushState(next);
    } finally {
      setPushBusy(false);
    }
  };

  const totalKm = Number(profile?.total_distance_km ?? 0);
  const totalRuns = profile?.total_runs ?? 0;
  // build 299 C5: 홈과 동일한 주 단위 스트릭 (일 단위는 유저 전원 주 2~4회 러너라 상시 0)
  const streak = getWeeklyStreak(activities, profile?.weekly_run_goal ?? 1);

  // 개인 베스트 (누적) — activities 에서 클라 사이드 계산. 사용자 결정 (build 67):
  // 총km/총러닝/연속일 → 최장거리/최빠페이스/최장시간 (베스트 3종) 으로 교체.
  // 통산 km 는 헤더 옆 작은 라벨로 유지.
  const personalBest = useMemo(() => {
    let longestKm = 0;
    let fastestPace: number | null = null;
    let longestDur = 0;
    for (const a of activities) {
      const km = Number(a.distance_km);
      if (km > longestKm) longestKm = km;
      if (a.pace_avg_sec_per_km && km >= 1) {
        if (fastestPace === null || a.pace_avg_sec_per_km < fastestPace) fastestPace = a.pace_avg_sec_per_km;
      }
      if (a.duration_seconds && a.duration_seconds > longestDur) longestDur = a.duration_seconds;
    }
    return { longestKm, fastestPace, longestDur };
  }, [activities]);

  const { mode, setMode } = useTheme();
  const { locale, setLocale, t, tt } = useI18n();

  // 배지 계산 — 누적 거리/횟수 기반 성취 (label 은 unit 만 locale 무관하게 표시)
  const badges: { icon: string; label: string; gradient: string }[] = [];
  if (totalKm >= 10) badges.push({ icon: '🏅', label: '10km', gradient: 'from-amber-100 to-yellow-100 dark:from-amber-900/30 dark:to-yellow-900/30' });
  if (totalKm >= 50) badges.push({ icon: '🎖️', label: '50km', gradient: 'from-blue-100 to-cyan-100 dark:from-blue-900/30 dark:to-cyan-900/30' });
  if (totalKm >= 100) badges.push({ icon: '🏆', label: '100km', gradient: 'from-yellow-100 to-amber-100 dark:from-yellow-900/30 dark:to-amber-900/30' });
  if (totalKm >= 500) badges.push({ icon: '💎', label: '500km', gradient: 'from-purple-100 to-pink-100 dark:from-purple-900/30 dark:to-pink-900/30' });
  if (totalKm >= 1000) badges.push({ icon: '👑', label: '1000km', gradient: 'from-amber-200 to-yellow-200 dark:from-amber-800/30 dark:to-yellow-800/30' });
  if (totalRuns >= 10) badges.push({ icon: '🔥', label: `10×`, gradient: 'from-amber-100 to-yellow-100 dark:from-amber-900/30 dark:to-yellow-900/30' });
  if (totalRuns >= 50) badges.push({ icon: '⚡', label: `50×`, gradient: 'from-yellow-100 to-lime-100 dark:from-yellow-900/30 dark:to-lime-900/30' });
  if (streak >= 4) badges.push({ icon: '💪', label: '4주 🔥', gradient: 'from-green-100 to-emerald-100 dark:from-green-900/30 dark:to-emerald-900/30' });
  if (streak >= 12) badges.push({ icon: '🌟', label: '12주 🔥', gradient: 'from-indigo-100 to-violet-100 dark:from-indigo-900/30 dark:to-violet-900/30' });

  // 계정 삭제 (Apple 5.1.1 v 의무) — 2단계 확인 + delete_my_account RPC
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteToast, setDeleteToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const handleDeleteAccount = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.rpc('delete_my_account');
      if (error) throw error;
      // 삭제 성공 — signOut 결과를 명시적으로 await. 실패해도 진행 (서버 row 는 이미 사라짐).
      try { await supabase.auth.signOut(); } catch (e) {
        logClientWarn('ProfilePage', '삭제 후 signOut 실패 (무시)', { reason: e instanceof Error ? e.message : String(e) });
      }
      // localStorage.clear() 는 너무 광범위 — routinist 가 쓴 키만 선별 삭제.
      // 다른 origin 의 캐시(시크릿 노트 등)를 의도치 않게 지우는 위험 회피.
      try {
        if (typeof window !== 'undefined') {
          const keys: string[] = [];
          for (let i = 0; i < window.localStorage.length; i++) {
            const k = window.localStorage.key(i);
            if (!k) continue;
            if (
              k.startsWith('routinist_') ||
              k.startsWith('first_sync_done:') ||
              k === 'last_health_sync' ||
              k === 'onboarding_done' ||
              k === 'sb-' || k.startsWith('sb-') // supabase auth keys
            ) keys.push(k);
          }
          keys.forEach(k => window.localStorage.removeItem(k));
        }
      } catch {}
      router.replace('/login?deleted=1');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logClientWarn('ProfilePage', 'delete_my_account 실패', { reason: msg });
      setDeleteToast({ text: `${tt('탈퇴 실패')} — ${msg.slice(0, 100)}`, tone: 'warn' });
      setDeleting(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace('/login');
  };

  // 액션 그리드 — 자주 쓰는 기능만. 쇼핑은 하단 탭에서 강등되어 여기로 이동 (단순화 B, 2026-07-11).
  const actions: { href: string; label: string; Icon: typeof Heart; color: string }[] = [
    { href: '/connect', label: t('profile.actionConnect'), Icon: Heart, color: 'text-red-500' },
    { href: '/messages', label: t('profile.actionMessages'), Icon: MessageCircle, color: 'text-blue-500' },
    { href: '/mileage', label: t('profile.actionMileage'), Icon: Coins, color: 'text-amber-500' },
    { href: '/mileage/gift', label: t('profile.actionMileageGift'), Icon: Gift, color: 'text-pink-500' },
    { href: '/shop', label: t('nav.shop'), Icon: ShoppingBag, color: 'text-emerald-500' },
  ];

  // build 136 메뉴 IA 정리 — 데이터 점검(audit) 은 일반 메뉴에서 제거 (어드민 대시보드 안에만 노출).
  // 명언 랭킹/러너 에세이/나의 명언은 이미 소셜 탭으로 이전됨.
  const settings: { href: string; label: string; Icon: typeof HelpCircle }[] = [
    { href: '/feedback', label: t('profile.menuFeedback'), Icon: HelpCircle },
    { href: '/profile/push-settings', label: t('profile.menuPushSettings'), Icon: HelpCircle },
    // build 291: 차단 관리 (Apple 1.2 — 차단 해제 경로 제공)
    { href: '/profile/blocked', label: tt('차단한 사용자'), Icon: Shield },
    // build 291: 거리 단위 km/mi — UnitToggle 카드는 아래 별도 렌더 (액션 아님)
    { href: '/shop/orders', label: t('profile.menuOrders'), Icon: HelpCircle },
    { href: '/shop/addresses', label: t('profile.menuAddresses'), Icon: HelpCircle },
    // build 205 #15: 셀러 신청 / 셀러 콘솔. 승인 여부 모름 → /seller/products 로 보내고 그 안에서 분기.
    { href: '/seller/products', label: t('profile.menuSeller'), Icon: HelpCircle },
    { href: '/support', label: t('profile.menuSupport'), Icon: HelpCircle },
    { href: '/privacy', label: t('profile.menuPrivacy'), Icon: Shield },
    { href: '/terms', label: t('profile.menuTerms'), Icon: FileText },
    // build 211 #1: 어드민 진입점을 메뉴 최하단으로 이동 (사용자 신고 — 너무 위에 보임).
    ...(isAdmin ? [
      { href: '/admin', label: t('profile.menuAdmin'), Icon: Settings },
    ] : []),
  ];

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      {/* Sticky Header */}
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="px-4 py-3 flex items-center gap-2">
          <AppLogo size={28} />
          <h1 className="text-xl font-extrabold tracking-tight">{t('profile.title')}</h1>
        </div>
      </header>

      <div className="p-4 space-y-4">
      {/* 프로필 카드 */}
      <div className="card p-6">
        <div className="flex items-center gap-4">
          <button
            onClick={handleAvatarTap}
            disabled={avatarUploading}
            aria-label={tt('프로필 사진 변경')}
            className="relative w-16 h-16 rounded-full bg-[var(--card-border)] overflow-hidden flex-shrink-0 active:scale-95 transition disabled:opacity-60"
          >
            {profile?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center"><AppLogo size={36} /></div>
            )}
            {/* 카메라 뱃지 — 탭 가능 시각 신호 */}
            <span className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-emerald-500 border-2 border-[var(--background)] flex items-center justify-center">
              {avatarUploading ? (
                <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Camera size={12} className="text-white" />
              )}
            </span>
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarChange}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-[var(--foreground)] truncate">{profile?.display_name}</h2>
              <Link
                href="/profile/edit"
                className="text-xs font-bold text-emerald-600 inline-flex items-center gap-1 active:scale-95 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 flex-shrink-0"
              >
                <PenLine size={12} />
                {t('profile.edit')}
              </Link>
            </div>
            {profile?.region_gu ? (
              <p className="text-xs text-[var(--muted)] flex items-center gap-1">
                <MapPin size={12} /> {profile.region_si} {profile.region_gu} {profile.region_dong || ''}
              </p>
            ) : profile?.bio ? (
              <p className="text-xs text-[var(--muted)] truncate">{profile.bio}</p>
            ) : (
              <p className="text-xs text-[var(--muted)]">{t('profile.runner')}</p>
            )}
          </div>
        </div>

        {/* 러닝 코치 (AI) 진입 — build 198. opt-in 사용자 / 미가입자 모두 입장 가능 */}
        <Link
          href="/coach"
          className="mt-4 flex items-center justify-between px-4 py-3.5 rounded-2xl bg-gradient-to-br from-violet-50 to-fuchsia-50 dark:from-violet-950/30 dark:to-fuchsia-950/20 border border-violet-200/50 dark:border-violet-900/40 active:scale-[0.98] transition group"
        >
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center">
              <ActivityIcon size={15} className="text-violet-600" />
            </div>
            <div>
              <p className="text-sm font-extrabold text-violet-800 dark:text-violet-200">{tt('러닝 코치 (AI)')}</p>
              <p className="text-[12px] text-violet-600/80 dark:text-violet-400/80">{tt('오늘 컨디션 · 자기 기록 분석')}</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5">
            <span className="text-[12px] font-extrabold text-violet-700 dark:text-violet-300 px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/40">NEW</span>
            <ChevronRight size={16} className="text-violet-500/70 group-active:translate-x-0.5 transition" />
          </span>
        </Link>

        {/* 마일리지 잔액 칩 — 에메랄드 그라데이션 */}
        <Link
          href="/mileage"
          className="mt-4 flex items-center justify-between px-4 py-3.5 rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/20 border border-emerald-200/50 dark:border-emerald-900/40 active:scale-[0.98] transition group"
        >
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
              <Coins size={15} className="text-emerald-600" />
            </div>
            <span className="text-sm font-extrabold text-emerald-800 dark:text-emerald-200">{t('profile.mileage')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xl font-extrabold text-emerald-700 dark:text-emerald-300">
              {displayBalance.toLocaleString()}
            </span>
            <span className="text-sm font-extrabold text-emerald-600">P</span>
            <ChevronRight size={16} className="text-emerald-500/70 group-active:translate-x-0.5 transition" />
          </div>
        </Link>

        {/* 2026-07-11 피드백: 텍스트 한 줄이 아래 베스트 3칩과 톤이 안 맞음 —
            동일한 3열 스탯 그리드로 통일 (통산 / 러닝 횟수 / 주간 연속) */}
        <div className="grid grid-cols-3 gap-2 text-center mt-4 pt-4 border-t border-[var(--card-border)]">
          <div>
            <p className="text-lg font-extrabold text-emerald-600">{totalKm.toFixed(0)}km</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">{locale === 'en' ? 'Total' : '통산 거리'}</p>
          </div>
          <div>
            <p className="text-lg font-extrabold text-[var(--foreground)] tabular-nums">{totalRuns}{locale === 'en' ? '' : '회'}</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">{locale === 'en' ? 'Runs' : '러닝 횟수'}</p>
          </div>
          <div>
            <p className="text-lg font-extrabold text-emerald-600 tabular-nums">{streak}{locale === 'en' ? 'w' : '주'} 🔥</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">{locale === 'en' ? 'Weekly streak' : '주간 연속'}</p>
          </div>
        </div>

        {/* build 278: 받은 응원 chip — 동기 부여. 받은 응원 > 0 일 때만 표시 (빈 chip 어색). */}
        {cheerCounts.total > 0 && (
          <div className="flex items-center justify-center gap-2 mt-2">
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-rose-50 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-800/40">
              <span className="text-xs">❤️</span>
              <span className="text-xs font-extrabold text-rose-700 dark:text-rose-300 tabular-nums">{cheerCounts.total}</span>
              <span className="text-[12px] font-bold text-rose-600/70 dark:text-rose-400/70">받은 응원</span>
            </span>
            {cheerCounts.thisWeek > 0 && (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/40">
                <span className="text-xs">🔥</span>
                <span className="text-xs font-extrabold text-amber-700 dark:text-amber-300 tabular-nums">{cheerCounts.thisWeek}</span>
                <span className="text-[12px] font-bold text-amber-600/70 dark:text-amber-400/70">이번 주</span>
              </span>
            )}
          </div>
        )}

        {/* 개인 베스트 3칩 — 최장거리 / 최빠페이스 / 최장시간 (build 67) */}
        <div className="grid grid-cols-3 gap-2 text-center mt-3 pt-4 border-t border-[var(--card-border)]">
          <div>
            <p className="text-lg font-extrabold text-[var(--accent)]">
              {personalBest.longestKm > 0 ? `${personalBest.longestKm.toFixed(1)}km` : '—'}
            </p>
            <p className="text-xs text-[var(--muted)] mt-0.5">{t('profile.bestLong')}</p>
          </div>
          <div>
            <p className="text-lg font-extrabold text-[var(--foreground)]">
              {personalBest.fastestPace ? formatPace(personalBest.fastestPace) : '—'}
            </p>
            <p className="text-xs text-[var(--muted)] mt-0.5">{t('profile.bestPace')}</p>
          </div>
          <div>
            <p className="text-lg font-extrabold text-[var(--foreground)]">
              {personalBest.longestDur > 0 ? formatDur(personalBest.longestDur) : '—'}
            </p>
            <p className="text-xs text-[var(--muted)] mt-0.5">{t('profile.bestDur')}</p>
          </div>
        </div>
      </div>

      {/* 배지 — 가로 스크롤로 공간 절약 */}
      {badges.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Award size={16} className="text-yellow-500" />
            <h3 className="text-base font-semibold text-[var(--foreground)]">{t('profile.badges')}</h3>
            <span className="text-xs text-[var(--muted)]">{badges.length}</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {badges.map(b => (
              <div
                key={b.label}
                className={`flex items-center gap-1.5 bg-gradient-to-r ${b.gradient} rounded-full px-3.5 py-2 shadow-sm flex-shrink-0`}
              >
                <span className="text-base">{b.icon}</span>
                <span className="text-sm font-semibold text-[var(--foreground)] whitespace-nowrap">{b.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 액션 그리드 (2열) — 쪽지/마일리지/쇼핑 등 */}
      <div className="grid grid-cols-2 gap-3">
        {actions.map(a => {
          // build 175 #5: 쪽지함 카드에 미읽음 배지
          const showBadge = a.href === '/messages' && unreadMessages > 0;
          return (
            <Link
              key={a.href}
              href={a.href}
              className="card p-4 flex flex-col items-start gap-2 active:scale-[0.98] transition-transform relative"
            >
              <a.Icon size={24} className={a.color} />
              <span className="text-sm font-semibold text-[var(--foreground)]">{a.label}</span>
              {showBadge && (
                <span className="absolute top-3 right-3 min-w-[22px] h-[22px] px-1.5 rounded-full bg-rose-500 text-white text-[13px] font-extrabold flex items-center justify-center shadow-sm">
                  {unreadMessages > 99 ? '99+' : unreadMessages}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* 알림 권한 — 네이티브 + 권한 부여 안 된 경우만 노출 */}
      {pushState !== 'granted' && pushState !== 'unavailable' && (
        <button
          onClick={handlePushToggle}
          disabled={pushBusy}
          className="w-full card p-4 flex items-center gap-3 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/20 dark:to-teal-950/20 border-emerald-200/60 dark:border-emerald-900/40 active:scale-[0.99] disabled:opacity-50"
        >
          <div className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
            <BellOff size={18} className="text-emerald-600" />
          </div>
          <div className="flex-1 text-left">
            <p className="text-sm font-extrabold text-[var(--foreground)]">{t('profile.pushOnTitle')}</p>
            <p className="text-[13px] text-[var(--muted)] mt-0.5">
              {pushState === 'denied' ? t('profile.pushOnSubReenable') : t('profile.pushOnSubInvite')}
            </p>
          </div>
          <ChevronRight size={16} className="text-emerald-600" />
        </button>
      )}
      {pushState === 'granted' && (
        <div className="card p-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center">
            <Bell size={16} className="text-emerald-600" />
          </div>
          <p className="text-xs text-[var(--muted)] flex-1">{t('profile.pushOnSummary')}</p>
        </div>
      )}

      {/* 친구 초대 — build 292 성장 루프. 코드 조회 실패(RPC 미배포)면 자체 숨김 */}
      <InviteFriendCard />

      {/* 설정 카드 */}
      <div className="card divide-y divide-[var(--card-border)]">
        {settings.map(s => (
          <Link key={s.href} href={s.href} className="flex items-center justify-between px-4 py-3.5">
            <div className="flex items-center gap-3">
              <s.Icon size={18} className="text-[var(--muted)]" />
              <span className="text-sm text-[var(--foreground)]">{s.label}</span>
            </div>
            <ChevronRight size={16} className="text-[var(--muted)]" />
          </Link>
        ))}

        {/* 언어 */}
        <div className="px-4 py-4 border-t border-[var(--card-border)]">
          <p className="text-xs text-[var(--muted)] font-semibold mb-2.5">{t('settings.language')}</p>
          <div className="grid grid-cols-4 gap-2">
            {SUPPORTED_LOCALES.map(l => (
              <button
                key={l.code}
                onClick={() => setLocale(l.code)}
                className={`min-h-[44px] py-3 rounded-xl text-xs font-semibold transition-all ${
                  locale === l.code
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--card-border)]/30 text-[var(--muted)]'
                }`}
              >
                {l.native}
              </button>
            ))}
          </div>
        </div>

        {/* build 291: 거리 단위 km/mi */}
        <div className="px-4 py-4 border-t border-[var(--card-border)]">
          <UnitToggle />
        </div>

        {/* 화면 모드 */}
        <div className="px-4 py-4">
          <p className="text-xs text-[var(--muted)] font-semibold mb-2.5">{t('profile.themeTitle')}</p>
          <div className="flex gap-2">
            {([
              { id: 'light' as const, label: t('profile.themeLight'), Icon: Sun },
              { id: 'dark' as const, label: t('profile.themeDark'), Icon: Moon },
              { id: 'system' as const, label: t('profile.themeSystem'), Icon: Monitor },
            ]).map(opt => (
              <button
                key={opt.id}
                onClick={() => setMode(opt.id)}
                className={`flex-1 min-h-[44px] flex items-center justify-center gap-1.5 py-3 rounded-xl text-sm font-semibold transition-all ${
                  mode === opt.id
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--card-border)]/30 text-[var(--muted)]'
                }`}
              >
                <opt.Icon size={14} />
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 로그아웃 */}
        <button
          onClick={handleSignOut}
          className="w-full flex items-center justify-center gap-2 px-4 py-3.5 text-sm text-red-500 font-semibold"
        >
          <LogOut size={16} />
          {t('profile.signOut')}
        </button>
      </div>

      {/* 계정 탈퇴 — Apple 5.1.1(v) 의무. 한국 사용자 친화 표현. 다이얼로그에서 "영구 삭제" 강조. */}
      <button
        onClick={() => { setShowDeleteDialog(true); setDeleteConfirmText(''); }}
        className="w-full text-center text-xs text-[var(--muted)] underline underline-offset-2 py-3 active:text-red-500 transition-colors"
      >
        {t('profile.deleteAccount')}
      </button>

      <p className="text-center text-xs text-[var(--muted)]">Routinist v1.0.0</p>

      {/* 계정 삭제 확인 다이얼로그 — 2단계: 경고 + "삭제" 텍스트 입력 */}
      {showDeleteDialog && (
        <div
          className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4 animate-fade-in"
          onClick={() => { if (!deleting) { setShowDeleteDialog(false); setDeleteConfirmText(''); } }}
        >
          <div
            className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-3xl p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-950/40 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={24} className="text-red-500" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-[var(--foreground)]">{tt('정말 탈퇴할까요?')}</h3>
                <p className="text-sm text-[var(--muted)] mt-1 leading-relaxed">
                  {tt('탈퇴하면 러닝 기록·사진·친구·마일리지 등 모든 데이터가 영구 삭제되며 복구할 수 없어요.')}
                </p>
              </div>
              <button
                onClick={() => { if (!deleting) { setShowDeleteDialog(false); setDeleteConfirmText(''); } }}
                aria-label={tt('닫기')}
                className="text-[var(--muted)] -mr-1 -mt-1 p-1"
              >
                <X size={18} />
              </button>
            </div>

            <div className="bg-red-50 dark:bg-red-950/30 rounded-xl p-3 mb-4 text-sm text-red-700 dark:text-red-300 space-y-1">
              <p>• {locale === 'en' ? `${totalKm.toFixed(0)}km · ${totalRuns} runs total` : `통산 ${totalKm.toFixed(0)}km · ${totalRuns}회 러닝 기록`}</p>
              <p>• {locale === 'en' ? 'Uploaded photos and calendar' : '업로드한 사진과 캘린더'}</p>
              <p>• {locale === 'en' ? 'Friends · messages · cheers' : '친구·쪽지·응원 내역'}</p>
              <p>• {locale === 'en' ? 'Earned mileage' : '적립한 마일리지'}</p>
            </div>

            <p className="text-xs text-[var(--muted)] mb-2">{tt('계속하려면 아래에 ')}<span className="font-bold text-red-500">{tt('탈퇴')}</span>{tt(' 라고 입력해주세요')}</p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={tt('탈퇴')}
              disabled={deleting}
              className="w-full px-4 py-3 mb-4 rounded-xl bg-[var(--card-border)]/30 border border-[var(--card-border)] text-base text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />

            <div className="flex gap-2">
              <button
                onClick={() => { setShowDeleteDialog(false); setDeleteConfirmText(''); }}
                disabled={deleting}
                className="flex-1 py-3 rounded-xl bg-[var(--card-border)]/30 text-[var(--foreground)] font-semibold disabled:opacity-50"
              >
                {locale === 'en' ? 'Cancel' : '취소'}
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleting || (locale === 'en' ? deleteConfirmText.trim().toLowerCase() !== 'delete' : deleteConfirmText.trim() !== '탈퇴')}
                className="flex-1 py-3 rounded-xl bg-red-500 text-white font-bold disabled:opacity-30 active:scale-95 transition-transform flex items-center justify-center gap-2"
              >
                {deleting ? (
                  <>
                    <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    {tt('탈퇴 처리 중...')}
                  </>
                ) : (
                  locale === 'en' ? 'Delete account' : '탈퇴하기'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteToast && (
        <AppToast text={deleteToast.text} tone={deleteToast.tone} onClose={() => setDeleteToast(null)} durationMs={4000} />
      )}
      {toast && (
        <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={3500} />
      )}
      </div>
    </div>
  );
}
