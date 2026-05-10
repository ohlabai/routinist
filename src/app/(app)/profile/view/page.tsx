'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { isFollowing as checkFollowing, getFollowCounts } from '@/lib/social-data';
import { PUBLIC_PROFILE_FIELDS } from '@/lib/profile-fields';
import FollowButton from '@/components/social/FollowButton';
import CheerButton from '@/components/social/CheerButton';
import { getOrCreateConversation } from '@/lib/message-data';
import { ArrowLeft, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import type { Profile, Activity } from '@/types';
import AppLogo from '@/components/AppLogo';

function UserProfile() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const userId = searchParams.get('id');

  const [profile, setProfile] = useState<Profile | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [following, setFollowing] = useState(false);
  const [followCounts, setFollowCounts] = useState({ followers: 0, following: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user && userId === user.id) router.replace('/profile');
  }, [user, userId, router]);

  const loadData = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const supabase = getSupabase();
      const [profileRes, activitiesRes, isFollowingRes, countsRes] = await Promise.all([
        supabase.from('profiles').select(PUBLIC_PROFILE_FIELDS).eq('id', userId).maybeSingle(),
        supabase.from('activities').select('*').eq('user_id', userId).eq('visibility', 'public').order('activity_date', { ascending: false }).limit(10),
        checkFollowing(userId),
        getFollowCounts(userId),
      ]);
      setProfile(profileRes.data as Profile | null);
      setActivities((activitiesRes.data || []) as Activity[]);
      setFollowing(isFollowingRes);
      setFollowCounts(countsRes);
    } catch {} finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return <div className="flex justify-center py-20"><div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" /></div>;
  }

  if (!profile) {
    return (
      <div className="max-w-lg mx-auto px-4 py-6 text-center">
        <p className="text-[var(--muted)]">사용자를 찾을 수 없습니다.</p>
        <button onClick={() => router.back()} className="text-[var(--accent)] text-sm mt-4">뒤로가기</button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="text-[var(--muted)]"><ArrowLeft size={24} /></button>
        <h1 className="text-2xl font-bold text-[var(--foreground)] flex-1 truncate">{profile.display_name}</h1>
      </div>

      <div className="card p-6 text-center">
        <div className="w-20 h-20 rounded-full bg-[var(--card-border)] overflow-hidden mx-auto mb-3">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center"><AppLogo size={40} /></div>
          )}
        </div>
        <h2 className="text-3xl font-bold text-[var(--foreground)]">{profile.display_name}</h2>
        {profile.bio && <p className="text-xs text-[var(--muted)] mt-1">{profile.bio}</p>}

        <div className="flex justify-center gap-6 mt-3 text-sm">
          <div><span className="font-bold text-[var(--foreground)]">{followCounts.followers}</span> <span className="text-[var(--muted)]">친구</span></div>
          <div><span className="font-bold text-[var(--foreground)]">{followCounts.following}</span> <span className="text-[var(--muted)]">내가 추가</span></div>
        </div>

        <div className="flex justify-center items-center gap-3 mt-4">
          <FollowButton userId={profile.id} initialFollowing={following} onToggle={(f) => {
            setFollowing(f);
            setFollowCounts((prev) => ({ ...prev, followers: prev.followers + (f ? 1 : -1) }));
          }} />
          <CheerButton toUserId={profile.id} context="profile" />
          <button
            onClick={async () => {
              if (!userId) return;
              const conv = await getOrCreateConversation(userId);
              router.push(`/messages/chat?id=${conv.id}`);
            }}
            className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)] inline-flex items-center gap-1"
          >
            <MessageCircle size={14} /> 쪽지
          </button>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="text-sm font-semibold text-[var(--foreground)] mb-3">통산 기록</h3>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-2xl font-bold text-[var(--foreground)]">{Number(profile.total_distance_km).toFixed(1)}</p>
            <p className="text-xs text-[var(--muted)]">총 km</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-[var(--foreground)]">{profile.total_runs}</p>
            <p className="text-xs text-[var(--muted)]">총 러닝</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-[var(--foreground)]">{profile.region_gu ?? '-'}</p>
            <p className="text-xs text-[var(--muted)]">지역</p>
          </div>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="text-sm font-semibold text-[var(--foreground)] mb-3">최근 활동</h3>
        {activities.length === 0 ? (
          <p className="text-xs text-[var(--muted)] text-center py-4">공개된 활동이 없습니다</p>
        ) : (
          <div className="space-y-3">
            {activities.map((a) => (
              <div key={a.id} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[var(--foreground)]">{a.distance_km.toFixed(2)} km</p>
                  <p className="text-xs text-[var(--muted)]">{new Date(a.activity_date).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}</p>
                </div>
                <p className="text-xs text-[var(--muted)]">{a.duration_seconds ? `${Math.floor(a.duration_seconds / 60)}분` : ''}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function UserProfilePage() {
  return <Suspense fallback={<div className="flex justify-center py-20"><div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" /></div>}><UserProfile /></Suspense>;
}
