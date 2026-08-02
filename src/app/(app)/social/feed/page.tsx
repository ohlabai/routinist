'use client';

// build 277: 친구 활동 피드.
// 내가 팔로잉 중인 사용자들의 최근 activities (visibility='public') 시계열.
// 각 카드: avatar + name + timeAgo + 거리/시간/페이스 + 응원 inline + 활동 진입.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Activity as ActivityIcon, MapPin, Clock } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { fetchFollowing } from '@/lib/social-data';
import { useI18n } from '@/lib/i18n';
import type { Profile } from '@/types';
import AppLogo from '@/components/AppLogo';
import CheerButton from '@/components/social/CheerButton';

interface FeedActivity {
  id: string;
  user_id: string;
  activity_date: string;
  distance_km: number;
  duration_seconds: number;
  pace_avg_sec_per_km: number | null;
  ended_at: string | null;
  started_at: string | null;
}

function timeAgo(iso: string | null, locale: string): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (locale === 'en') {
    if (ms < 60_000) return 'just now';
    if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h ago`;
    if (ms < 30 * 86400_000) return `${Math.floor(ms / 86400_000)}d ago`;
    return `${Math.floor(ms / (30 * 86400_000))}mo ago`;
  }
  if (ms < 60_000) return '방금';
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}분 전`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}시간 전`;
  if (ms < 30 * 86400_000) return `${Math.floor(ms / 86400_000)}일 전`;
  return `${Math.floor(ms / (30 * 86400_000))}달 전`;
}

function formatDuration(s: number): string {
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (hh > 0) return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

function formatPace(secPerKm: number | null): string {
  if (!secPerKm || secPerKm <= 0) return '-';
  const m = Math.floor(secPerKm / 60);
  const s = secPerKm % 60;
  return `${m}'${String(s).padStart(2, '0')}"`;
}

export default function FriendFeedPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { tt, locale } = useI18n();
  const [activities, setActivities] = useState<FeedActivity[]>([]);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    let mounted = true;
    (async () => {
      setLoading(true);
      const following = await fetchFollowing(user.id);
      if (!mounted) return;
      const friendIds = following.map(f => f.id);
      if (friendIds.length === 0) {
        setActivities([]);
        setProfiles(new Map());
        setLoading(false);
        return;
      }
      const supabase = getSupabase();
      const { data } = await supabase
        .from('activities')
        .select('id, user_id, activity_date, distance_km, duration_seconds, pace_avg_sec_per_km, ended_at, started_at')
        .in('user_id', friendIds)
        .eq('visibility', 'public')
        .gte('distance_km', 0.5)  // 너무 짧은 noise 제외
        .order('ended_at', { ascending: false, nullsFirst: false })
        .limit(50);
      if (!mounted) return;
      setActivities((data ?? []) as FeedActivity[]);
      const profileMap = new Map<string, Profile>();
      for (const p of following) profileMap.set(p.id, p);
      setProfiles(profileMap);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [user, authLoading, router]);

  const grouped = useMemo(() => {
    // 같은 날 같은 사용자의 activities 는 묶지 않고 그대로 시계열 (사용자가 이중 운동도 보이게)
    return activities;
  }, [activities]);

  return (
    <div className="max-w-lg mx-auto pb-16 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/85 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full active:bg-[var(--card-border)]/30">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-extrabold tracking-tight inline-flex items-center gap-1.5">
            <ActivityIcon size={18} className="text-emerald-500" /> {tt('친구 피드')}
          </h1>
        </div>
      </header>

      <div className="px-4 pt-4 space-y-3">
        {loading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => (
              <div key={i} className="card p-4 animate-pulse">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-[var(--card-border)]/40" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-[var(--card-border)]/40 rounded w-1/3" />
                    <div className="h-2.5 bg-[var(--card-border)]/30 rounded w-1/4" />
                  </div>
                </div>
                <div className="h-4 bg-[var(--card-border)]/40 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : grouped.length === 0 ? (
          <div className="card p-6 text-center bg-emerald-50/30 dark:bg-emerald-950/15 border-emerald-200/50 dark:border-emerald-900/40 mt-6">
            <ActivityIcon size={28} className="mx-auto text-emerald-600 dark:text-emerald-400 mb-2" />
            <p className="text-sm font-bold text-[var(--foreground)]">{tt('아직 친구 활동이 없어요')}</p>
            <p className="text-xs text-[var(--muted)] mt-1 break-keep">
              {tt('친구를 추가하면 그들의 러닝이 여기 표시돼요')}
            </p>
            <Link href="/social?tab=friends"
              className="mt-3 inline-block text-xs font-extrabold text-emerald-600 dark:text-emerald-400">
              {tt('친구 찾으러 가기 →')}
            </Link>
          </div>
        ) : (
          grouped.map(act => {
            const profile = profiles.get(act.user_id);
            const dispName = profile?.display_name ?? tt('러너');
            const km = Number(act.distance_km).toFixed(2);
            const dur = formatDuration(act.duration_seconds);
            const pace = formatPace(act.pace_avg_sec_per_km);
            return (
              <div key={act.id} className="card p-4 space-y-3">
                {/* 헤더 — actor + timeAgo */}
                <Link href={`/social/user?id=${act.user_id}`} className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[var(--card-border)] overflow-hidden flex-shrink-0">
                    {profile?.avatar_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><AppLogo size={24} /></div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate">{dispName}</p>
                    <p className="text-[13px] text-[var(--muted)]">{timeAgo(act.ended_at || act.started_at, locale)}</p>
                  </div>
                </Link>

                {/* 활동 카드 — 거리/시간/페이스 3-column */}
                <Link href={`/activity?id=${act.id}`} className="block">
                  <div className="grid grid-cols-3 gap-2 py-3 bg-emerald-50/30 dark:bg-emerald-950/15 rounded-2xl tabular-nums">
                    <div className="text-center">
                      <p className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400">{km}</p>
                      <p className="text-[12px] text-[var(--muted)] mt-0.5"><MapPin size={9} className="inline" /> km</p>
                    </div>
                    <div className="text-center border-l border-r border-[var(--card-border)]/30">
                      <p className="text-xl font-extrabold text-[var(--foreground)]">{dur}</p>
                      <p className="text-[12px] text-[var(--muted)] mt-0.5"><Clock size={9} className="inline" /> {tt('시간')}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-extrabold text-[var(--foreground)]">{pace}</p>
                      <p className="text-[12px] text-[var(--muted)] mt-0.5">/km</p>
                    </div>
                  </div>
                </Link>

                {/* 응원 buttons */}
                <div className="flex items-center justify-between">
                  <Link href={`/activity?id=${act.id}`} className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    {tt('자세히 보기')} →
                  </Link>
                  {user && user.id !== act.user_id && (
                    <CheerButton toUserId={act.user_id} context="home_hero" size="sm" />
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
