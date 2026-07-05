'use client';

// build 269: 친구 목록 페이지.
// 3 탭 구조: 친구 (양방향 follow) / 팔로잉 (내가 follow) / 팔로워 (나를 follow).
// /social 의 friends 탭 상단 카드에서 진입.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Users } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { fetchFollowers, fetchFollowing } from '@/lib/social-data';
import { fetchSentFriendRequests, cancelFriendRequest, type SentFriendRequest } from '@/lib/friend-requests-data';
import { useI18n } from '@/lib/i18n';
import type { Profile } from '@/types';
import AppLogo from '@/components/AppLogo';

type TabId = 'friends' | 'following' | 'followers' | 'sent';

export default function FriendsListPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { tt, locale } = useI18n();
  const [followingList, setFollowingList] = useState<Profile[]>([]);
  const [followersList, setFollowersList] = useState<Profile[]>([]);
  const [sentRequests, setSentRequests] = useState<SentFriendRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('friends');
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    let mounted = true;
    (async () => {
      setLoading(true);
      const [following, followers, sent] = await Promise.all([
        fetchFollowing(user.id),
        fetchFollowers(user.id),
        fetchSentFriendRequests(),
      ]);
      if (!mounted) return;
      setFollowingList(following);
      setFollowersList(followers);
      setSentRequests(sent);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [user, authLoading, router]);

  // build 279: 보낸 신청 취소
  const handleCancel = async (requestId: string) => {
    if (cancellingId) return;
    if (!window.confirm(tt('신청을 취소할까요?'))) return;
    setCancellingId(requestId);
    try {
      await cancelFriendRequest(requestId);
      setSentRequests(prev => prev.filter(r => r.id !== requestId));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : tt('취소 실패'));
    } finally {
      setCancellingId(null);
    }
  };

  // 양방향 = 친구. 단방향 only 두 그룹으로 분류.
  const { friends, followingOnly, followersOnly } = useMemo(() => {
    const followingIds = new Set(followingList.map(p => p.id));
    const followersIds = new Set(followersList.map(p => p.id));
    const friends = followingList.filter(p => followersIds.has(p.id));
    const followingOnly = followingList.filter(p => !followersIds.has(p.id));
    const followersOnly = followersList.filter(p => !followingIds.has(p.id));
    return { friends, followingOnly, followersOnly };
  }, [followingList, followersList]);

  const currentList = activeTab === 'friends' ? friends
    : activeTab === 'following' ? followingOnly
    : activeTab === 'followers' ? followersOnly
    : []; // sent 탭은 별도 렌더링

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: 'friends', label: tt('친구'), count: friends.length },
    { id: 'following', label: tt('팔로잉'), count: followingOnly.length },
    { id: 'followers', label: tt('팔로워'), count: followersOnly.length },
    { id: 'sent', label: tt('신청 중'), count: sentRequests.length },
  ];

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/85 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full active:bg-[var(--card-border)]/30">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-extrabold tracking-tight inline-flex items-center gap-1.5">
            <Users size={18} className="text-emerald-500" /> {tt('친구 목록')}
          </h1>
        </div>
      </header>

      <div className="px-4 pt-4 space-y-4">
        {/* 세그먼트 컨트롤 */}
        <div className="flex bg-[var(--card)] border border-[var(--card-border)] rounded-2xl p-1 shadow-sm">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex-1 py-2.5 rounded-xl text-xs font-extrabold transition-all active:scale-95 ${
                activeTab === t.id
                  ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-500/30'
                  : 'text-[var(--muted)]'
              }`}
            >
              {t.label} <span className="tabular-nums">{t.count}</span>
            </button>
          ))}
        </div>

        {/* 설명 카드 — 양방향 친구 의미 안내 */}
        {activeTab === 'friends' && friends.length === 0 && !loading && (
          <div className="card p-5 text-center bg-emerald-50/30 dark:bg-emerald-950/15 border-emerald-200/50 dark:border-emerald-900/40">
            <Users size={28} className="mx-auto text-emerald-600 dark:text-emerald-400 mb-2" />
            <p className="text-sm font-bold text-[var(--foreground)]">{tt('아직 양방향 친구가 없어요')}</p>
            <p className="text-xs text-[var(--muted)] mt-1 break-keep">
              {tt('서로 친구로 등록한 사용자만 여기 보여요. 친구 신청을 보내거나 받아보세요.')}
            </p>
          </div>
        )}
        {activeTab === 'following' && followingOnly.length === 0 && !loading && (
          <div className="card p-5 text-center">
            <p className="text-sm font-medium text-[var(--foreground)]">{tt('한쪽 팔로잉이 없어요')}</p>
            <p className="text-xs text-[var(--muted)] mt-1 break-keep">
              {tt('내가 친구 추가했지만 상대는 아직 안 한 사용자')}
            </p>
          </div>
        )}
        {activeTab === 'followers' && followersOnly.length === 0 && !loading && (
          <div className="card p-5 text-center">
            <p className="text-sm font-medium text-[var(--foreground)]">{tt('한쪽 팔로워가 없어요')}</p>
            <p className="text-xs text-[var(--muted)] mt-1 break-keep">
              {tt('상대가 나를 추가했지만 나는 아직 안 한 사용자')}
            </p>
          </div>
        )}
        {activeTab === 'sent' && sentRequests.length === 0 && !loading && (
          <div className="card p-5 text-center">
            <p className="text-sm font-medium text-[var(--foreground)]">{tt('보낸 신청이 없어요')}</p>
            <p className="text-xs text-[var(--muted)] mt-1 break-keep">
              {tt('사용자 프로필에서 친구 신청을 보낼 수 있어요')}
            </p>
          </div>
        )}
        {/* build 279: 보낸 신청 목록 — 받은 사람 + 취소 버튼 */}
        {activeTab === 'sent' && sentRequests.length > 0 && !loading && (
          <div className="space-y-2">
            {sentRequests.map(r => (
              <div key={r.id} className="card flex items-center gap-3 p-3">
                <Link href={`/social/user?id=${r.receiver_id}`} className="w-10 h-10 rounded-full bg-[var(--card-border)] overflow-hidden flex-shrink-0">
                  {r.receiver?.avatar_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={r.receiver.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center"><AppLogo size={24} /></div>
                  )}
                </Link>
                <Link href={`/social/user?id=${r.receiver_id}`} className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">{r.receiver?.display_name ?? tt('알 수 없음')}</p>
                  <p className="text-[11px] text-[var(--muted)]">{tt('신청 보냄 · 응답 대기 중')}</p>
                </Link>
                <button
                  onClick={() => handleCancel(r.id)}
                  disabled={cancellingId === r.id}
                  className="px-3 py-1.5 rounded-full text-xs font-extrabold bg-[var(--card-border)]/50 text-[var(--muted)] active:scale-95 disabled:opacity-50"
                >
                  {cancellingId === r.id ? tt('취소 중') : tt('취소')}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 리스트 */}
        {loading ? (
          <div className="space-y-2">
            {[1,2,3,4].map(i => (
              <div key={i} className="card p-3 animate-pulse flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[var(--card-border)]/40" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-[var(--card-border)]/40 rounded w-1/2" />
                  <div className="h-2.5 bg-[var(--card-border)]/30 rounded w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {currentList.map(p => (
              <Link
                key={p.id}
                href={`/social/user?id=${p.id}`}
                className="card flex items-center gap-3 p-3 active:scale-[0.99] transition"
              >
                <div className="w-10 h-10 rounded-full bg-[var(--card-border)] overflow-hidden flex-shrink-0">
                  {p.avatar_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={p.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center"><AppLogo size={24} /></div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">{p.display_name}</p>
                  <p className="text-xs text-[var(--muted)] tabular-nums">
                    {Number(p.total_distance_km).toFixed(1)}km · {locale === 'en' ? `${p.total_runs} runs` : `${p.total_runs}회`}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
