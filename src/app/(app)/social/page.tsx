'use client';

// 소셜 허브 (build 100 재편) — 3탭: 친구 / 클럽 / 포토.
// 내 랭킹 + 마일리지 서브탭은 /ranking 페이지로 이전.

import { useState, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { searchUsers, fetchPublicUsers, getMyClubs, fetchFollowing } from '@/lib/social-data';
import { getSupabase } from '@/lib/supabase';
import UserRow from '@/components/social/UserRow';
import PhotosTab from '@/components/photos/PhotosTab';
import QuotesTab from '@/components/social/QuotesTab';
import MultiUserTimeSeriesChart, { type CompareUser } from '@/components/charts/MultiUserTimeSeriesChart';
import { User as UserIcon, Users, Search, Plus, MapPin, Camera, Trophy, MessageSquare, Bell } from 'lucide-react';
import { fetchUnreadNotificationSummary } from '@/lib/notifications-data';
import { startOfWeekStr, startOfMonthStr } from '@/lib/kst';
import type { Profile, Club } from '@/types';
import AppLogo from '@/components/AppLogo';
import { useI18n } from '@/lib/i18n';

const SECTIONS = [
  { id: 'friends', tKey: 'social.tabFriends', Icon: UserIcon },
  { id: 'clubs', tKey: 'social.tabClubs', Icon: Users },
  { id: 'photos', tKey: 'social.tabPhotos', Icon: Camera },
  { id: 'quotes', tKey: 'social.tabQuotes', Icon: MessageSquare },
] as const;

type SectionId = typeof SECTIONS[number]['id'];

function startOfWeek(): string {
  return startOfWeekStr();
}
function startOfMonth(): string {
  return startOfMonthStr();
}

type ComparePeriod = 'week' | 'month';

// build 263: 종 아이콘 위 빨간 카운트. /social 진입 시 layout 의 markRead 가 발사돼서
// 잠시 후 0 으로. 그래도 사용자가 새로고침 없이 다시 진입 시 fresh fetch.
function NotificationBellBadge() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let mounted = true;
    fetchUnreadNotificationSummary().then(s => { if (mounted) setCount(s.total); }).catch(() => {});
    return () => { mounted = false; };
  }, []);
  if (count <= 0) return null;
  return (
    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-extrabold flex items-center justify-center leading-none shadow-md shadow-rose-500/30 tabular-nums">
      {count > 99 ? '99+' : count}
    </span>
  );
}

