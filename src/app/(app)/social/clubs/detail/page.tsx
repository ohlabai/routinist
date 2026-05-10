'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import {
  fetchClub, fetchClubMembers, joinClub, leaveClub, isClubMember,
  getMyClubRole, updateMemberRole, removeMember, updateClub, deleteClub, fetchClubActivities,
} from '@/lib/social-data';
import {
  fetchClubMemberProgress, fetchClubSummary, fetchMemberRunCounts, fetchCumulativeRanking, fetchHallOfFame,
  type MemberProgress, type ClubSummary, type MemberRunCount, type CumulativeRanking, type HallOfFameEntry,
} from '@/lib/stats-data';
import { formatPace, formatDuration } from '@/lib/routinist-data';
import { ArrowLeft, Users, LogIn, LogOut, Share2, Shield, ShieldOff, UserMinus, Settings, Activity, Crown, Copy, Check, TrendingUp, Zap, Trophy, Flame, ChevronRight, Trash2, MessageSquare, Heart, Image as ImageIcon, Pin, X, Send } from 'lucide-react';
import {
  fetchClubFeed, createClubPost, deleteClubPost, toggleClubPostNotice, toggleClubPostLike,
  fetchClubPostComments, createClubPostComment, uploadClubPostPhoto, type ClubPost, type ClubPostComment,
} from '@/lib/club-posts';
import {
  fetchClubChallenges, createClubChallenge, deleteClubChallenge, getClubChallengeProgress,
  fetchClubEvents, createClubEvent, deleteClubEvent, rsvpClubEvent,
  fetchActivityCheers, toggleCheer, fetchClubWeeklyMvp, CHEER_EMOJIS,
  type ClubChallenge, type ChallengeProgress, type ClubEvent, type CheerEmoji, type CheerAgg, type WeeklyMvp,
} from '@/lib/club-activation';
import InviteQRCard from '@/components/clubs/InviteQRCard';
import ClubExternalArchive from '@/components/clubs/ClubExternalArchive';
import Link from 'next/link';
import type { Club, ClubMember } from '@/types';
import AppLogo from '@/components/AppLogo';

type TabId = 'dashboard' | 'feed' | 'challenges' | 'members' | 'activity' | 'archive' | 'settings';

