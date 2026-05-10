'use client';

// 소셜/랭킹 허브 — 4탭 구조 (내 랭킹 / 친구 / 클럽 / 포토)
// 2026-04-21 컨셉 피벗: 경쟁·소셜 중심. 포토 탭 신규 추가.

import { useState, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { searchUsers, fetchPublicUsers, getMyClubs, fetchFollowing } from '@/lib/social-data';
import { getSupabase } from '@/lib/supabase';
import UserRow from '@/components/social/UserRow';
import PhotosTab from '@/components/photos/PhotosTab';
import MileageRankingTab from '@/components/social/MileageRankingTab';
import { User as UserIcon, Users, Trophy, Search, Plus, MapPin, Camera, Sparkles, TrendingUp, Coins } from 'lucide-react';
import { startOfWeekStr } from '@/lib/kst';
import type { Profile, Club } from '@/types';
import AppLogo from '@/components/AppLogo';

const SECTIONS = [
  { id: 'me', label: '내 랭킹', Icon: Trophy },
  { id: 'friends', label: '친구', Icon: UserIcon },
  { id: 'clubs', label: '클럽', Icon: Users },
  { id: 'photos', label: '포토', Icon: Camera },
  { id: 'mileage', label: '마일리지', Icon: Coins },
] as const;

type SectionId = typeof SECTIONS[number]['id'];

interface HeroRank {
  scope_label: string;
  scope_type: string;
  rank_position: number;
  total_in_scope: number;
  my_km: number;
  km_to_next: number;
  target_rank: number;
  time_axis_out: string;
}

type TimeAxis = 'today' | 'month' | 'year';

function startOfWeek(): string {
  return startOfWeekStr();
}

function SocialPageInner() {
  const { user, profile } = useAuth();
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') as SectionId) ?? 'me';
  const [activeSection, setActiveSection] = useState<SectionId>(
    ['me', 'friends', 'clubs', 'photos'].includes(initialTab) ? initialTab : 'me'
  );
  const [axis, setAxis] = useState<TimeAxis>('month');
  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState<Profile[]>([]);
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [myClubs, setMyClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);
  const [heroRank, setHeroRank] = useState<HeroRank | null>(null);
  const [friendsCompare, setFriendsCompare] = useState<{ id: string; name: string; avatar: string | null; km: number; isMe: boolean }[]>([]);

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

      // 친구 + 나 이번 주 비교
      const supabase = getSupabase();
      const weekStart = startOfWeek();
      const friendIds = following.map(f => f.id);
      const allIds = [user.id, ...friendIds];
      const { data: acts } = await supabase
        .from('activities')
        .select('user_id, distance_km')
        .in('user_id', allIds)
        .gte('activity_date', weekStart);
      const kmMap = new Map<string, number>();
      (acts ?? []).forEach(a => kmMap.set(a.user_id, (kmMap.get(a.user_id) ?? 0) + Number(a.distance_km)));
      const rows = [
        { id: user.id, name: profile?.display_name ?? '나', avatar: profile?.avatar_url ?? null, km: kmMap.get(user.id) ?? 0, isMe: true },
        ...following.map(f => ({ id: f.id, name: f.display_name, avatar: f.avatar_url, km: kmMap.get(f.id) ?? 0, isMe: false })),
      ].sort((a, b) => b.km - a.km);
      setFriendsCompare(rows);
    } catch (e) {
      console.warn('[Social] load 실패', e);
    } finally {
      setLoading(false);
    }
  }, [user, profile]);

  // 히어로 랭킹 — 시간축 변경 시 재조회
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data } = await supabase.rpc('find_hero_rank', {
          target_user_id: user.id,
          time_axis: axis,
        });
        const row = Array.isArray(data) ? data[0] : data;
        if (!cancelled) setHeroRank(row ? row as HeroRank : null);
      } catch (e) {
        console.warn('[Social] hero 실패', e);
      }
    })();
    return () => { cancelled = true; };
  }, [user, axis]);

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

  const name = profile?.display_name ?? '러너';

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      {/* Sticky Header */}
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="px-4 py-3">
          <h1 className="text-xl font-extrabold tracking-tight">소셜</h1>
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
            {section.label}
          </button>
        ))}
      </div>

      {/* 내 랭킹 — 히어로 상세 + 시간축 + 진행형 메시지 (그린 테마) */}
      {activeSection === 'me' && (
        <div className="space-y-5">
          {/* 시간축 */}
          <div className="flex gap-2">
            {(['today', 'month', 'year'] as TimeAxis[]).map(a => (
              <button
                key={a}
                onClick={() => setAxis(a)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
                  axis === a
                    ? 'bg-emerald-500 text-white shadow-sm'
                    : 'bg-[var(--card-bg)] text-[var(--muted)] border border-[var(--card-border)]'
                }`}
              >
                {a === 'today' ? '🔥 오늘' : a === 'month' ? '📅 이달' : '🏆 올해'}
              </button>
            ))}
          </div>

          {/* 내 순위 카드 */}
          {heroRank ? (
            <div className="rounded-3xl bg-gradient-to-br from-emerald-100/80 via-white to-emerald-50/40 dark:from-emerald-950/40 dark:via-zinc-900 dark:to-emerald-950/10 p-6 shadow-sm border border-emerald-200/60 dark:border-emerald-900/30">
              <p className="text-sm text-[var(--muted)]">
                <span className="font-bold text-emerald-700 dark:text-emerald-400">{name}</span>님은 <span className="font-semibold">{heroRank.scope_label}</span>에서
              </p>
              <div className="flex items-baseline gap-1 mt-1.5">
                <span className={`text-7xl font-extrabold leading-none ${
                  heroRank.rank_position <= 3 ? 'text-emerald-600'
                  : heroRank.rank_position <= 10 ? 'text-emerald-500'
                  : 'text-[var(--foreground)]'
                }`}>
                  {heroRank.rank_position}
                </span>
                <span className="text-3xl font-bold text-[var(--foreground)]">위</span>
                <span className="text-base text-[var(--muted)] ml-2">/ {heroRank.total_in_scope}명</span>
              </div>
              <p className="text-base text-[var(--muted)] mt-2">
                {axis === 'today' ? '오늘' : axis === 'month' ? '이달' : '올해'} <span className="font-bold text-[var(--foreground)]">{Number(heroRank.my_km).toFixed(1)}km</span>
              </p>

              {heroRank.rank_position === 1 ? (
                <div className="mt-4 rounded-2xl bg-white/80 dark:bg-zinc-900/70 backdrop-blur px-4 py-3.5">
                  <p className="text-base font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                    <Sparkles size={18} /> {axis === 'today' ? '오늘의' : axis === 'month' ? '이달의' : '올해의'} 1위! 🎉
                  </p>
                </div>
              ) : heroRank.km_to_next > 0 && (
                <div className="mt-4 rounded-2xl bg-white/80 dark:bg-zinc-900/70 backdrop-blur px-4 py-3.5 flex items-center gap-2">
                  <TrendingUp size={18} className="text-emerald-600" />
                  <p className="text-base font-semibold text-[var(--foreground)]">
                    <span className="text-emerald-700 dark:text-emerald-400 font-extrabold">{Number(heroRank.km_to_next).toFixed(1)}km</span> 더 달리면{' '}
                    <span className="text-emerald-700 dark:text-emerald-400 font-extrabold">{heroRank.target_rank}위</span>로 올라가요!
                  </p>
                </div>
              )}
            </div>
          ) : (
            <Link href="/profile/edit" className="block rounded-3xl bg-gradient-to-br from-emerald-100/80 to-emerald-50/40 p-6 shadow-sm border border-emerald-200/60">
              <p className="text-lg font-bold text-[var(--foreground)]">내 조건 입력하고 랭킹 보기 →</p>
              <p className="text-sm text-[var(--muted)] mt-1">지역·출생년도·성별을 설정하면 비슷한 러너 중 내 위치가 보여요</p>
            </Link>
          )}

          {/* 지역 랭킹 상세 이동 */}
          <Link href="/social/rankings" className="card p-4 flex items-center justify-between active:scale-[0.99]">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <MapPin size={20} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-base font-semibold text-[var(--foreground)]">지역 랭킹 상세</p>
                <p className="text-sm text-[var(--muted)]">국가 · 시 · 구 세분화</p>
              </div>
            </div>
            <span className="text-[var(--muted)]">→</span>
          </Link>
        </div>
      )}

      {/* 친구 탭 */}
      {activeSection === 'friends' && (
        <div className="space-y-6">
          {friendsCompare.length > 1 ? (
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-[var(--foreground)]">이번 주 친구 비교</h3>
                <span className="text-[10px] text-[var(--muted)]">월요일 기준</span>
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
                            {r.name}{r.isMe ? ' (나)' : ''}
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
            <div className="card p-5 text-center">
              <UserIcon size={28} className="mx-auto text-[var(--muted)] mb-2" />
              <p className="text-sm font-medium text-[var(--foreground)]">친구와 함께 달려보세요</p>
              <p className="text-xs text-[var(--muted)] mt-1">아래에서 러너를 찾아 친구로 추가하면 이번 주 km 비교를 볼 수 있어요</p>
            </div>
          )}

          {/* 러너 찾기 */}
          <div>
            <h2 className="text-base font-bold text-[var(--foreground)] mb-3">러너 찾기</h2>
            <div className="relative mb-3">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <input
                type="text"
                placeholder="닉네임으로 검색"
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
                <p className="text-sm font-medium text-[var(--foreground)]">{searchQuery ? '해당 닉네임의 러너가 없어요' : '아직 공개된 러너가 없어요'}</p>
                <p className="text-xs text-[var(--muted)] mt-1">
                  {searchQuery
                    ? '다른 닉네임으로 검색해보거나, 친구를 Routinist 에 초대해보세요'
                    : '친구가 Routinist 에 가입하면 여기 나타납니다'}
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
              <h2 className="text-base font-semibold text-[var(--foreground)]">내 클럽</h2>
              <Link href="/social/clubs/create" className="flex items-center gap-1 text-sm text-emerald-600 font-semibold">
                <Plus size={14} /> 클럽 만들기
              </Link>
            </div>
            {myClubs.length === 0 ? (
              <div className="card p-6 text-center space-y-2">
                <div><AppLogo size={40} /></div>
                <p className="text-sm font-medium text-[var(--foreground)]">아직 가입한 클럽이 없습니다</p>
                <Link href="/social/clubs" className="text-sm text-emerald-600 font-semibold inline-block">
                  클럽 둘러보기 →
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
                      <p className="text-xs text-[var(--muted)]">멤버 {club.member_count}명</p>
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
                <p className="text-sm font-semibold text-[var(--foreground)]">모든 클럽 둘러보기</p>
                <p className="text-xs text-[var(--muted)]">인기 클럽 · 가입하기</p>
              </div>
            </div>
            <span className="text-[var(--muted)]">→</span>
          </Link>
        </div>
      )}

      {/* 마일리지 탭 (build 62) */}
      {activeSection === 'mileage' && <MileageRankingTab />}

      {/* 포토 탭 — 신규 */}
      {activeSection === 'photos' && <PhotosTab />}
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