function SocialPageInner() {
  const { user, profile } = useAuth();
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') as SectionId) ?? 'friends';
  const [activeSection, setActiveSection] = useState<SectionId>(
    ['friends', 'clubs', 'photos', 'quotes'].includes(initialTab) ? initialTab : 'friends'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState<Profile[]>([]);
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [myClubs, setMyClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);
  const [friendsCompare, setFriendsCompare] = useState<{ id: string; name: string; avatar: string | null; km: number; isMe: boolean }[]>([]);
  const [comparePeriod, setComparePeriod] = useState<ComparePeriod>('week');

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [publicUsers, following, clubs] = await Promise.all([
        fetchPublicUsers(30),
        fetchFollowing(user.id),
        getMyClubs(),
      ]);
      setUsers(publicUsers.filter((u) => u.id !== user.id));
      setFollowingIds(new Set(following.map((f) => f.id)));
      setMyClubs(clubs);

      // 친구 + 나 비교 — 기간(주/월) 선택 (build 205 #4).
      const supabase = getSupabase();
      const periodStart = comparePeriod === 'week' ? startOfWeek() : startOfMonth();
      const friendIds = following.map(f => f.id);
      const allIds = [user.id, ...friendIds];
      const { data: acts } = await supabase
        .from('activities')
        .select('user_id, distance_km')
        .in('user_id', allIds)
        .gte('activity_date', periodStart);
      const kmMap = new Map<string, number>();
      (acts ?? []).forEach(a => kmMap.set(a.user_id, (kmMap.get(a.user_id) ?? 0) + Number(a.distance_km)));
      const rows = [
        { id: user.id, name: profile?.display_name ?? t('social.me'), avatar: profile?.avatar_url ?? null, km: kmMap.get(user.id) ?? 0, isMe: true },
        ...following.map(f => ({ id: f.id, name: f.display_name, avatar: f.avatar_url, km: kmMap.get(f.id) ?? 0, isMe: false })),
      ].sort((a, b) => b.km - a.km);
      setFriendsCompare(rows);
    } catch (e) {
      console.warn('[Social] load 실패', e);
    } finally {
      setLoading(false);
    }
  }, [user, profile, t, comparePeriod]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      const publicUsers = await fetchPublicUsers(30);
      setUsers(publicUsers.filter((u) => u.id !== user?.id));
      return;
    }
    const results = await searchUsers(query);
    setUsers(results.filter((u) => u.id !== user?.id));
  };

  const name = profile?.display_name ?? t('profile.runner');

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      {/* Sticky Header — build 263: 우측 종 아이콘 → /notifications. 알림 unread 표시는 layout 의 탭배지로 분담. */}
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="px-4 py-3 flex items-center gap-2">
          <AppLogo size={28} />
          <h1 className="text-xl font-extrabold tracking-tight">{t('social.title')}</h1>
          <Link
            href="/notifications"
            aria-label="Notifications"
            className="ml-auto relative w-10 h-10 rounded-full flex items-center justify-center hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90"
          >
            <Bell size={20} strokeWidth={1.8} />
            <NotificationBellBadge />
          </Link>
        </div>
      </header>

      <div className="px-4 pt-4">
      {/* 세그먼트 컨트롤 — 4탭 (그린 잔디블록 테마) */}
      <div className="flex bg-[var(--card)] border border-[var(--card-border)] rounded-2xl p-1 mb-5 shadow-sm">
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            onClick={() => setActiveSection(section.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-extrabold transition-all active:scale-95 ${
              activeSection === section.id
                ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-500/30'
                : 'text-[var(--muted)]'
            }`}
          >
            <section.Icon size={14} />
            {t(section.tKey)}
          </button>
        ))}
      </div>

      {/* 내 랭킹 + 마일리지 서브탭은 /ranking 페이지로 이전 (build 100). */}

      {/* 친구 탭 */}
      {activeSection === 'friends' && (
        <div className="space-y-6">
          {/* build 227: 시계열 비교 차트 — 막대 그래프 위에 우선 노출 (추이 정보가 합계보다 인사이트 큼).
              본인 + 팔로잉 친구 최대 5명 선택. 일간 14일 / 주간 8주 토글. */}
          {friendsCompare.length > 1 && (
            <MultiUserTimeSeriesChart
              title="친구와 추이 비교"
              users={friendsCompare.map(r => ({ id: r.id, name: r.name, isMe: r.isMe })) as CompareUser[]}
              defaultSelectedIds={friendsCompare.filter(r => r.isMe || r.km > 0).slice(0, 5).map(r => r.id)}
            />
          )}
          {friendsCompare.length > 1 ? (
            <div className="card p-4">
              {/* build 209 #5: 이번주/이번달 토글 폰트 크기 대폭 확대 (10px → text-sm) + 패딩도 증가 */}
              <div className="flex items-center justify-between mb-3 gap-2">
                <h3 className="text-base font-extrabold text-[var(--foreground)] truncate">
                  {comparePeriod === 'week' ? t('social.weekCompare') : t('social.monthCompare')}
                </h3>
                <div className="flex gap-1 bg-[var(--card-border)]/30 rounded-full p-1 flex-shrink-0">
                  <button
                    onClick={() => setComparePeriod('week')}
                    className={`px-4 py-1.5 rounded-full text-sm font-extrabold transition ${
                      comparePeriod === 'week' ? 'bg-emerald-500 text-white shadow-sm' : 'text-[var(--muted)]'
                    }`}
                  >
                    {t('social.thisWeek')}
                  </button>
                  <button
                    onClick={() => setComparePeriod('month')}
                    className={`px-4 py-1.5 rounded-full text-sm font-extrabold transition ${
                      comparePeriod === 'month' ? 'bg-emerald-500 text-white shadow-sm' : 'text-[var(--muted)]'
                    }`}
                  >
                    {t('social.thisMonth')}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                {(() => {
                  const maxKm = Math.max(...friendsCompare.map(r => r.km), 1);
                  return friendsCompare.slice(0, 20).map((r, i) => (
                    <Link
                      key={r.id}
                      href={r.isMe ? '/profile' : `/social/user?id=${r.id}`}
                      className="flex items-center gap-2"
                    >
                      <span className={`w-5 text-xs font-bold text-center ${i === 0 ? 'text-amber-500' : 'text-[var(--muted)]'}`}>{i + 1}</span>
                      <div className="w-7 h-7 rounded-full bg-[var(--card-border)] overflow-hidden flex-shrink-0">
                        {r.avatar ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.avatar} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[10px] font-bold text-[var(--muted)]">
                            {r.name.slice(0, 1)}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between">
                          <span className={`text-sm truncate ${r.isMe ? 'font-bold text-emerald-600' : 'font-medium text-[var(--foreground)]'}`}>
                            {r.name}{r.isMe ? ` (${t('social.me')})` : ''}
                          </span>
                          <span className="text-xs text-[var(--muted)] ml-2">{r.km.toFixed(1)}km</span>
                        </div>
                        <div className="mt-1 h-1.5 bg-[var(--card-border)] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${r.isMe ? 'bg-gradient-to-r from-emerald-400 to-emerald-600' : 'bg-emerald-400/70'}`}
                            style={{ width: `${(r.km / maxKm) * 100}%` }}
                          />
                        </div>
                      </div>
                    </Link>
                  ));
                })()}
              </div>
            </div>
          ) : (
            // build 138: empty state 를 /nearby 로 가는 Link 로 감쌈 (사용자 피드백 #1B).
            <Link
              href="/nearby"
              className="block card p-5 text-center bg-emerald-50/30 dark:bg-emerald-950/15 border-emerald-200/50 dark:border-emerald-900/40 active:scale-[0.99] transition"
            >
              <UserIcon size={28} className="mx-auto text-emerald-600 dark:text-emerald-400 mb-2" />
              <p className="text-sm font-bold text-[var(--foreground)]">{t('social.emptyFriendsTitle')}</p>
              <p className="text-xs text-[var(--muted)] mt-1">{t('social.emptyFriendsSub')}</p>
              <p className="mt-2 inline-flex items-center gap-0.5 text-[11px] font-extrabold text-emerald-600">
                {t('social.findFriendsCta')}
              </p>
            </Link>
          )}

          {/* 동네 러너 진입점 (build 116 A) */}
          <Link
            href="/nearby"
            className="block rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 p-4 active:scale-[0.99] shadow-md shadow-emerald-500/30"
          >
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center flex-shrink-0">
                <MapPin size={20} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-extrabold text-white">{t('social.nearbyTitle')}</p>
                <p className="text-xs text-white/85 mt-0.5">{t('social.nearbySub')}</p>
              </div>
              <span className="text-white text-base font-bold">→</span>
            </div>
          </Link>

          {/* 러너 찾기 */}
          <div>
            <h2 className="text-base font-bold text-[var(--foreground)] mb-3">{t('social.findRunners')}</h2>
            <div className="relative mb-3">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <input
                type="text"
                placeholder={t('social.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              />
            </div>
            {loading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
              </div>
            ) : users.length === 0 ? (
              <div className="card p-5 text-center">
                <p className="text-sm font-medium text-[var(--foreground)]">{searchQuery ? t('social.noMatchRunner') : t('social.noPublicRunner')}</p>
                <p className="text-xs text-[var(--muted)] mt-1">
                  {searchQuery
                    ? t('social.searchHintMatch')
                    : t('social.searchHintPublic')}
                </p>
              </div>
            ) : (
              <div className="card px-4 divide-y divide-[var(--card-border)]">
                {users.map((u) => (
                  <UserRow
                    key={u.id}
                    profile={u}
                    currentUserId={user?.id}
                    isFollowing={followingIds.has(u.id)}
                    onFollowToggle={(uid, f) => {
                      setFollowingIds((prev) => {
                        const next = new Set(prev);
                        f ? next.add(uid) : next.delete(uid);
                        return next;
                      });
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 클럽 탭 */}
      {activeSection === 'clubs' && (
        <div className="space-y-6">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-[var(--foreground)]">{t('social.myClubs')}</h2>
              <Link href="/social/clubs/create" className="flex items-center gap-1 text-sm text-emerald-600 font-semibold">
                <Plus size={14} /> {t('social.createClub')}
              </Link>
            </div>
            {myClubs.length === 0 ? (
              <div className="card p-6 text-center space-y-2">
                <div><AppLogo size={40} /></div>
                <p className="text-sm font-medium text-[var(--foreground)]">{t('social.noClub')}</p>
                <Link href="/social/clubs" className="text-sm text-emerald-600 font-semibold inline-block">
                  {t('social.browseClubs')}
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {myClubs.map((club) => (
                  <Link key={club.id} href={`/social/clubs/detail?id=${club.id}`} className="card p-4 flex items-center gap-3 block">
                    <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                      {club.logo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={club.logo_url} alt="" className="w-full h-full rounded-xl object-cover" />
                      ) : (
                        <Users size={20} className="text-emerald-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[var(--foreground)] truncate">{club.name}</p>
                      <p className="text-xs text-[var(--muted)]">{t('social.memberCount').replace('{count}', String(club.member_count))}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <Link href="/social/clubs" className="card p-4 flex items-center justify-between block">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                <Trophy size={18} className="text-emerald-500" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--foreground)]">{t('social.allClubs')}</p>
                <p className="text-xs text-[var(--muted)]">{t('social.allClubsSub')}</p>
              </div>
            </div>
            <span className="text-[var(--muted)]">→</span>
          </Link>
        </div>
      )}

      {/* 마일리지 탭은 /ranking 으로 이전 (build 100). */}

      {/* 포토 탭 — 신규 */}
      {activeSection === 'photos' && <PhotosTab />}

      {/* 명언 탭 (build 106) — 내 정보에서 이전, 트위터식 텍스트 피드 */}
      {activeSection === 'quotes' && <QuotesTab />}
      </div>
    </div>
  );
}

export default function SocialPage() {
  return (
    <Suspense fallback={<div className="p-8 flex justify-center"><div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" /></div>}>
      <SocialPageInner />
    </Suspense>
  );
}