function ClubDetail() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const clubId = searchParams.get('id');

  const [club, setClub] = useState<Club | null>(null);
  const [members, setMembers] = useState<ClubMember[]>([]);
  const [isMember, setIsMember] = useState(false);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [copied, setCopied] = useState(false);

  // 대시보드 데이터
  const [dashSummary, setDashSummary] = useState<ClubSummary | null>(null);
  const [dashMembers, setDashMembers] = useState<MemberProgress[]>([]);
  const [dashRunCounts, setDashRunCounts] = useState<MemberRunCount[]>([]);
  const [dashCumulative, setDashCumulative] = useState<CumulativeRanking[]>([]);
  const [dashHallOfFame, setDashHallOfFame] = useState<HallOfFameEntry[]>([]);
  const [dashLoading, setDashLoading] = useState(false);

  // 설정 상태
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editPublic, setEditPublic] = useState(true);
  const [saving, setSaving] = useState(false);

  // 피드 상태
  const [feedPosts, setFeedPosts] = useState<ClubPost[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeBody, setComposeBody] = useState('');
  const [composeIsNotice, setComposeIsNotice] = useState(false);
  const [composePhoto, setComposePhoto] = useState<File | null>(null);
  const [composing, setComposing] = useState(false);
  const [openComments, setOpenComments] = useState<Record<string, ClubPostComment[] | null>>({});
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});

  // 챌린지 & 이벤트
  const [challenges, setChallenges] = useState<ClubChallenge[]>([]);
  const [challengeProgress, setChallengeProgress] = useState<Record<string, ChallengeProgress[]>>({});
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [chOpen, setChOpen] = useState(false);
  const [chTitle, setChTitle] = useState('');
  const [chDesc, setChDesc] = useState('');
  const [chTargetKm, setChTargetKm] = useState('');
  const [chTargetCount, setChTargetCount] = useState('');
  const [chStart, setChStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [chEnd, setChEnd] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 6);
    return d.toISOString().slice(0, 10);
  });
  const [evOpen, setEvOpen] = useState(false);
  const [evTitle, setEvTitle] = useState('');
  const [evDesc, setEvDesc] = useState('');
  const [evDate, setEvDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 3); d.setHours(19, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [evLocation, setEvLocation] = useState('');
  const [evMax, setEvMax] = useState('');

  // 주간 MVP
  const [weeklyMvp, setWeeklyMvp] = useState<WeeklyMvp[]>([]);

  // 응원 이모지
  const [cheersMap, setCheersMap] = useState<Map<string, CheerAgg[]>>(new Map());
  const [cheerOpen, setCheerOpen] = useState<string | null>(null);

  // 초대 QR
  const [qrOpen, setQrOpen] = useState(false);

  const loadData = useCallback(async () => {
    if (!clubId) return;
    setLoading(true);
    try {
      const [clubData, membersData, memberStatus, role] = await Promise.all([
        fetchClub(clubId),
        fetchClubMembers(clubId),
        isClubMember(clubId),
        getMyClubRole(clubId),
      ]);
      setClub(clubData);
      setMembers(membersData);
      setIsMember(memberStatus);
      setMyRole(role);
      if (clubData) {
        setEditName(clubData.name);
        setEditDesc(clubData.description || '');
        setEditPublic(clubData.is_public);
      }
    } catch {} finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => { loadData(); }, [loadData]);

  // 활동 탭 진입 시 로드
  useEffect(() => {
    if (activeTab === 'activity' && clubId && activities.length === 0) {
      fetchClubActivities(clubId).then(setActivities).catch(() => {});
    }
  }, [activeTab, clubId, activities.length]);

  // 대시보드 탭 진입 시 클럽 통계 로드
  const now = new Date();
  const dashYear = now.getFullYear();
  const dashMonth = now.getMonth() + 1;

  useEffect(() => {
    if (activeTab !== 'dashboard' || !clubId) return;
    setDashLoading(true);
    Promise.allSettled([
      fetchClubSummary(clubId, dashYear, dashMonth),
      fetchClubMemberProgress(clubId, dashYear, dashMonth),
      fetchMemberRunCounts(clubId, dashYear, dashMonth),
      fetchCumulativeRanking(clubId),
      fetchHallOfFame(clubId, dashYear, dashMonth),
    ]).then(results => {
      if (results[0].status === 'fulfilled' && results[0].value) setDashSummary(results[0].value);
      if (results[1].status === 'fulfilled') setDashMembers(results[1].value);
      if (results[2].status === 'fulfilled') setDashRunCounts(results[2].value);
      if (results[3].status === 'fulfilled') setDashCumulative(results[3].value);
      if (results[4].status === 'fulfilled') setDashHallOfFame(results[4].value);
    }).finally(() => setDashLoading(false));
  }, [activeTab, clubId, dashYear, dashMonth]);

  const handleJoin = async () => {
    if (!clubId) return;
    setActionLoading(true);
    try { await joinClub(clubId); await loadData(); } catch {} finally { setActionLoading(false); }
  };

  const handleLeave = async () => {
    if (!clubId || !confirm('정말 클럽을 탈퇴하시겠습니까?')) return;
    setActionLoading(true);
    try { await leaveClub(clubId); await loadData(); } catch {} finally { setActionLoading(false); }
  };

  // 클럽 초대 URL — 네이티브 앱은 origin='capacitor://localhost' 라 외부에서 안 열림 (QR 스캔 시 "사용 가능한 데이터가 없음").
  // 항상 public Vercel 도메인 사용. 받는 사람이 카메라로 스캔 → 브라우저 → 앱 설치된 경우 Universal Link (TODO).
  const getInviteUrl = () => `https://bitrunners.kr/social/clubs/detail?id=${clubId}`;

  const handleCopyInvite = () => {
    navigator.clipboard.writeText(getInviteUrl()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleRoleChange = async (userId: string, newRole: 'admin' | 'member') => {
    if (!clubId) return;
    try {
      await updateMemberRole(clubId, userId, newRole);
      await loadData();
    } catch {}
  };

  const handleRemoveMember = async (userId: string, name: string) => {
    if (!clubId || !confirm(`${name}님을 클럽에서 추방하시겠습니까?`)) return;
    try {
      await removeMember(clubId, userId);
      await loadData();
    } catch {}
  };

  const handleSaveSettings = async () => {
    if (!clubId || !editName.trim()) return;
    setSaving(true);
    try {
      await updateClub(clubId, { name: editName.trim(), description: editDesc.trim() || undefined, is_public: editPublic });
      await loadData();
    } catch {} finally {
      setSaving(false);
    }
  };

  // early return 은 모든 hook 호출 뒤로 이동 (React Error #310 방지). 아래 useCallback/useEffect 들이
  // 조건부로 실행되면 hook 순서가 렌더 간 달라져 "Rendered more hooks" 크래시.
  const isAdmin = myRole === 'owner' || myRole === 'admin';
  const isAppAdmin = user?.email === 'hans@openhan.kr';
  const canDelete = myRole === 'owner' || isAppAdmin;
  const tabs: { id: TabId; label: string; show: boolean }[] = [
    { id: 'dashboard', label: '대시보드', show: isMember },
    { id: 'feed', label: '피드', show: isMember },
    { id: 'challenges', label: '챌린지·모임', show: isMember },
    { id: 'members', label: `멤버 (${members.length})`, show: true },
    { id: 'activity', label: '활동', show: isMember },
    { id: 'archive', label: '결산', show: true },
    { id: 'settings', label: '설정', show: isAdmin || isAppAdmin },
  ];

  // 피드 로드
  const loadFeed = useCallback(async () => {
    if (!clubId) return;
    setFeedLoading(true);
    try {
      const posts = await fetchClubFeed(clubId);
      setFeedPosts(posts);
    } catch (e) {
      console.warn('[ClubFeed] load 실패', e);
    } finally {
      setFeedLoading(false);
    }
  }, [clubId]);

  useEffect(() => {
    if (activeTab === 'feed') loadFeed();
  }, [activeTab, loadFeed]);

  const handleCompose = async () => {
    if (!clubId || !user || !composeBody.trim()) return;
    setComposing(true);
    try {
      let photoUrl: string | null = null;
      if (composePhoto) {
        photoUrl = await uploadClubPostPhoto(user.id, composePhoto);
      }
      await createClubPost({
        clubId, authorId: user.id, body: composeBody.trim(),
        photoUrl, isNotice: composeIsNotice && isAdmin,
      });
      setComposeBody(''); setComposePhoto(null); setComposeIsNotice(false); setComposeOpen(false);
      await loadFeed();
    } catch (e) {
      alert(e instanceof Error ? e.message : '게시글 등록 실패');
    } finally {
      setComposing(false);
    }
  };

  const handleLike = async (post: ClubPost) => {
    if (!user) return;
    // optimistic
    setFeedPosts(prev => prev.map(p => p.id === post.id ? {
      ...p,
      liked_by_me: !p.liked_by_me,
      like_count: p.like_count + (p.liked_by_me ? -1 : 1),
    } : p));
    try {
      await toggleClubPostLike(post.id, user.id, post.liked_by_me);
    } catch {
      await loadFeed();
    }
  };

  const handleToggleNotice = async (post: ClubPost) => {
    try {
      await toggleClubPostNotice(post.id, !post.is_notice);
      await loadFeed();
    } catch (e) {
      alert(e instanceof Error ? e.message : '공지 전환 실패');
    }
  };

  const handleDeletePost = async (post: ClubPost) => {
    if (!confirm('게시글을 삭제할까요?')) return;
    try {
      await deleteClubPost(post.id);
      setFeedPosts(prev => prev.filter(p => p.id !== post.id));
    } catch (e) {
      alert(e instanceof Error ? e.message : '삭제 실패');
    }
  };

  const handleOpenComments = async (postId: string) => {
    if (openComments[postId]) {
      setOpenComments(prev => ({ ...prev, [postId]: null }));
      return;
    }
    try {
      const list = await fetchClubPostComments(postId);
      setOpenComments(prev => ({ ...prev, [postId]: list }));
    } catch (e) {
      console.warn('댓글 로드 실패', e);
    }
  };

  // ========== 챌린지 ==========
  const loadChallenges = useCallback(async () => {
    if (!clubId) return;
    try {
      const list = await fetchClubChallenges(clubId);
      setChallenges(list);
      const progressEntries = await Promise.all(list.map(async ch => [ch.id, await getClubChallengeProgress(ch.id)] as const));
      const next: Record<string, ChallengeProgress[]> = {};
      progressEntries.forEach(([id, p]) => { next[id] = p; });
      setChallengeProgress(next);
    } catch (e) { console.warn('챌린지 로드 실패', e); }
  }, [clubId]);

  const handleCreateChallenge = async () => {
    if (!clubId || !user || !chTitle.trim() || (!chTargetKm && !chTargetCount)) return;
    try {
      await createClubChallenge({
        clubId, authorId: user.id,
        title: chTitle.trim(),
        description: chDesc.trim() || undefined,
        targetKm: chTargetKm ? Number(chTargetKm) : undefined,
        targetRunCount: chTargetCount ? Number(chTargetCount) : undefined,
        startDate: chStart, endDate: chEnd,
      });
      setChOpen(false); setChTitle(''); setChDesc(''); setChTargetKm(''); setChTargetCount('');
      await loadChallenges();
    } catch (e) { alert(e instanceof Error ? e.message : '챌린지 등록 실패'); }
  };

  const handleDeleteChallenge = async (id: string) => {
    if (!confirm('챌린지를 삭제할까요?')) return;
    try { await deleteClubChallenge(id); await loadChallenges(); }
    catch (e) { alert(e instanceof Error ? e.message : '삭제 실패'); }
  };

  // ========== 이벤트 ==========
  const loadEvents = useCallback(async () => {
    if (!clubId) return;
    try { setEvents(await fetchClubEvents(clubId)); }
    catch (e) { console.warn('이벤트 로드 실패', e); }
  }, [clubId]);

  const handleCreateEvent = async () => {
    if (!clubId || !user || !evTitle.trim() || !evDate) return;
    try {
      await createClubEvent({
        clubId, authorId: user.id,
        title: evTitle.trim(),
        description: evDesc.trim() || undefined,
        eventAt: new Date(evDate).toISOString(),
        location: evLocation.trim() || undefined,
        maxParticipants: evMax ? Number(evMax) : undefined,
      });
      setEvOpen(false); setEvTitle(''); setEvDesc(''); setEvLocation(''); setEvMax('');
      await loadEvents();
    } catch (e) { alert(e instanceof Error ? e.message : '이벤트 등록 실패'); }
  };

  const handleRsvp = async (eventId: string, status: 'going' | 'maybe' | 'no') => {
    if (!user) return;
    try { await rsvpClubEvent(eventId, user.id, status); await loadEvents(); }
    catch (e) { alert(e instanceof Error ? e.message : 'RSVP 실패'); }
  };

  const handleDeleteEvent = async (id: string) => {
    if (!confirm('이벤트를 삭제할까요?')) return;
    try { await deleteClubEvent(id); await loadEvents(); }
    catch (e) { alert(e instanceof Error ? e.message : '삭제 실패'); }
  };

  useEffect(() => {
    if (activeTab === 'challenges') { loadChallenges(); loadEvents(); }
  }, [activeTab, loadChallenges, loadEvents]);

  // ========== 주간 MVP (대시보드 진입 시) ==========
  useEffect(() => {
    if (activeTab !== 'dashboard' || !clubId) return;
    fetchClubWeeklyMvp(clubId).then(setWeeklyMvp).catch(() => {});
  }, [activeTab, clubId]);

  // ========== 응원 이모지 (활동 탭 진입 시 + activities 로드 후) ==========
  useEffect(() => {
    if (activeTab !== 'activity' || activities.length === 0) return;
    const ids = activities.map(a => a.id).filter(Boolean) as string[];
    fetchActivityCheers(ids).then(setCheersMap).catch(() => {});
  }, [activeTab, activities]);

  const handleToggleCheer = async (activityId: string, emoji: CheerEmoji) => {
    if (!user) return;
    const cheerList = cheersMap.get(activityId) ?? [];
    const existing = cheerList.find(c => c.emoji === emoji);
    const currentlyCheered = existing?.cheered_by_me ?? false;
    // optimistic
    setCheersMap(prev => {
      const next = new Map(prev);
      const list = [...(next.get(activityId) ?? [])];
      const idx = list.findIndex(c => c.emoji === emoji);
      if (idx >= 0) {
        list[idx] = {
          ...list[idx],
          total: list[idx].total + (currentlyCheered ? -1 : 1),
          cheered_by_me: !currentlyCheered,
        };
        if (list[idx].total <= 0) list.splice(idx, 1);
      } else {
        list.push({ activity_id: activityId, emoji, total: 1, cheered_by_me: true });
      }
      next.set(activityId, list);
      return next;
    });
    try { await toggleCheer(activityId, user.id, emoji, currentlyCheered); }
    catch {
      if (activities.length > 0) {
        const ids = activities.map(a => a.id).filter(Boolean) as string[];
        fetchActivityCheers(ids).then(setCheersMap).catch(() => {});
      }
    }
  };

  const handleSubmitComment = async (postId: string) => {
    if (!user) return;
    const body = (commentDraft[postId] ?? '').trim();
    if (!body) return;
    try {
      await createClubPostComment(postId, user.id, body);
      setCommentDraft(prev => ({ ...prev, [postId]: '' }));
      const list = await fetchClubPostComments(postId);
      setOpenComments(prev => ({ ...prev, [postId]: list }));
      setFeedPosts(prev => prev.map(p => p.id === postId ? { ...p, comment_count: p.comment_count + 1 } : p));
    } catch (e) {
      alert(e instanceof Error ? e.message : '댓글 등록 실패');
    }
  };

  const handleDeleteClub = async () => {
    if (!clubId || !club) return;
    const label = isAppAdmin && myRole !== 'owner' ? '[관리자] ' : '';
    if (!confirm(`${label}"${club.name}" 클럽을 삭제할까요? 멤버 기록과 함께 영구 삭제됩니다.`)) return;
    setSaving(true);
    try {
      await deleteClub(clubId);
      alert('클럽이 삭제되었습니다.');
      router.replace('/social?tab=clubs');
    } catch (e) {
      alert(e instanceof Error ? e.message : '삭제 실패');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-20"><div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" /></div>;
  }

  if (!club) {
    return (
      <div className="max-w-lg mx-auto px-4 py-6 text-center">
        <p className="text-[var(--muted)]">클럽을 찾을 수 없습니다.</p>
        <button onClick={() => router.back()} className="text-[var(--accent)] text-sm mt-4">뒤로가기</button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/social" className="text-[var(--muted)]"><ArrowLeft size={24} /></Link>
        <h1 className="text-2xl font-bold text-[var(--foreground)] flex-1 truncate">{club.name}</h1>
        {isMember && (
          <button onClick={handleCopyInvite} className="text-[var(--accent)] p-2">
            {copied ? <Check size={20} /> : <Share2 size={20} />}
          </button>
        )}
      </div>

      {/* 클럽 카드 */}
      <div className="card p-6 text-center mb-4">
        <div className="w-16 h-16 rounded-2xl bg-[var(--accent)]/10 flex items-center justify-center mx-auto mb-3">
          {club.logo_url ? (
            <img src={club.logo_url} alt="" className="w-full h-full rounded-2xl object-cover" />
          ) : (
            <Users size={32} className="text-[var(--accent)]" />
          )}
        </div>
        <h2 className="text-3xl font-bold text-[var(--foreground)]">{club.name}</h2>
        {club.description && <p className="text-xs text-[var(--muted)] mt-1">{club.description}</p>}
        <p className="text-sm text-[var(--accent)] font-semibold mt-2">멤버 {club.member_count}명</p>

        {!isMember ? (
          <button onClick={handleJoin} disabled={actionLoading} className="mt-4 inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[var(--accent)] text-white font-semibold text-sm disabled:opacity-50">
            <LogIn size={16} /> 클럽 가입
          </button>
        ) : myRole === 'owner' ? (
          <p className="mt-3 text-sm text-[var(--accent)] font-semibold flex items-center justify-center gap-1"><Crown size={14} /> 클럽 오너</p>
        ) : (
          <button onClick={handleLeave} disabled={actionLoading} className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)] font-semibold text-sm disabled:opacity-50">
            <LogOut size={14} /> 탈퇴
          </button>
        )}
      </div>

      {/* 초대 링크 + QR 카드 */}
      {isMember && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          <button onClick={handleCopyInvite} className="card p-3 flex items-center gap-2 text-left">
            <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
              {copied ? <Check size={18} className="text-green-500" /> : <Copy size={18} className="text-emerald-600" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[var(--foreground)]">{copied ? '복사됨!' : '초대 링크'}</p>
              <p className="text-xs text-[var(--muted)] truncate">URL 복사</p>
            </div>
          </button>
          <button onClick={() => setQrOpen(true)} className="card p-3 flex items-center gap-2 text-left">
            <div className="w-9 h-9 rounded-lg bg-emerald-500 flex items-center justify-center flex-shrink-0">
              <Share2 size={18} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[var(--foreground)]">QR 카드</p>
              <p className="text-xs text-[var(--muted)] truncate">이미지로 공유</p>
            </div>
          </button>
        </div>
      )}

      {/* 탭 */}
      <div className="flex bg-[var(--card)] rounded-xl p-1 mb-4">
        {tabs.filter(t => t.show).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === tab.id ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 대시보드 탭 */}
      {activeTab === 'dashboard' && (
        <div className="space-y-4">
          {/* 이번 주 MVP */}
          {weeklyMvp.length > 0 && (
            <div className="card p-5 bg-gradient-to-br from-amber-50 via-white to-emerald-50 border border-amber-200/60">
              <h3 className="text-base font-bold text-[var(--foreground)] mb-3 flex items-center gap-1.5">
                <Trophy size={18} className="text-amber-500" /> 이번 주 MVP
              </h3>
              <div className="space-y-2.5">
                {weeklyMvp.map(mvp => (
                  <Link key={mvp.category} href={`/social/user?id=${mvp.winner_id}`} className="flex items-center gap-3 p-3 rounded-xl bg-white/70 active:scale-[0.99] transition">
                    <span className="text-2xl">{mvp.emoji}</span>
                    <div className="w-10 h-10 rounded-full bg-[var(--card-border)] overflow-hidden flex-shrink-0">
                      {mvp.winner_avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={mvp.winner_avatar} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-sm font-bold text-[var(--muted)]">
                          {mvp.winner_name.slice(0, 1)}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[var(--muted)]">{mvp.label}</p>
                      <p className="text-base font-bold text-[var(--foreground)] truncate">{mvp.winner_name}</p>
                    </div>
                    <span className="text-lg font-extrabold text-emerald-600">
                      {mvp.category === 'distance' ? `${Number(mvp.value).toFixed(1)}km`
                        : mvp.category === 'runs' ? `${mvp.value}회`
                        : `${mvp.value}일`}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {dashLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
            </div>
          ) : (
            <>
              {/* 요약 카드 */}
              {dashSummary && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="card p-4">
                    <p className="text-xs text-[var(--muted)]">클럽 총 거리</p>
                    <p className="text-3xl font-extrabold text-[var(--accent)]">{dashSummary.totalDistance.toFixed(0)}<span className="text-base ml-1">km</span></p>
                    <p className="text-xs text-[var(--muted)]">{dashSummary.activeMembers}명 활동</p>
                  </div>
                  <div className="card p-4">
                    <p className="text-xs text-[var(--muted)]">인당 평균</p>
                    <p className="text-3xl font-extrabold text-green-600">{dashSummary.avgDistance.toFixed(1)}<span className="text-base ml-1">km</span></p>
                    <p className="text-xs text-[var(--muted)]">활동 멤버 기준</p>
                  </div>
                  <div className="card p-4">
                    <p className="text-xs text-[var(--muted)]">총 러닝</p>
                    <p className="text-3xl font-extrabold text-purple-600">{dashSummary.totalRuns}<span className="text-base ml-1">회</span></p>
                    <p className="text-xs text-[var(--muted)]">{dashSummary.daysRemaining > 0 ? `D-${dashSummary.daysRemaining}` : '이달 완료'}</p>
                  </div>
                  <div className="card p-4">
                    <p className="text-xs text-[var(--muted)]">활동 멤버</p>
                    <p className="text-3xl font-extrabold text-orange-600">{dashSummary.activeMembers}<span className="text-base ml-1">명</span></p>
                    <p className="text-xs text-[var(--muted)]">전체 {dashSummary.totalMembers}명</p>
                  </div>
                </div>
              )}

              {/* 거리 순위 */}
              {dashMembers.length > 0 && (
                <div className="card p-5">
                  <h3 className="text-base font-bold text-[var(--foreground)] mb-3">{dashMonth}월 거리 순위</h3>
                  <div className="space-y-2">
                    {[...dashMembers].sort((a, b) => b.distance_km - a.distance_km).map((m, i) => {
                      const maxDist = dashMembers[0] ? Math.max(...dashMembers.map(x => x.distance_km)) : 1;
                      const barW = maxDist > 0 ? (m.distance_km / maxDist) * 100 : 0;
                      return (
                        <div key={m.user_id} className="flex items-center gap-2">
                          <span className="w-5 text-sm font-bold text-center flex-shrink-0">
                            {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                          </span>
                          <span className="w-14 text-sm truncate flex-shrink-0 font-medium text-[var(--foreground)]">{m.display_name}</span>
                          <div className="flex-1 h-5 bg-[var(--card-border)] rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${m.progress >= 100 ? 'bg-gradient-to-r from-green-400 to-green-500' : 'bg-gradient-to-r from-blue-400 to-blue-500'}`}
                              style={{ width: `${Math.max(barW, 2)}%` }}
                            />
                          </div>
                          <span className="text-xs text-[var(--foreground)] font-semibold w-16 text-right">{m.distance_km.toFixed(1)}km</span>
                          {m.progress >= 100 && <span className="text-sm">✅</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 목표 달성률 */}
              {dashMembers.filter(m => m.goal_km > 0).length > 0 && (
                <div className="card p-5">
                  <h3 className="text-base font-bold text-[var(--foreground)] mb-3">{dashMonth}월 목표 달성률</h3>
                  <div className="space-y-2.5">
                    {[...dashMembers].filter(m => m.goal_km > 0).sort((a, b) => b.progress - a.progress).map(m => (
                      <div key={m.user_id}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-[var(--foreground)]">{m.display_name}</span>
                          <span className="text-xs text-[var(--muted)]">{m.distance_km.toFixed(1)} / {m.goal_km}km</span>
                        </div>
                        <div className="h-4 bg-[var(--card-border)] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${m.progress >= 100 ? 'bg-green-500' : m.progress >= 50 ? 'bg-blue-500' : 'bg-blue-300'}`}
                            style={{ width: `${Math.min(m.progress, 100)}%` }}
                          />
                        </div>
                        <p className="text-xs text-right text-[var(--muted)] mt-0.5">{m.progress.toFixed(0)}%</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 러닝 횟수 */}
              {dashRunCounts.length > 0 && (
                <div className="card p-5">
                  <h3 className="text-base font-bold text-[var(--foreground)] mb-3">{dashMonth}월 러닝 횟수</h3>
                  <div className="space-y-1.5">
                    {dashRunCounts.map(m => {
                      const maxC = Math.max(...dashRunCounts.map(x => x.run_count));
                      const barW = maxC > 0 ? (m.run_count / maxC) * 100 : 0;
                      return (
                        <div key={m.user_id} className="flex items-center gap-2">
                          <span className="w-14 text-sm truncate flex-shrink-0">{m.display_name}</span>
                          <div className="flex-1 h-4 bg-[var(--card-border)] rounded-full overflow-hidden">
                            <div className="h-full rounded-full bg-gradient-to-r from-blue-400 to-blue-500" style={{ width: `${Math.max(barW, 4)}%` }} />
                          </div>
                          <span className="text-xs font-semibold w-8 text-right">{m.run_count}회</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 통산 누적 랭킹 */}
              {dashCumulative.length > 0 && (
                <div className="card p-5">
                  <h3 className="text-base font-bold text-[var(--foreground)] mb-3">통산 누적 랭킹</h3>
                  <div className="space-y-1.5">
                    {dashCumulative.map((m, i) => {
                      const maxD = dashCumulative[0]?.total_distance_km || 1;
                      const barW = (m.total_distance_km / maxD) * 100;
                      return (
                        <div key={m.user_id} className="flex items-center gap-2">
                          <span className="w-5 text-sm font-bold text-center">{i <= 2 ? ['🥇','🥈','🥉'][i] : i + 1}</span>
                          <span className="w-14 text-sm truncate flex-shrink-0">{m.display_name}</span>
                          <div className="flex-1 h-4 bg-[var(--card-border)] rounded-full overflow-hidden">
                            <div className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-indigo-600" style={{ width: `${Math.max(barW, 4)}%` }} />
                          </div>
                          <span className="text-xs font-semibold w-16 text-right">{m.total_distance_km.toFixed(0)}km</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 명예의 전당 */}
              {dashHallOfFame.length > 0 && (
                <div className="card p-5">
                  <h3 className="text-base font-bold text-[var(--foreground)] mb-4">명예의 전당</h3>
                  <div className="space-y-4">
                    {dashHallOfFame.map(cat => (
                      <div key={cat.category} className="bg-[var(--card-border)]/20 rounded-xl p-4">
                        <p className="text-sm font-bold text-[var(--accent)] mb-2">{cat.emoji} {cat.label}</p>
                        <p className="text-xs text-[var(--muted)] mb-2">{cat.description}</p>
                        <div className="space-y-1">
                          {cat.winners.map((w, i) => (
                            <div key={i} className="flex items-center justify-between">
                              <span className="text-sm text-[var(--foreground)]">
                                {i <= 2 ? ['🥇','🥈','🥉'][i] : `${i + 1}`} {w.display_name}
                              </span>
                              <span className="text-sm font-semibold text-[var(--accent)]">{w.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 히스토리 전체 보기 */}
              <Link href="/history" className="card p-4 flex items-center justify-between">
                <span className="text-sm font-semibold text-[var(--foreground)]">전체 히스토리 보기</span>
                <ChevronRight size={16} className="text-[var(--accent)]" />
              </Link>
            </>
          )}
        </div>
      )}

      {/* 피드 탭 — 트위터 스타일 짧은 게시글 + 공지 핀 + 좋아요/댓글 */}
      {activeTab === 'feed' && (
        <div className="space-y-3">
          {/* 작성 버튼 */}
          <button
            onClick={() => setComposeOpen(true)}
            className="w-full flex items-center gap-3 p-4 rounded-2xl bg-white border border-emerald-200 text-[var(--muted)] shadow-sm active:scale-[0.99] transition"
          >
            <MessageSquare size={18} className="text-emerald-600" />
            <span className="text-sm font-semibold">클럽에 글을 남겨보세요...</span>
          </button>

          {feedLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
            </div>
          ) : feedPosts.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="text-base font-semibold text-[var(--foreground)]">아직 게시글이 없어요</p>
              <p className="text-sm text-[var(--muted)] mt-1">첫 글을 남겨보세요!</p>
            </div>
          ) : (
            feedPosts.map(post => {
              const canEdit = post.author_id === user?.id || isAdmin || isAppAdmin;
              const commentsList = openComments[post.id];
              return (
                <div key={post.id} className={`card p-4 ${post.is_notice ? 'border-emerald-300 bg-emerald-50/40' : ''}`}>
                  {post.is_notice && (
                    <div className="flex items-center gap-1 text-xs font-bold text-emerald-700 mb-2">
                      <Pin size={12} /> 공지
                    </div>
                  )}
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-full bg-[var(--card-border)] overflow-hidden flex-shrink-0">
                      {post.author_avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={post.author_avatar} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs font-bold text-[var(--muted)]">
                          {post.author_name.slice(0, 1)}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 text-sm">
                        <span className="font-bold text-[var(--foreground)]">{post.author_name}</span>
                        {post.author_role === 'owner' && <Crown size={12} className="text-amber-500" />}
                        {post.author_role === 'admin' && <Shield size={12} className="text-emerald-600" />}
                        <span className="text-xs text-[var(--muted)]">· {new Date(post.created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <p className="mt-1 text-base leading-relaxed text-[var(--foreground)] whitespace-pre-wrap break-words">{post.body}</p>
                      {post.photo_url && (
                        <div className="mt-2 rounded-xl overflow-hidden">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={post.photo_url} alt="" className="w-full max-h-96 object-cover" />
                        </div>
                      )}
                      <div className="mt-3 flex items-center gap-5 text-sm">
                        <button onClick={() => handleLike(post)} className={`flex items-center gap-1 ${post.liked_by_me ? 'text-rose-500 font-semibold' : 'text-[var(--muted)]'}`}>
                          <Heart size={16} fill={post.liked_by_me ? 'currentColor' : 'none'} />
                          {post.like_count}
                        </button>
                        <button onClick={() => handleOpenComments(post.id)} className="flex items-center gap-1 text-[var(--muted)]">
                          <MessageSquare size={16} /> {post.comment_count}
                        </button>
                        {isAdmin && (
                          <button onClick={() => handleToggleNotice(post)} className={`flex items-center gap-1 ${post.is_notice ? 'text-emerald-600 font-semibold' : 'text-[var(--muted)]'}`}>
                            <Pin size={16} /> {post.is_notice ? '공지 해제' : '공지로'}
                          </button>
                        )}
                        {canEdit && (
                          <button onClick={() => handleDeletePost(post)} className="ml-auto text-[var(--muted)] hover:text-rose-500">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>

                      {/* 댓글 */}
                      {commentsList && (
                        <div className="mt-3 pt-3 border-t border-[var(--card-border)] space-y-2">
                          {commentsList.length === 0 ? (
                            <p className="text-sm text-[var(--muted)]">첫 댓글을 남겨보세요</p>
                          ) : commentsList.map(c => (
                            <div key={c.id} className="flex items-start gap-2">
                              <div className="w-6 h-6 rounded-full bg-[var(--card-border)] overflow-hidden flex-shrink-0">
                                {c.profiles?.avatar_url ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={c.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-[10px] font-bold text-[var(--muted)]">
                                    {(c.profiles?.display_name ?? '?').slice(0, 1)}
                                  </div>
                                )}
                              </div>
                              <div className="flex-1">
                                <p className="text-sm">
                                  <span className="font-semibold text-[var(--foreground)]">{c.profiles?.display_name ?? '러너'}</span>
                                  <span className="text-[var(--foreground)] ml-2">{c.body}</span>
                                </p>
                                <p className="text-xs text-[var(--muted)] mt-0.5">{new Date(c.created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                              </div>
                            </div>
                          ))}
                          <div className="flex gap-2 pt-1">
                            <input
                              type="text"
                              value={commentDraft[post.id] ?? ''}
                              onChange={e => setCommentDraft(prev => ({ ...prev, [post.id]: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Enter') handleSubmitComment(post.id); }}
                              placeholder="댓글 남기기..."
                              className="flex-1 px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                            />
                            <button onClick={() => handleSubmitComment(post.id)} className="px-3 py-2 rounded-lg bg-emerald-500 text-white">
                              <Send size={14} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {/* 작성 모달 */}
          {composeOpen && (
            <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 backdrop-blur-sm" onClick={() => setComposeOpen(false)}>
              <div className="w-full max-w-lg bg-[var(--card-bg)] rounded-t-3xl p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] space-y-3 animate-slide-up" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold text-[var(--foreground)]">새 게시글</h3>
                  <button onClick={() => setComposeOpen(false)} className="text-[var(--muted)]"><X size={20} /></button>
                </div>
                <textarea
                  value={composeBody}
                  onChange={e => setComposeBody(e.target.value.slice(0, 500))}
                  placeholder="클럽에 공유할 이야기를 적어보세요..."
                  rows={5}
                  className="w-full p-3 rounded-xl bg-[var(--background)] border border-[var(--card-border)] text-base focus:outline-none focus:ring-2 focus:ring-emerald-500/40 resize-none"
                />
                <p className="text-xs text-[var(--muted)] text-right">{composeBody.length} / 500</p>
                {composePhoto && (
                  <div className="relative rounded-xl overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={URL.createObjectURL(composePhoto)} alt="" className="w-full max-h-48 object-cover" />
                    <button onClick={() => setComposePhoto(null)} className="absolute top-2 right-2 bg-black/60 rounded-full p-1"><X size={14} className="text-white" /></button>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-sm text-emerald-600 font-semibold cursor-pointer">
                    <ImageIcon size={18} />
                    사진
                    <input type="file" accept="image/*" hidden onChange={e => setComposePhoto(e.target.files?.[0] ?? null)} />
                  </label>
                  {isAdmin && (
                    <label className="flex items-center gap-1.5 text-sm text-[var(--foreground)] cursor-pointer ml-auto">
                      <input type="checkbox" checked={composeIsNotice} onChange={e => setComposeIsNotice(e.target.checked)} className="accent-emerald-500" />
                      <Pin size={14} /> 공지로 등록
                    </label>
                  )}
                </div>
                <button
                  onClick={handleCompose}
                  disabled={composing || !composeBody.trim()}
                  className="w-full py-3 rounded-xl bg-emerald-500 text-white font-bold text-base disabled:opacity-50"
                >
                  {composing ? '올리는 중...' : '게시하기'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 챌린지·모임 탭 */}
      {activeTab === 'challenges' && (
        <div className="space-y-5">
          {/* 섹션: 챌린지 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-bold text-[var(--foreground)] flex items-center gap-1.5">
                <Flame size={18} className="text-emerald-600" /> 챌린지
              </h3>
              {isAdmin && (
                <button onClick={() => setChOpen(true)} className="text-sm font-semibold text-emerald-600 flex items-center gap-0.5">
                  <TrendingUp size={14} /> 만들기
                </button>
              )}
            </div>
            {challenges.length === 0 ? (
              <div className="card p-5 text-center text-sm text-[var(--muted)]">
                {isAdmin ? '첫 챌린지를 만들어 보세요 (예: "이번 주 10km")' : '진행 중인 챌린지가 없어요'}
              </div>
            ) : challenges.map(ch => {
              const today = new Date().toISOString().slice(0, 10);
              const isActive = ch.start_date <= today && today <= ch.end_date;
              const isPast = today > ch.end_date;
              const prog = challengeProgress[ch.id] ?? [];
              return (
                <div key={ch.id} className={`card p-4 mb-2 ${isActive ? 'border-emerald-300 bg-emerald-50/30' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isActive ? 'bg-emerald-500 text-white' : isPast ? 'bg-[var(--card-border)] text-[var(--muted)]' : 'bg-amber-100 text-amber-700'}`}>
                          {isActive ? '진행중' : isPast ? '종료' : '예정'}
                        </span>
                        <p className="text-base font-bold text-[var(--foreground)] truncate">{ch.title}</p>
                      </div>
                      {ch.description && <p className="text-sm text-[var(--muted)] mt-1">{ch.description}</p>}
                      <p className="text-xs text-[var(--muted)] mt-1">
                        {ch.start_date} ~ {ch.end_date}
                        {ch.target_km && ` · ${ch.target_km}km`}
                        {ch.target_run_count && ` · ${ch.target_run_count}회`}
                      </p>
                    </div>
                    {(isAdmin || ch.created_by === user?.id) && (
                      <button onClick={() => handleDeleteChallenge(ch.id)} className="text-[var(--muted)] hover:text-rose-500 flex-shrink-0">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  {/* 진행도 */}
                  {prog.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-[var(--card-border)] space-y-2">
                      {prog.slice(0, 5).map(p => {
                        const pct = p.km_pct ?? p.count_pct ?? 0;
                        return (
                          <div key={p.user_id}>
                            <div className="flex items-center justify-between text-sm mb-1">
                              <span className="font-semibold text-[var(--foreground)]">
                                {p.display_name}{p.completed ? ' ✅' : ''}
                              </span>
                              <span className="text-[var(--muted)]">
                                {ch.target_km ? `${Number(p.distance_km).toFixed(1)}/${ch.target_km}km` : `${p.run_count}/${ch.target_run_count}회`}
                              </span>
                            </div>
                            <div className="h-2 bg-[var(--card-border)] rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${p.completed ? 'bg-emerald-500' : 'bg-emerald-400/70'}`}
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 섹션: 이벤트 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-bold text-[var(--foreground)] flex items-center gap-1.5">
                <Zap size={18} className="text-amber-500" /> 모임
              </h3>
              <button onClick={() => setEvOpen(true)} className="text-sm font-semibold text-emerald-600 flex items-center gap-0.5">
                <TrendingUp size={14} /> 모임 만들기
              </button>
            </div>
            {events.length === 0 ? (
              <div className="card p-5 text-center text-sm text-[var(--muted)]">
                예정된 모임이 없어요. "주말 한강 러닝" 같은 모임을 만들어보세요!
              </div>
            ) : events.map(ev => {
              const isPast = new Date(ev.event_at) < new Date();
              const myStatus = ev.my_status;
              return (
                <div key={ev.id} className={`card p-4 mb-2 ${isPast ? 'opacity-70' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-bold text-[var(--foreground)]">{ev.title}</p>
                      <p className="text-sm text-emerald-700 font-semibold mt-0.5">
                        📅 {new Date(ev.event_at).toLocaleString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                      {ev.location && <p className="text-sm text-[var(--muted)] mt-0.5">📍 {ev.location}</p>}
                      {ev.description && <p className="text-sm text-[var(--foreground)] mt-2 whitespace-pre-wrap">{ev.description}</p>}
                      <p className="text-xs text-[var(--muted)] mt-2">
                        {ev.created_by_name} · 참석 <b className="text-emerald-600">{ev.going_count}</b>
                        {ev.maybe_count > 0 && ` · 관심 ${ev.maybe_count}`}
                        {ev.max_participants && ` / ${ev.max_participants}명`}
                      </p>
                    </div>
                    {(isAdmin || ev.created_by === user?.id) && (
                      <button onClick={() => handleDeleteEvent(ev.id)} className="text-[var(--muted)] hover:text-rose-500 flex-shrink-0">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  {!isPast && (
                    <div className="mt-3 pt-3 border-t border-[var(--card-border)] flex gap-2">
                      <button onClick={() => handleRsvp(ev.id, 'going')}
                        className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${myStatus === 'going' ? 'bg-emerald-500 text-white' : 'bg-[var(--card-border)]/40 text-[var(--muted)]'}`}>
                        참석 ✊
                      </button>
                      <button onClick={() => handleRsvp(ev.id, 'maybe')}
                        className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${myStatus === 'maybe' ? 'bg-amber-400 text-white' : 'bg-[var(--card-border)]/40 text-[var(--muted)]'}`}>
                        관심
                      </button>
                      <button onClick={() => handleRsvp(ev.id, 'no')}
                        className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${myStatus === 'no' ? 'bg-rose-400 text-white' : 'bg-[var(--card-border)]/40 text-[var(--muted)]'}`}>
                        불참
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 챌린지 작성 모달 */}
          {chOpen && (
            <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 backdrop-blur-sm" onClick={() => setChOpen(false)}>
              <div className="w-full max-w-lg bg-[var(--card-bg)] rounded-t-3xl p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] space-y-3 animate-slide-up" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold text-[var(--foreground)]">새 챌린지</h3>
                  <button onClick={() => setChOpen(false)}><X size={20} className="text-[var(--muted)]" /></button>
                </div>
                <input value={chTitle} onChange={e => setChTitle(e.target.value)} placeholder="제목 (예: 이번 주 10km 챌린지)" maxLength={60}
                  className="w-full p-3 rounded-xl bg-[var(--background)] border border-[var(--card-border)] text-base focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                <textarea value={chDesc} onChange={e => setChDesc(e.target.value.slice(0, 300))} placeholder="설명 (선택)" rows={2}
                  className="w-full p-3 rounded-xl bg-[var(--background)] border border-[var(--card-border)] text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 resize-none" />
                <div className="grid grid-cols-2 gap-2">
                  <input value={chTargetKm} onChange={e => setChTargetKm(e.target.value)} type="number" step="0.1" placeholder="목표 km"
                    className="w-full p-3 rounded-xl bg-[var(--background)] border border-[var(--card-border)] text-base focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                  <input value={chTargetCount} onChange={e => setChTargetCount(e.target.value)} type="number" placeholder="목표 횟수"
                    className="w-full p-3 rounded-xl bg-[var(--background)] border border-[var(--card-border)] text-base focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                </div>
                <p className="text-xs text-[var(--muted)]">둘 중 하나 이상 입력. 둘 다 달성해야 완료.</p>
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" value={chStart} onChange={e => setChStart(e.target.value)}
                    className="w-full p-3 rounded-xl bg-[var(--background)] border border-[var(--card-border)] text-sm" />
                  <input type="date" value={chEnd} onChange={e => setChEnd(e.target.value)}
                    className="w-full p-3 rounded-xl bg-[var(--background)] border border-[var(--card-border)] text-sm" />
                </div>
                <button onClick={handleCreateChallenge} disabled={!chTitle.trim() || (!chTargetKm && !chTargetCount)}
                  className="w-full py-3 rounded-xl bg-emerald-500 text-white font-bold text-base disabled:opacity-50">
                  챌린지 시작
                </button>
              </div>
            </div>
          )}

          {/* 이벤트 작성 모달 */}
          {evOpen && (
            <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 backdrop-blur-sm" onClick={() => setEvOpen(false)}>
              <div className="w-full max-w-lg bg-[var(--card-bg)] rounded-t-3xl p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] space-y-3 animate-slide-up" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold text-[var(--foreground)]">새 모임</h3>
                  <button onClick={() => setEvOpen(false)}><X size={20} className="text-[var(--muted)]" /></button>
                </div>
                <input value={evTitle} onChange={e => setEvTitle(e.target.value)} placeholder="모임 제목 (예: 한강 5km 러닝)" maxLength={80}
                  className="w-full p-3 rounded-xl bg-[var(--background)] border border-[var(--card-border)] text-base focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                <input type="datetime-local" value={evDate} onChange={e => setEvDate(e.target.value)}
                  className="w-full p-3 rounded-xl bg-[var(--background)] border border-[var(--card-border)] text-base" />
                <input value={evLocation} onChange={e => setEvLocation(e.target.value)} placeholder="장소 (예: 반포 한강공원)" maxLength={120}
                  className="w-full p-3 rounded-xl bg-[var(--background)] border border-[var(--card-border)] text-base focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                <input value={evMax} onChange={e => setEvMax(e.target.value)} type="number" placeholder="최대 인원 (비우면 제한 없음)"
                  className="w-full p-3 rounded-xl bg-[var(--background)] border border-[var(--card-border)] text-base" />
                <textarea value={evDesc} onChange={e => setEvDesc(e.target.value.slice(0, 500))} placeholder="소개 (선택)" rows={3}
                  className="w-full p-3 rounded-xl bg-[var(--background)] border border-[var(--card-border)] text-sm resize-none" />
                <button onClick={handleCreateEvent} disabled={!evTitle.trim() || !evDate}
                  className="w-full py-3 rounded-xl bg-emerald-500 text-white font-bold text-base disabled:opacity-50">
                  모임 만들기
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 멤버 탭 */}
      {activeTab === 'members' && (
        <div className="card px-4">
          <div className="divide-y divide-[var(--card-border)]">
            {members.map((member) => (
              <div key={member.user_id} className="flex items-center gap-3 py-3">
                <Link href={`/profile/view?id=${member.user_id}`} className="flex-shrink-0">
                  <div className="w-10 h-10 rounded-full bg-[var(--card-border)] overflow-hidden">
                    {member.profile?.avatar_url ? (
                      <img src={member.profile.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><AppLogo size={24} /></div>
                    )}
                  </div>
                </Link>
                <Link href={`/profile/view?id=${member.user_id}`} className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--foreground)] truncate">{member.profile?.display_name ?? '러너'}</p>
                  <p className="text-xs text-[var(--muted)]">{Number(member.profile?.total_distance_km ?? 0).toFixed(1)}km · {member.profile?.total_runs ?? 0}회</p>
                </Link>
                {member.role !== 'member' && (
                  <span className={`text-sm font-semibold px-2 py-0.5 rounded-full ${
                    member.role === 'owner' ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'bg-yellow-100 dark:bg-yellow-500/10 text-yellow-600'
                  }`}>{member.role === 'owner' ? '오너' : '관리자'}</span>
                )}
                {/* 관리자 액션 */}
                {isAdmin && member.user_id !== user?.id && member.role !== 'owner' && (
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleRoleChange(member.user_id, member.role === 'admin' ? 'member' : 'admin')}
                      title={member.role === 'admin' ? '관리자 해제' : '관리자 지정'}
                      className="p-1.5 rounded-lg hover:bg-[var(--card-border)] text-[var(--muted)]"
                    >
                      {member.role === 'admin' ? <ShieldOff size={14} /> : <Shield size={14} />}
                    </button>
                    <button
                      onClick={() => handleRemoveMember(member.user_id, member.profile?.display_name ?? '러너')}
                      title="추방"
                      className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-red-400"
                    >
                      <UserMinus size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 활동 탭 */}
      {activeTab === 'activity' && (
        <div className="space-y-2">
          {activities.length === 0 ? (
            <div className="card p-8 text-center">
              <Activity size={32} className="mx-auto mb-2 text-[var(--muted)]" />
              <p className="text-xs text-[var(--muted)]">아직 클럽 활동이 없습니다</p>
            </div>
          ) : (
            activities.map((a: any) => {
              const cheers = cheersMap.get(a.id) ?? [];
              const isMine = a.user_id === user?.id;
              const showCheerBar = cheerOpen === a.id;
              return (
                <div key={a.id} className="card p-4">
                  <Link href={`/activity?id=${a.id}`} className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-[var(--card-border)] overflow-hidden flex-shrink-0">
                      {a.profiles?.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center"><AppLogo size={18} /></div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[var(--foreground)]">
                        {a.profiles?.display_name ?? '러너'}
                        <span className="text-[var(--muted)] font-normal ml-2">{Number(a.distance_km).toFixed(2)}km</span>
                      </p>
                      <p className="text-xs text-[var(--muted)]">
                        {new Date(a.activity_date).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short' })}
                        {a.duration_seconds ? ` · ${formatDuration(a.duration_seconds)}` : ''}
                        {a.pace_avg_sec_per_km ? ` · ${formatPace(a.pace_avg_sec_per_km)}/km` : ''}
                      </p>
                    </div>
                  </Link>

                  {/* 응원 이모지 바 */}
                  <div className="mt-3 pt-3 border-t border-[var(--card-border)] flex items-center gap-1.5 flex-wrap">
                    {cheers.map(c => (
                      <button
                        key={c.emoji}
                        onClick={() => !isMine && handleToggleCheer(a.id, c.emoji as CheerEmoji)}
                        disabled={isMine}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-semibold transition-all ${
                          c.cheered_by_me ? 'bg-emerald-100 border-2 border-emerald-400' : 'bg-[var(--card-border)]/30'
                        } ${isMine ? 'opacity-70 cursor-not-allowed' : 'active:scale-95'}`}
                      >
                        <span>{c.emoji}</span>
                        <span className="text-xs">{c.total}</span>
                      </button>
                    ))}
                    {!isMine && (
                      <button
                        onClick={() => setCheerOpen(showCheerBar ? null : a.id)}
                        className="px-2.5 py-1 rounded-full bg-[var(--card-border)]/30 text-[var(--muted)] text-sm active:scale-95 transition"
                      >
                        + 응원
                      </button>
                    )}
                    {isMine && cheers.length === 0 && (
                      <span className="text-xs text-[var(--muted)]">내 활동은 클럽원의 응원을 받을 수 있어요</span>
                    )}
                  </div>
                  {showCheerBar && !isMine && (
                    <div className="mt-2 flex gap-1.5">
                      {CHEER_EMOJIS.map(em => {
                        const existing = cheers.find(c => c.emoji === em);
                        const active = existing?.cheered_by_me;
                        return (
                          <button
                            key={em}
                            onClick={() => { handleToggleCheer(a.id, em); setCheerOpen(null); }}
                            className={`flex-1 py-2 rounded-lg text-2xl transition-all active:scale-90 ${active ? 'bg-emerald-100 ring-2 ring-emerald-400' : 'bg-[var(--card-border)]/30 hover:bg-[var(--card-border)]/60'}`}
                          >
                            {em}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* 초대 QR 카드 모달 */}
      {qrOpen && club && (
        <InviteQRCard
          clubName={club.name}
          clubDescription={club.description ?? null}
          memberCount={club.member_count}
          inviteUrl={getInviteUrl()}
          onClose={() => setQrOpen(false)}
        />
      )}

      {/* 결산 탭 — 외부(앱 미가입) 멤버 월별 결산 */}
      {activeTab === 'archive' && clubId && (
        <ClubExternalArchive clubId={clubId} />
      )}

      {/* 설정 탭 */}
      {activeTab === 'settings' && (isAdmin || isAppAdmin) && (
        <div className="card p-5 space-y-4">
          {isAdmin && (<>

          <div>
            <label className="text-sm font-semibold text-[var(--muted)] mb-1 block">클럽 이름</label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              maxLength={30}
              className="w-full px-4 py-2.5 rounded-xl bg-[var(--background)] border border-[var(--card-border)] text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
          <div>
            <label className="text-sm font-semibold text-[var(--muted)] mb-1 block">소개</label>
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              maxLength={200}
              rows={3}
              className="w-full px-4 py-2.5 rounded-xl bg-[var(--background)] border border-[var(--card-border)] text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-[var(--foreground)]">공개 클럽</p>
              <p className="text-xs text-[var(--muted)]">누구나 검색하고 가입할 수 있습니다</p>
            </div>
            <button
              onClick={() => setEditPublic(!editPublic)}
              className={`w-12 h-7 rounded-full transition-colors ${editPublic ? 'bg-[var(--accent)]' : 'bg-[var(--card-border)]'}`}
            >
              <div className={`w-5 h-5 bg-white rounded-full transition-transform mx-1 ${editPublic ? 'translate-x-5' : ''}`} />
            </button>
          </div>
          <button
            onClick={handleSaveSettings}
            disabled={saving || !editName.trim()}
            className="w-full py-3 rounded-xl bg-[var(--accent)] text-white font-semibold text-sm disabled:opacity-50"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
          </>)}

          {/* 삭제 영역 — 방장 또는 앱 관리자만 표시 */}
          {canDelete && (
            <div className="pt-4 border-t border-[var(--card-border)]">
              <p className="text-xs text-[var(--muted)] mb-2">
                {myRole === 'owner' ? '이 클럽을 삭제합니다.' : '앱 관리자 권한으로 이 클럽을 삭제합니다.'} 되돌릴 수 없습니다.
              </p>
              <button
                onClick={handleDeleteClub}
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500 text-white font-bold text-sm disabled:opacity-50"
              >
                <Trash2 size={16} />
                {saving ? '삭제 중...' : isAppAdmin && myRole !== 'owner' ? '[관리자] 이 클럽 삭제' : '이 클럽 삭제'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ClubDetailPage() {
  return <Suspense fallback={<div className="flex justify-center py-20"><div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" /></div>}><ClubDetail /></Suspense>;
}
