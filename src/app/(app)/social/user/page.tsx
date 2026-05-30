'use client';

// 유저 프로필 페이지 — build 67 확장.
// 포토 카드/리스트에서 ID 탭하면 들어오는 미니 프로필. 다음을 보여줌:
//  - 기본 정보 (이름, 지역, bio)
//  - 친구 추가/해제 (자기 자신 제외)
//  - 이달 거리/회수 + 통산 + 연속일
//  - 개인 베스트 (최장거리/최빠페이스/최장시간)
//  - 이달 미니 캘린더 (히트맵)
//  - 최근 30일 일별 거리 그래프
//  - 배지 (Routinist 표준 마일스톤)
//  - 액션: 쪽지 보내기 / 마일리지 선물

import { useEffect, useState, Suspense, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, UserPlus, Check, MapPin, MessageCircle, Gift, Trophy, Award, Edit3 } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';
import { followUser, unfollowUser, isFollowing } from '@/lib/social-data';
import { getOrCreateConversation } from '@/lib/message-data';
import { PUBLIC_PROFILE_FIELDS } from '@/lib/profile-fields';
import type { Profile } from '@/types';
import AppLogo from '@/components/AppLogo';
import AppToast from '@/components/AppToast';
import GenderBadge from '@/components/profile/GenderBadge';
import AchievementsCard from '@/components/profile/AchievementsCard';
import { logClientWarn } from '@/lib/error-logger';
import { daysAgoStr, toLocalMonthStr, toLocalDateStr } from '@/lib/kst';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { dataCache, CACHE_KEYS } from '@/lib/data-cache';
import { useI18n, formatRank } from '@/lib/i18n';
import dynamic from 'next/dynamic';
import { X as XIcon } from 'lucide-react';
import type { GeoJSONLineString } from '@/types';

const RouteMap = dynamic(() => import('@/components/map/RouteMap'), { ssr: false });

interface MonthStats {
  monthly_km: number;
  run_count: number;
}

interface ActivityRow {
  id: string;
  activity_date: string;
  distance_km: number;
  duration_seconds: number | null;
  pace_avg_sec_per_km: number | null;
  calories: number | null;
  route_data: GeoJSONLineString | null;
  source: string;
}

// 5단계 컬러 — 홈 캘린더와 동일 룰
function calColor(km: number): string {
  if (km <= 0) return 'bg-gray-100 dark:bg-zinc-800/50';
  if (km < 3) return 'bg-green-200 dark:bg-green-900/40';
  if (km < 7) return 'bg-green-400 dark:bg-green-700/60';
  if (km < 10) return 'bg-green-500 dark:bg-green-600/70';
  if (km < 15) return 'bg-green-600 dark:bg-green-500/80';
  return 'bg-green-800 dark:bg-green-400/90';
}

function formatPace(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}'${String(s).padStart(2, '0')}"`;
}

function formatDur(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function UserProfileContent() {
  const searchParams = useSearchParams();
  const userId = searchParams.get('id') ?? '';
  const { user } = useAuth();
  const { locale } = useI18n();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<MonthStats>({ monthly_km: 0, run_count: 0 });
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    // 캐시 — 같은 사람을 여러 사진에서 들어가도 즉시 표시.
    const cacheKey = `user:profile:${userId}`;
    const cached = dataCache.get<{ profile: Profile | null; activities: ActivityRow[]; following: boolean }>(cacheKey);
    if (cached) {
      setProfile(cached.value.profile);
      setActivities(cached.value.activities);
      setFollowing(cached.value.following);
      // KST 룰: toISOString().slice(0,7) 은 UTC 기준이라 KST 새벽에 전월로 떨어짐. toLocalMonthStr 사용.
      const ym = toLocalMonthStr();
      const monthlyKm = cached.value.activities
        .filter(a => a.activity_date.startsWith(ym))
        .reduce((s, a) => s + Number(a.distance_km), 0);
      const monthlyRuns = cached.value.activities.filter(a => a.activity_date.startsWith(ym)).length;
      setStats({ monthly_km: monthlyKm, run_count: monthlyRuns });
      setLoading(false);
    }
    (async () => {
      try {
        const supabase = getSupabase();
        const [{ data: p }, followStatus] = await Promise.all([
          supabase.from('profiles').select(PUBLIC_PROFILE_FIELDS).eq('id', userId).maybeSingle(),
          user && user.id !== userId ? isFollowing(userId) : Promise.resolve(false),
        ]);
        setProfile((p as Profile | null) ?? null);
        setFollowing(followStatus);

        // 최근 60일 데이터 (이달 캘린더 + 최근 30일 그래프 + PB 모두 커버).
        const sixtyDaysAgo = daysAgoStr(60);
        const { data: acts } = await supabase
          .from('activities')
          .select('id, activity_date, distance_km, duration_seconds, pace_avg_sec_per_km, calories, route_data, source')
          .eq('user_id', userId)
          .gte('activity_date', sixtyDaysAgo)
          .eq('visibility', 'public')
          .order('activity_date', { ascending: false });
        const list = (acts ?? []) as ActivityRow[];
        setActivities(list);

        const ymPrefix = toLocalMonthStr();
        const monthly = list.filter(a => a.activity_date.startsWith(ymPrefix));
        const km = monthly.reduce((s, a) => s + Number(a.distance_km), 0);
        setStats({ monthly_km: km, run_count: monthly.length });

        dataCache.set(cacheKey, {
          profile: (p as Profile | null) ?? null,
          activities: list,
          following: followStatus,
        });
      } catch (e) {
        console.warn('[UserProfile] 조회 실패', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [userId, user]);

  const handleToggleFollow = async () => {
    if (!user || toggling) return;
    const next = !following;
    setToggling(true);
    setFollowing(next); // optimistic
    try {
      if (next) {
        await followUser(userId);
        setToast({ text: '친구로 추가했어요', tone: 'ok' });
      } else {
        await unfollowUser(userId);
        setToast({ text: '친구에서 해제했어요', tone: 'ok' });
      }
    } catch (e) {
      setFollowing(!next); // 롤백
      const msg = e instanceof Error ? e.message : String(e);
      logClientWarn('UserProfile', 'follow toggle 실패', { userId, action: next ? 'follow' : 'unfollow', reason: msg });
      const friendly =
        msg.includes('duplicate key') || msg.includes('unique') ? '이미 친구로 추가했어요' :
        msg.includes('foreign key') ? '존재하지 않는 사용자예요' :
        msg.includes('row-level security') || msg.includes('permission') ? '권한이 없어요. 다시 로그인해보세요' :
        `친구 ${next ? '추가' : '해제'} 실패 — ${msg.slice(0, 80)}`;
      setToast({ text: friendly, tone: 'warn' });
    } finally {
      setToggling(false);
    }
  };

  // 이달 미니 캘린더 데이터
  const calendarData = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const distMap = new Map<string, number>();
    activities.forEach(a => {
      distMap.set(a.activity_date, (distMap.get(a.activity_date) || 0) + Number(a.distance_km));
    });
    return { year, month, firstDay, daysInMonth, distMap };
  }, [activities]);

  // 최근 30일 그래프
  const dailyData = useMemo(() => {
    const map = new Map<string, number>();
    activities.forEach(a => {
      map.set(a.activity_date, (map.get(a.activity_date) || 0) + Number(a.distance_km));
    });
    const out: { label: string; distance: number }[] = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = toLocalDateStr(d);
      out.push({
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        distance: Math.round((map.get(key) || 0) * 10) / 10,
      });
    }
    return out;
  }, [activities]);

  // 개인 베스트 (최근 60일 한정 — 미니 프로필 용도, 정확도보다 응답 속도)
  const personalBest = useMemo(() => {
    if (!activities.length) return null;
    let longest = activities[0];
    let fastest: ActivityRow | null = null;
    let longestDur: ActivityRow | null = null;
    for (const a of activities) {
      if (Number(a.distance_km) > Number(longest.distance_km)) longest = a;
      if (a.pace_avg_sec_per_km && Number(a.distance_km) >= 1) {
        if (!fastest || a.pace_avg_sec_per_km < fastest.pace_avg_sec_per_km!) fastest = a;
      }
      if (a.duration_seconds && (!longestDur || a.duration_seconds > longestDur.duration_seconds!)) {
        longestDur = a;
      }
    }
    return { longest, fastest, longestDur };
  }, [activities]);

  // 배지 — 통산 거리/횟수 기반
  const badges = useMemo(() => {
    const list: { icon: string; label: string }[] = [];
    const totalKm = Number(profile?.total_distance_km ?? 0);
    const totalRuns = profile?.total_runs ?? 0;
    if (totalKm >= 10) list.push({ icon: '🏅', label: '10km' });
    if (totalKm >= 50) list.push({ icon: '🎖️', label: '50km' });
    if (totalKm >= 100) list.push({ icon: '🏆', label: '100km' });
    if (totalKm >= 500) list.push({ icon: '💎', label: '500km' });
    if (totalKm >= 1000) list.push({ icon: '👑', label: '1000km' });
    if (totalRuns >= 10) list.push({ icon: '🔥', label: '10×' });
    if (totalRuns >= 50) list.push({ icon: '⚡', label: '50×' });
    return list;
  }, [profile]);

  if (!userId) {
    return (
      <div className="p-4 max-w-lg mx-auto">
        <button onClick={() => router.back()} className="inline-flex items-center gap-2 text-[var(--muted)] mb-4">
          <ArrowLeft size={20} /> 뒤로
        </button>
        <p className="text-center text-[var(--muted)] mt-8">잘못된 접근입니다</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-4 max-w-lg mx-auto flex justify-center pt-16">
        <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="p-4 max-w-lg mx-auto">
        <button onClick={() => router.back()} className="inline-flex items-center gap-2 text-[var(--muted)] mb-4">
          <ArrowLeft size={20} /> 뒤로
        </button>
        <p className="text-center text-[var(--muted)] mt-8">유저를 찾을 수 없어요</p>
      </div>
    );
  }

  const isMe = user?.id === userId;
  const regionLabel = [profile.region_si, profile.region_gu].filter(Boolean).join(' ');

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      {/* Sticky Header */}
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-extrabold tracking-tight">프로필</h1>
        </div>
      </header>

      <div className="p-4 space-y-4">
      {/* 프로필 헤더 */}
      <div className="card p-5">
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-full bg-[var(--card-border)] overflow-hidden flex-shrink-0">
            {profile.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center"><AppLogo size={40} /></div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-[var(--foreground)] truncate inline-flex items-center gap-1.5">
              {profile.display_name}
              <GenderBadge
                gender={profile.gender as 'male' | 'female' | null | undefined}
                show={(profile as { show_gender?: boolean }).show_gender ?? true}
                size={16}
              />
            </h1>
            {regionLabel && (
              <p className="text-xs text-[var(--muted)] flex items-center gap-1 mt-1">
                <MapPin size={12} /> {regionLabel}
              </p>
            )}
            {profile.bio && <p className="text-sm text-[var(--muted)] mt-1 line-clamp-2">{profile.bio}</p>}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 text-center mt-5 pt-5 border-t border-[var(--card-border)]">
          <div>
            <p className="text-2xl font-bold text-[var(--accent)]">{stats.monthly_km.toFixed(1)}</p>
            <p className="text-xs text-[var(--muted)]">이달 km</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-[var(--foreground)]">{stats.run_count}</p>
            <p className="text-xs text-[var(--muted)]">이달 러닝</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-purple-600">{(profile.total_distance_km ?? 0).toFixed(0)}</p>
            <p className="text-xs text-[var(--muted)]">통산 km</p>
          </div>
        </div>
      </div>

      {/* 액션 — 친구 / 쪽지 / 마일리지 선물.
          본인 프로필이면 자리만 채워 "내 정보 편집" 버튼 단일로 노출 (사용자가 액션이 안 보인다고 혼동하지 않게).
          로그인 안 된 게스트면 영역 자체 숨김. */}
      {user && (isMe ? (
        <Link
          href="/profile/edit"
          className="flex items-center justify-center gap-2 py-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-sm font-semibold border border-emerald-200/60 dark:border-emerald-900/40 active:scale-95 transition"
        >
          <Edit3 size={16} />
          <span>내 정보 편집</span>
        </Link>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={handleToggleFollow}
            disabled={toggling}
            aria-label={following ? '친구 해제' : '친구 추가'}
            className={`flex flex-col items-center justify-center gap-1 py-3 rounded-2xl text-sm font-semibold transition-all disabled:opacity-50 active:scale-95 ${
              following
                ? 'bg-emerald-500 text-white shadow-sm'
                : 'bg-white dark:bg-zinc-900 border border-emerald-500 text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {following ? <Check size={20} strokeWidth={3} /> : <UserPlus size={20} strokeWidth={2.5} />}
            <span className="text-xs">{following ? '친구' : '친구 추가'}</span>
          </button>
          <button
            onClick={async () => {
              if (!user) return;
              try {
                const conv = await getOrCreateConversation(userId);
                router.push(`/messages/chat?id=${conv.id}`);
              } catch (e) {
                logClientWarn('UserProfile', '쪽지 시작 실패', { userId, err: String(e) });
                setToast({ text: '쪽지를 시작할 수 없어요', tone: 'warn' });
              }
            }}
            className="flex flex-col items-center justify-center gap-1 py-3 rounded-2xl bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 text-sm font-semibold active:scale-95 transition"
          >
            <MessageCircle size={20} />
            <span className="text-xs">쪽지</span>
          </button>
          <Link
            href={`/mileage/gift`}
            className="flex flex-col items-center justify-center gap-1 py-3 rounded-2xl bg-pink-50 dark:bg-pink-950/30 text-pink-700 dark:text-pink-300 text-sm font-semibold active:scale-95 transition"
          >
            <Gift size={20} />
            <span className="text-xs">마일리지</span>
          </Link>
        </div>
      ))}

      {/* 친구 이번 주 회고 (build 130) */}
      <FriendWeeklyRecap userId={profile.id} />

      {/* Achievement 배지 (build 129) */}
      <AchievementsCard userId={profile.id} />

      {/* 친구 이달 랭킹·목표 (build 161 #8-2) — 친구 프로필에 부족했던 컨텍스트 보강 */}
      <FriendRankingBlock userId={profile.id} monthlyKm={stats.monthly_km} />

      {/* 친구 월드런 코스 (build 130) */}
      <FriendCoursesCard userId={profile.id} />

      {/* 친구 30일 활동 막대그래프 (build 124) */}
      <FriendActivityChart userId={profile.id} />

      {/* build 156: 30일 캘린더 제거 — 아래 달력보기와 중복 (사용자 피드백) */}

      {/* 친구 최근 7일 GPS 미니맵 (build 125) — 누르면 친구 지도 페이지 */}
      <FriendMiniMap userId={profile.id} />

      {/* 배지 */}
      {badges.length > 0 && (
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Award size={16} className="text-yellow-500" />
            <h3 className="text-base font-semibold text-[var(--foreground)]">배지</h3>
            <span className="text-xs text-[var(--muted)]">{badges.length}</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {badges.map(b => (
              <div key={b.label} className="flex items-center gap-1.5 bg-amber-50 dark:bg-amber-950/30 rounded-full px-3 py-1.5 flex-shrink-0">
                <span>{b.icon}</span>
                <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">{b.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 개인 베스트 (최근 60일 기준) */}
      {personalBest && personalBest.longest && (
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Trophy size={16} className="text-yellow-500" />
            <h3 className="text-base font-semibold text-[var(--foreground)]">최근 베스트</h3>
            <span className="text-xs text-[var(--muted)]">최근 60일</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-[var(--card-border)]/30 rounded-xl p-3 text-center">
              <p className="text-xs text-[var(--muted)]">최장 거리</p>
              <p className="text-lg font-extrabold text-[var(--foreground)] mt-0.5">{Number(personalBest.longest.distance_km).toFixed(1)}km</p>
            </div>
            <div className="bg-[var(--card-border)]/30 rounded-xl p-3 text-center">
              <p className="text-xs text-[var(--muted)]">최빠 페이스</p>
              <p className="text-lg font-extrabold text-[var(--foreground)] mt-0.5">
                {personalBest.fastest?.pace_avg_sec_per_km ? formatPace(personalBest.fastest.pace_avg_sec_per_km) : '—'}
              </p>
            </div>
            <div className="bg-[var(--card-border)]/30 rounded-xl p-3 text-center">
              <p className="text-xs text-[var(--muted)]">최장 시간</p>
              <p className="text-lg font-extrabold text-[var(--foreground)] mt-0.5">
                {personalBest.longestDur?.duration_seconds ? formatDur(personalBest.longestDur.duration_seconds) : '—'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 이달 미니 캘린더 */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-[var(--foreground)]">{calendarData.month}월 캘린더</h3>
          <span className="text-xs text-[var(--muted)]">
            {Array.from({ length: calendarData.daysInMonth }).reduce<number>((acc, _, i) => {
              const day = i + 1;
              const ds = `${calendarData.year}-${String(calendarData.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              return acc + ((calendarData.distMap.get(ds) ?? 0) > 0 ? 1 : 0);
            }, 0)}일 러닝
          </span>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs mb-1">
          {['일','월','화','수','목','금','토'].map((d, i) => (
            <span key={d} className={`${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-[var(--muted)]'}`}>{d}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: calendarData.firstDay }).map((_, i) => (
            <div key={`e-${i}`} className="aspect-square" />
          ))}
          {Array.from({ length: calendarData.daysInMonth }).map((_, i) => {
            const day = i + 1;
            const ds = `${calendarData.year}-${String(calendarData.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const km = calendarData.distMap.get(ds) || 0;
            const clickable = km > 0;
            return (
              <button
                key={day}
                onClick={() => clickable && setSelectedDate(ds)}
                disabled={!clickable}
                className={`aspect-square rounded-md flex items-center justify-center ${calColor(km)} ${clickable ? 'active:scale-90 transition-transform' : 'cursor-default'}`}
                aria-label={clickable ? `${calendarData.month}월 ${day}일 ${km.toFixed(1)}km 보기` : undefined}
              >
                <span className={`text-xs font-medium ${km >= 7 ? 'text-white' : 'text-[var(--foreground)]'}`}>{day}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 최근 30일 일별 거리 그래프 */}
      {dailyData.some(d => d.distance > 0) && (
        <div className="card p-4">
          <h3 className="text-base font-semibold text-[var(--foreground)] mb-2">최근 30일 일별 거리</h3>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={dailyData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval={4} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'var(--card)', border: '1px solid var(--card-border)', borderRadius: 12, fontSize: 12 }}
                formatter={(value) => [`${value}km`]}
              />
              <Bar dataKey="distance" fill="#10B981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2500} />}

      {/* 활동 상세 모달 — 친구 캘린더 셀 클릭 시 (사용자 피드백 #6).
          하루에 여러 번 달린 경우 모든 활동을 vertical stack 으로 표시.
          visibility='public' 활동만 fetch 됐으니 RLS 검증 완료. */}
      {selectedDate && (() => {
        const dayActivities = activities
          .filter(a => a.activity_date === selectedDate)
          .sort((a, b) => Number(b.distance_km) - Number(a.distance_km));
        const totalKm = dayActivities.reduce((s, a) => s + Number(a.distance_km), 0);
        return (
          <div
            className="fixed inset-0 z-[80] bg-black/70 flex items-end sm:items-center justify-center sm:p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setSelectedDate(null); }}
          >
            <div className="bg-[var(--background)] rounded-t-3xl sm:rounded-2xl max-w-md w-full overflow-hidden max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between pl-5 pr-2 py-3 border-b border-[var(--card-border)]">
                <div>
                  <h3 className="text-base font-bold text-[var(--foreground)]">
                    {new Date(selectedDate).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
                  </h3>
                  <p className="text-xs text-[var(--muted)]">
                    {profile?.display_name}님의 러닝{dayActivities.length > 1 ? ` · ${dayActivities.length}회` : ''}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedDate(null)}
                  aria-label="닫기"
                  className="p-3 -mr-1 text-[var(--muted)] active:scale-90 active:bg-[var(--card)] rounded-full transition"
                >
                  <XIcon size={24} strokeWidth={2.5} />
                </button>
              </div>
              <div className="overflow-y-auto p-4 space-y-4">
                {/* 합계 거리 (다중 활동이면 합계, 단일이면 그 값) */}
                <div className="text-center py-2">
                  <p className="text-5xl font-extrabold text-emerald-500">{totalKm.toFixed(2)}</p>
                  <p className="text-sm text-[var(--muted)] mt-1">
                    {dayActivities.length > 1 ? '킬로미터 (합계)' : '킬로미터'}
                  </p>
                </div>
                {/* 활동별 카드 — 단일이면 1개, 다중이면 stack */}
                {dayActivities.map((act, idx) => (
                  <div key={act.id} className="space-y-3">
                    {dayActivities.length > 1 && (
                      <div className="flex items-center gap-2 px-1">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500 text-white text-xs font-bold">
                          {idx + 1}
                        </span>
                        <span className="text-sm font-semibold text-[var(--foreground)]">
                          {Number(act.distance_km).toFixed(2)}km
                        </span>
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="card p-3">
                        <p className="text-xs text-[var(--muted)]">시간</p>
                        <p className="text-lg font-bold text-[var(--foreground)] mt-1">
                          {act.duration_seconds ? formatDur(act.duration_seconds) : '—'}
                        </p>
                      </div>
                      <div className="card p-3">
                        <p className="text-xs text-[var(--muted)]">페이스</p>
                        <p className="text-lg font-bold text-[var(--foreground)] mt-1">
                          {act.pace_avg_sec_per_km ? formatPace(act.pace_avg_sec_per_km) : '—'}
                        </p>
                      </div>
                      <div className="card p-3">
                        <p className="text-xs text-[var(--muted)]">칼로리</p>
                        <p className="text-lg font-bold text-[var(--foreground)] mt-1">
                          {act.calories ? `${act.calories}` : '—'}
                        </p>
                      </div>
                    </div>
                    {act.route_data?.coordinates?.length ? (
                      <RouteMap routeData={act.route_data} height="240px" />
                    ) : (
                      <div className="card p-4 text-center text-xs text-[var(--muted)]">
                        GPS 경로 데이터가 없는 기록이에요
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
      </div>
    </div>
  );
}

export default function UserProfilePage() {
  return (
    <Suspense fallback={
      <div className="p-4 max-w-lg mx-auto flex justify-center pt-16">
        <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
      </div>
    }>
      <UserProfileContent />
    </Suspense>
  );
}

// ── 친구 이번 주 회고 (build 130) ─────────────
function FriendWeeklyRecap({ userId }: { userId: string }) {
  const [recap, setRecap] = useState<{ week_km: number; week_runs: number; week_longest: number; week_avg_pace: number | null; month_km: number; month_runs: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const supabase = getSupabase();
        const { data } = await supabase.rpc('fetch_user_weekly_recap', { p_user_id: userId });
        setRecap(data as typeof recap);
      } catch { /* ignore */ } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  if (loading) return <div className="card p-4 h-28 animate-pulse" />;
  if (!recap || (recap.week_runs === 0 && recap.month_runs === 0)) return null;

  const paceStr = recap.week_avg_pace ? `${Math.floor(recap.week_avg_pace / 60)}'${String(Math.round(recap.week_avg_pace % 60)).padStart(2, '0')}"` : '—';

  return (
    <div className="card p-4">
      <div className="flex items-center gap-1.5 mb-3">
        <Trophy size={14} className="text-emerald-500" />
        <h3 className="text-sm font-extrabold">이번 주 · 이번 달</h3>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-emerald-50/60 dark:bg-emerald-950/20 p-3">
          <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">이번 주</p>
          <p className="text-xl font-extrabold text-[var(--foreground)] mt-0.5 tabular-nums">{Number(recap.week_km).toFixed(1)}<span className="text-xs ml-0.5">km</span></p>
          <p className="text-[11px] text-[var(--muted)] mt-0.5 font-bold">
            {recap.week_runs}회 · 최장 {Number(recap.week_longest).toFixed(1)}km · {paceStr}/km
          </p>
        </div>
        <div className="rounded-xl bg-amber-50/60 dark:bg-amber-950/20 p-3">
          <p className="text-[10px] font-bold text-amber-700 dark:text-amber-300">이번 달</p>
          <p className="text-xl font-extrabold text-[var(--foreground)] mt-0.5 tabular-nums">{Number(recap.month_km).toFixed(1)}<span className="text-xs ml-0.5">km</span></p>
          <p className="text-[11px] text-[var(--muted)] mt-0.5 font-bold">{recap.month_runs}회</p>
        </div>
      </div>
    </div>
  );
}

// ── 친구 월드런 코스 (build 130) ─────────────
function FriendCoursesCard({ userId }: { userId: string }) {
  const [list, setList] = useState<{ course_id: string; name: string; country: string | null; distance_km: number; started_at: string; completed_at: string | null }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const supabase = getSupabase();
        const { data } = await supabase.rpc('fetch_user_courses_public', { p_user_id: userId });
        setList((data ?? []) as typeof list);
      } catch { /* ignore */ } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  if (loading) return null;
  if (list.length === 0) return null;

  const completed = list.filter(c => c.completed_at).length;

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-base">🌍</span>
          <h3 className="text-sm font-extrabold">월드마라톤 도전</h3>
        </div>
        <span className="text-xs font-bold text-emerald-600 tabular-nums">완주 {completed} / {list.length}</span>
      </div>
      <div className="space-y-1.5">
        {list.slice(0, 5).map(c => {
          const done = !!c.completed_at;
          return (
            <div key={c.course_id} className={`flex items-center gap-2.5 px-2 py-2 rounded-lg ${done ? 'bg-amber-50/60 dark:bg-amber-950/20' : 'bg-[var(--card-border)]/20'}`}>
              <span className={done ? 'text-amber-500' : 'text-[var(--muted)]'}>{done ? '🏆' : '🏃'}</span>
              <span className="flex-1 text-sm font-bold truncate">{c.name}</span>
              <span className="text-xs text-[var(--muted)] font-bold">{Number(c.distance_km).toFixed(1)}km</span>
            </div>
          );
        })}
        {list.length > 5 && <p className="text-[10px] text-[var(--muted)] text-center mt-1">+ {list.length - 5}개 더</p>}
      </div>
    </div>
  );
}

// ── 친구 30일 컬러 캘린더 (build 126) ─────────────
function FriendCalendarCard({ userId }: { userId: string }) {
  const [rows, setRows] = useState<{ activity_date: string; distance_km: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const supabase = getSupabase();
        const { data } = await supabase.rpc('fetch_user_recent_routes', { p_user_id: userId, p_days: 30 });
        setRows((data ?? []) as typeof rows);
      } catch { /* ignore */ } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  if (loading) return <div className="card p-4 h-32 animate-pulse" />;
  if (rows.length === 0) return null;

  // 30일 그리드 + 일별 km 합
  const today = new Date();
  const cells: { date: string; km: number; isToday: boolean }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const ymd = d.toISOString().slice(0, 10);
    const km = rows.filter(r => r.activity_date === ymd).reduce((s, r) => s + Number(r.distance_km), 0);
    cells.push({ date: ymd, km, isToday: i === 0 });
  }

  // 첫 셀의 요일에 맞춰 padding (일=0)
  const firstWeekday = new Date(cells[0].date).getDay();
  const padded: ({ date: string; km: number; isToday: boolean } | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...cells,
  ];

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <Trophy size={14} className="text-emerald-500" />
          <h3 className="text-sm font-extrabold">30일 캘린더</h3>
        </div>
        <span className="text-xs font-bold text-emerald-600 tabular-nums">{rows.length}회</span>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {['일','월','화','수','목','금','토'].map(d => (
          <div key={d} className={`text-center text-[10px] font-bold ${d === '일' ? 'text-rose-500' : d === '토' ? 'text-blue-500' : 'text-[var(--muted)]'}`}>{d}</div>
        ))}
        {padded.map((c, i) => {
          if (!c) return <div key={i} className="aspect-square" />;
          return (
            <div
              key={i}
              className={`aspect-square rounded-md flex flex-col items-center justify-center text-[10px] font-bold ${
                c.km === 0
                  ? 'bg-[var(--card-border)]/20 text-[var(--muted)]'
                  : c.km < 3
                    ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                    : c.km < 7
                      ? 'bg-emerald-300/70 dark:bg-emerald-700/60 text-emerald-900 dark:text-emerald-100'
                      : c.km < 15
                        ? 'bg-emerald-500 text-white'
                        : 'bg-emerald-700 text-white'
              } ${c.isToday ? 'ring-2 ring-amber-400' : ''}`}
              title={`${c.date} · ${c.km.toFixed(1)}km`}
            >
              <span className="text-[9px] opacity-70">{new Date(c.date).getDate()}</span>
              {c.km > 0 && <span className="text-[10px] tabular-nums">{c.km.toFixed(0)}</span>}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-end gap-1.5 mt-2 text-[10px] text-[var(--muted)] font-bold">
        <span>적음</span>
        <span className="w-3 h-3 rounded-sm bg-emerald-100 dark:bg-emerald-900/30" />
        <span className="w-3 h-3 rounded-sm bg-emerald-300/70" />
        <span className="w-3 h-3 rounded-sm bg-emerald-500" />
        <span className="w-3 h-3 rounded-sm bg-emerald-700" />
        <span>많음</span>
      </div>
    </div>
  );
}

// ── 친구 이달 랭킹·목표 (build 161 #8-2) ─────────────
// build 219 #8: find_hero_rank 가 "구+성별+연령대" 같은 좁은 코호트로 떨어져
// 사용자 신고 — "성남시 남성 1위 / 1명" 처럼 통계 의미 없는 단일 표본 노출.
// 글로벌 랭킹 디폴트와 같이 country + region_si 로 스코프 고정.
function FriendRankingBlock({ userId, monthlyKm }: { userId: string; monthlyKm: number }) {
  const { locale } = useI18n();
  const [rank, setRank] = useState<{ scope_label: string; rank_position: number; total_in_scope: number } | null>(null);
  const [goalKm, setGoalKm] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const supabase = getSupabase();
        const now = new Date();
        const [rankRes, goalRes] = await Promise.all([
          supabase.rpc('find_my_combined_ranking', {
            target_user_id: userId,
            time_axis: 'month',
            use_country: true,
            use_region_si: true,
            use_region_gu: false,
            use_gender: false,
            use_decade: false,
            use_starter: false,
          }),
          supabase.rpc('get_user_monthly_goal', {
            target_user_id: userId,
            p_year: now.getFullYear(),
            p_month: now.getMonth() + 1,
          }),
        ]);
        if (rankRes.data && rankRes.data.length > 0) {
          const r = rankRes.data[0];
          // find_my_combined_ranking 반환: scope_label / rank_position / total_in_scope / ...
          // scope_label 이 "전체" 면 country + region_si 가 null 인 사용자 → fallback 으로 표시 그대로.
          setRank({
            scope_label: r.scope_label || '전체',
            rank_position: r.rank_position ?? 0,
            total_in_scope: r.total_in_scope ?? 0,
          });
        }
        if (goalRes.data) setGoalKm(Number(goalRes.data));
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, [userId]);

  if (loading) return <div className="card p-4 h-20 animate-pulse" />;
  if (!rank && !goalKm) return null;

  const goalPct = goalKm && goalKm > 0 ? Math.min(100, Math.round((monthlyKm / goalKm) * 100)) : null;

  return (
    <div className="card p-4 space-y-3">
      {rank && (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide">이달 랭킹</p>
            <p className="text-lg font-extrabold text-[var(--foreground)] mt-0.5">
              <span className="text-emerald-600">{formatRank(rank.rank_position, locale)}</span>
              <span className="text-xs font-medium text-[var(--muted)] ml-1.5">/ {rank.total_in_scope}명</span>
            </p>
            <p className="text-[11px] text-[var(--muted)] mt-0.5">{rank.scope_label}</p>
          </div>
          <Trophy size={28} className="text-yellow-500" />
        </div>
      )}
      {goalKm && goalPct !== null && (
        <div className={rank ? 'pt-3 border-t border-[var(--card-border)]' : ''}>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide">이달 목표</p>
            <p className="text-xs font-bold text-[var(--foreground)] tabular-nums">{monthlyKm.toFixed(1)} / {goalKm.toFixed(0)} km</p>
          </div>
          <div className="h-2 rounded-full bg-[var(--card-border)]/30 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all" style={{ width: `${goalPct}%` }} />
          </div>
          <p className="text-[11px] text-[var(--muted)] mt-1 text-right">{goalPct}% 진행</p>
        </div>
      )}
    </div>
  );
}

// ── 친구 최근 7일 GPS 미니맵 (build 125) ─────────────
function FriendMiniMap({ userId }: { userId: string }) {
  const [activities, setActivities] = useState<{ activity_id: string; distance_km: number; route_data: { coordinates?: [number, number][] } | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodDays, setPeriodDays] = useState<number>(7);

  useEffect(() => {
    // build 184: route_data 가 없는 활동 (Apple Health 거리만 sync) 이 많아
    // 7일 안에 GPS 경로 없는 사용자는 미니맵 자체가 안 뜸. 7 → 30 → 90 fallback.
    let cancelled = false;
    (async () => {
      const supabase = getSupabase();
      for (const days of [7, 30, 90]) {
        if (cancelled) return;
        try {
          const { data } = await supabase.rpc('fetch_user_recent_routes', { p_user_id: userId, p_days: days });
          const list = (data ?? []) as typeof activities;
          const withRoute = list.filter(a => a.route_data?.coordinates && a.route_data.coordinates.length >= 2);
          if (withRoute.length > 0) {
            if (!cancelled) {
              setActivities(list);
              setPeriodDays(days);
              setLoading(false);
            }
            return;
          }
        } catch { /* try next window */ }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  if (loading) return <div className="card p-4 h-32 animate-pulse" />;
  const withRoute = activities.filter(a => a.route_data?.coordinates && a.route_data.coordinates.length >= 2);
  if (withRoute.length === 0) return null;

  const W = 320, H = 140, PAD = 8;
  const all: { lng: number; lat: number }[] = [];
  withRoute.forEach(a => a.route_data?.coordinates?.forEach(([lng, lat]) => all.push({ lng, lat })));
  const minLng = Math.min(...all.map(c => c.lng));
  const maxLng = Math.max(...all.map(c => c.lng));
  const minLat = Math.min(...all.map(c => c.lat));
  const maxLat = Math.max(...all.map(c => c.lat));
  const spanLng = maxLng - minLng || 0.001;
  const spanLat = maxLat - minLat || 0.001;
  const scale = Math.min((W - PAD * 2) / spanLng, (H - PAD * 2) / spanLat);
  const offX = PAD + ((W - PAD * 2) - spanLng * scale) / 2;
  const offY = PAD + ((H - PAD * 2) - spanLat * scale) / 2;

  // build 156: 미니맵 클릭 시 친구의 구글 지도 페이지로 이동
  return (
    <Link href={`/map?userId=${userId}`} className="block active:scale-[0.99] transition">
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <MapPin size={14} className="text-emerald-500" />
          <h3 className="text-sm font-extrabold">최근 {periodDays}일 러닝 경로</h3>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold text-emerald-600 tabular-nums">{withRoute.length}회</span>
          <span className="text-[10px] text-[var(--muted)]">지도 크게 보기 →</span>
        </div>
      </div>
      <div className="rounded-xl bg-gradient-to-br from-emerald-50/60 via-white to-emerald-50/30 dark:from-emerald-950/20 dark:via-zinc-900 dark:to-emerald-950/10 border border-emerald-200/30 dark:border-emerald-900/20 overflow-hidden">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 140 }} preserveAspectRatio="xMidYMid meet">
          {withRoute.map((a, idx) => {
            const coords = a.route_data?.coordinates ?? [];
            if (coords.length < 2) return null;
            const opacity = 0.95 - (idx / Math.max(1, withRoute.length - 1)) * 0.5;
            const d = coords.map(([lng, lat], i) => {
              const x = offX + (lng - minLng) * scale;
              const y = H - (offY + (lat - minLat) * scale);
              return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
            }).join(' ');
            return <path key={idx} d={d} fill="none" stroke="#10b981" strokeOpacity={opacity} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />;
          })}
        </svg>
      </div>
    </div>
    </Link>
  );
}

// ── 친구 30일 활동 막대 (build 124) ─────────────
function FriendActivityChart({ userId }: { userId: string }) {
  const [rows, setRows] = useState<{ activity_id: string; distance_km: number; activity_date: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const supabase = getSupabase();
        const { data } = await supabase.rpc('fetch_user_recent_routes', { p_user_id: userId, p_days: 30 });
        setRows((data ?? []) as { activity_id: string; distance_km: number; activity_date: string }[]);
      } catch { /* ignore */ } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  if (loading) return <div className="card p-4 h-28 animate-pulse" />;
  if (rows.length === 0) return null;

  // 30일 그리드
  const today = new Date();
  const days: { date: string; km: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const ymd = d.toISOString().slice(0, 10);
    const km = rows.filter(r => r.activity_date === ymd).reduce((s, r) => s + Number(r.distance_km), 0);
    days.push({ date: ymd, km });
  }
  const maxKm = Math.max(...days.map(d => d.km), 1);

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40">30일</span>
          <h3 className="text-sm font-extrabold">활동 그래프</h3>
        </div>
        <span className="text-xs font-bold text-emerald-600 tabular-nums">
          {rows.reduce((s, r) => s + Number(r.distance_km), 0).toFixed(1)}km · {rows.length}회
        </span>
      </div>
      <div className="flex items-end gap-[2px] h-16">
        {days.map((d, i) => {
          const h = d.km > 0 ? Math.max(4, (d.km / maxKm) * 100) : 4;
          return (
            <div
              key={i}
              className={`flex-1 rounded-t-sm ${d.km > 0 ? 'bg-emerald-500' : 'bg-[var(--card-border)]/30'}`}
              style={{ height: `${h}%` }}
              title={`${d.date} · ${d.km.toFixed(1)}km`}
            />
          );
        })}
      </div>
      <div className="flex items-center justify-between mt-1.5 text-[10px] text-[var(--muted)] font-bold">
        <span>{days[0].date.slice(5)}</span>
        <span>오늘</span>
      </div>
    </div>
  );
}
