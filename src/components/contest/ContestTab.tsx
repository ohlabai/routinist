'use client';

// 하루 대회 (Daily Contest) — 랭킹 탭 서브탭 (build 106).
// 친구끼리 모여 같은 날 달리고 결과를 모아 랭킹으로 보는 즉석 친선전.

import { useEffect, useState, useCallback } from 'react';
import { Plus, Users, Clock, Trophy, Flag, X, MapPin, Calendar, Globe } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/components/UserDataProvider';
import { fetchFollowing } from '@/lib/social-data';
import {
  fetchMyContests,
  createDailyContest,
  submitContestResult,
  fetchContestLeaderboard,
  finishContest,
  fetchPublicContests,
  joinPublicContest,
  contestEventLabel,
  formatContestValue,
  type ContestSummary,
  type ContestLeaderRow,
  type ContestEvent,
  type PublicContest,
} from '@/lib/contest-data';
import { todayStr } from '@/lib/kst';
import AppToast from '@/components/AppToast';
import type { Profile } from '@/types';

export default function ContestTab() {
  const { user, profile } = useAuth();
  const { activities } = useUserData();
  const [items, setItems] = useState<ContestSummary[]>([]);
  const [publicList, setPublicList] = useState<PublicContest[]>([]);
  const [loading, setLoading] = useState(true);
  const [composeOpen, setComposeOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [joining, setJoining] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const showToast = useCallback((text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2200);
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [mine, pub] = await Promise.all([
        fetchMyContests().catch(() => [] as ContestSummary[]),
        fetchPublicContests(profile?.region_gu ?? null, true).catch(() => [] as PublicContest[]),
      ]);
      setItems(mine);
      // 본인이 호스트한 공개 친선런은 내 친선런 카드에 이미 나오므로 publicList 에서 제외
      const mineIds = new Set(mine.map(m => m.contest_id));
      setPublicList(pub.filter(p => !mineIds.has(p.contest_id)));
    } catch (e) {
      console.warn('[contest] load fail', e);
    } finally {
      setLoading(false);
    }
  }, [user, profile?.region_gu]);

  const handleJoinPublic = async (c: PublicContest) => {
    if (joining === c.contest_id) return;
    setJoining(c.contest_id);
    try {
      await joinPublicContest(c.contest_id);
      showToast('✨ 참가 신청됨');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '참가 실패', 'warn');
    } finally {
      setJoining(null);
    }
  };

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5">
      {/* 공개 모집판 (build 116 A) — 같은 동네 사용자가 만든 공개 친선런 */}
      {publicList.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-extrabold inline-flex items-center gap-1.5">
              <Globe size={14} className="text-emerald-500" /> 모집판 · {profile?.region_gu ?? '내 동네'}
            </h2>
            <span className="text-[10px] text-[var(--muted)] font-bold">{publicList.length}건</span>
          </div>
          <div className="space-y-2">
            {publicList.map(c => (
              <article key={c.contest_id} className="rounded-2xl bg-gradient-to-br from-emerald-50/60 to-emerald-50/20 dark:from-emerald-950/30 dark:to-emerald-950/10 border border-emerald-200/60 dark:border-emerald-900/40 p-4">
                <div className="flex items-start gap-2.5">
                  <Link href={`/social/user?id=${c.host_user_id}`} className="w-10 h-10 rounded-full bg-[var(--card-border)]/40 overflow-hidden flex-shrink-0">
                    {c.host_avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.host_avatar} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-sm font-bold text-[var(--muted)]">{c.host_name?.slice(0,1)}</div>
                    )}
                  </Link>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-extrabold truncate">{c.title}</p>
                    <p className="text-[11px] text-[var(--muted)] mt-0.5">{c.host_name} 모집 · {c.host_region_gu}</p>
                  </div>
                  <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex-shrink-0">
                    {contestEventLabel(c.event_type)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="inline-flex items-center gap-1 text-[var(--muted)] font-semibold">
                    <Calendar size={11} /> {c.contest_date}{c.meetup_time ? ` · ${c.meetup_time}` : ''}
                  </span>
                  {c.meetup_location && (
                    <span className="inline-flex items-center gap-1 text-[var(--muted)] font-semibold truncate">
                      <MapPin size={11} /> {c.meetup_location}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 text-emerald-600 font-bold">
                    <Users size={11} /> {c.participant_count}{c.max_participants ? `/${c.max_participants}` : ''}
                  </span>
                </div>
                <div className="mt-2.5 flex gap-2">
                  <button
                    onClick={() => setDetailId(c.contest_id)}
                    className="flex-1 py-2 rounded-xl bg-[var(--card)] border border-[var(--card-border)] font-bold text-xs active:scale-95"
                  >
                    자세히
                  </button>
                  {c.my_joined ? (
                    <span className="flex-1 py-2 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-center font-bold text-xs">참가 완료</span>
                  ) : (
                    <button
                      onClick={() => handleJoinPublic(c)}
                      disabled={joining === c.contest_id || (c.max_participants !== null && c.participant_count >= c.max_participants)}
                      className="flex-1 py-2 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-xs disabled:opacity-50 active:scale-95"
                    >
                      {joining === c.contest_id ? '신청 중…' : '참가 신청'}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* 헤더 + 만들기 */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-extrabold">내 친선런</h2>
        <button
          onClick={() => setComposeOpen(true)}
          className="inline-flex items-center gap-1 px-3.5 py-2 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-bold text-sm shadow active:scale-95"
        >
          <Plus size={14} /> 만들기
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map(i => (
            <div key={i} className="card p-4 animate-pulse h-24" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="card p-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 mx-auto mb-2 flex items-center justify-center">
            <Users size={26} className="text-emerald-600" />
          </div>
          <p className="text-base font-extrabold">아직 참여한 친선런이 없어요</p>
          <p className="text-sm text-[var(--muted)] mt-1">친구와 짧은 친선전을 만들어 보세요</p>
          <button
            onClick={() => setComposeOpen(true)}
            className="mt-3 inline-flex items-center gap-1 px-4 py-2 rounded-full bg-emerald-500 text-white font-bold text-sm active:scale-95"
          >
            <Plus size={14} /> 첫 친선런 만들기
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(c => (
            <button
              key={c.contest_id}
              onClick={() => setDetailId(c.contest_id)}
              className="card p-4 w-full text-left active:scale-[0.99]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-extrabold text-[var(--foreground)] truncate">{c.title}</p>
                  <p className="text-xs text-[var(--muted)] mt-0.5 inline-flex items-center gap-1.5">
                    <Clock size={11} /> {c.contest_date}
                    <span>·</span>
                    <span>{contestEventLabel(c.event_type)}</span>
                    <span>·</span>
                    <span>호스트 {c.host_name}</span>
                  </p>
                </div>
                <StatusPill status={c.status} />
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs">
                <span className="inline-flex items-center gap-1 text-[var(--muted)]">
                  <Users size={11} /> {c.participant_count}명
                </span>
                <span className="inline-flex items-center gap-1 text-emerald-600 font-bold">
                  <Flag size={11} /> {c.submitted_count}건 제출
                </span>
                {!c.my_submitted && c.host_user_id !== user?.id && (
                  <span className="ml-auto text-amber-600 font-bold">결과 제출 필요</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {composeOpen && (
        <ContestComposeModal
          myUserId={user?.id ?? ''}
          myName={profile?.display_name ?? '나'}
          onClose={() => setComposeOpen(false)}
          onCreated={() => { setComposeOpen(false); load(); showToast('✨ 친선런이 만들어졌어요'); }}
          onError={(msg) => showToast(msg, 'warn')}
        />
      )}

      {detailId && (
        <ContestDetailSheet
          contestId={detailId}
          myUserId={user?.id ?? ''}
          activities={activities ?? []}
          onClose={() => setDetailId(null)}
          onChanged={() => load()}
          onError={(msg) => showToast(msg, 'warn')}
          onToast={showToast}
        />
      )}

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2200} />}
    </div>
  );
}

function StatusPill({ status }: { status: 'open' | 'running' | 'finished' }) {
  const map = {
    open: { label: '모집중', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
    running: { label: '진행중', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
    finished: { label: '마감', cls: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200' },
  } as const;
  const s = map[status];
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>;
}

// ── 대회 만들기 모달 ─────────────────────────────────────
function ContestComposeModal({ myUserId, myName, onClose, onCreated, onError }: {
  myUserId: string;
  myName: string;
  onClose: () => void;
  onCreated: () => void;
  onError: (msg: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [contestDate, setContestDate] = useState(todayStr());
  const [eventType, setEventType] = useState<ContestEvent>('distance');
  const [friends, setFriends] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPublic, setIsPublic] = useState(false);
  const [meetupLocation, setMeetupLocation] = useState('');
  const [meetupTime, setMeetupTime] = useState('');
  const [maxParticipants, setMaxParticipants] = useState<number | ''>('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!myUserId) return;
    fetchFollowing(myUserId).then(setFriends).catch(() => setFriends([]));
  }, [myUserId]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleCreate = async () => {
    const t = title.trim();
    if (t.length < 2) { onError('제목이 너무 짧아요 (2자 이상)'); return; }
    setCreating(true);
    try {
      await createDailyContest(t, contestDate, eventType, Array.from(selected), {
        isPublic,
        meetupLocation: meetupLocation.trim() || null,
        meetupTime: meetupTime.trim() || null,
        maxParticipants: typeof maxParticipants === 'number' ? maxParticipants : null,
      });
      onCreated();
    } catch (e) {
      onError(e instanceof Error ? e.message : '생성 실패');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/65 flex items-end sm:items-center justify-center p-3 animate-[fadeIn_0.2s_ease-out]" onClick={() => !creating && onClose()}>
      <div className="w-full max-w-md bg-[var(--background)] rounded-3xl p-5 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-base font-extrabold inline-flex items-center gap-1.5">
            <Users size={16} className="text-emerald-500" /> 친선런 만들기
          </h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--card-border)]/40 active:scale-90">
            <X size={16} />
          </button>
        </div>

        <label className="block text-xs font-bold text-[var(--muted)] mb-1">제목</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 80))}
          placeholder="예) 토요일 한강 모임"
          className="w-full px-3.5 py-2.5 rounded-xl border-2 border-[var(--card-border)] bg-[var(--background)] text-sm focus:outline-none focus:border-emerald-500"
        />

        <div className="grid grid-cols-2 gap-2 mt-3">
          <div>
            <label className="block text-xs font-bold text-[var(--muted)] mb-1">날짜</label>
            <input
              type="date"
              value={contestDate}
              onChange={(e) => setContestDate(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border-2 border-[var(--card-border)] bg-[var(--background)] text-sm focus:outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[var(--muted)] mb-1">종목</label>
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value as ContestEvent)}
              className="w-full px-3 py-2.5 rounded-xl border-2 border-[var(--card-border)] bg-[var(--background)] text-sm focus:outline-none focus:border-emerald-500"
            >
              <option value="distance">거리 (긴 사람 우승)</option>
              <option value="duration">시간 (오래 달림)</option>
              <option value="pace">페이스 (빠른 사람)</option>
            </select>
          </div>
        </div>

        {/* 공개 모집 토글 (build 116 A) */}
        <button
          type="button"
          onClick={() => setIsPublic(!isPublic)}
          className={`w-full mt-3 flex items-start gap-3 p-3 rounded-2xl border-2 text-left active:scale-[0.99] transition ${
            isPublic ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-300/60 dark:border-emerald-800/40' : 'bg-[var(--card)] border-[var(--card-border)]'
          }`}
        >
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
            isPublic ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white' : 'bg-[var(--card-border)]/40 text-[var(--muted)]'
          }`}>
            <Globe size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-extrabold">{isPublic ? '공개 모집판 (같은 동네 누구나)' : '친구 초대만'}</p>
            <p className="text-[11px] text-[var(--muted)] mt-0.5 leading-snug">
              {isPublic ? '내 동네 러너들이 모집판에서 보고 참가 신청해요.' : '선택한 친구들만 참가할 수 있어요.'}
            </p>
          </div>
        </button>

        {/* 공개 모집 때만 — 만남 장소·시간·인원 */}
        {isPublic && (
          <div className="mt-2 space-y-2 px-1">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-bold text-[var(--muted)] mb-1">시간 (선택)</label>
                <input
                  type="time"
                  value={meetupTime}
                  onChange={(e) => setMeetupTime(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border-2 border-[var(--card-border)] bg-[var(--background)] text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[var(--muted)] mb-1">정원 (선택)</label>
                <input
                  type="number"
                  min={2}
                  max={50}
                  value={maxParticipants}
                  onChange={(e) => setMaxParticipants(e.target.value ? Math.max(2, Math.min(50, Number(e.target.value))) : '')}
                  placeholder="제한 없음"
                  className="w-full px-3 py-2 rounded-xl border-2 border-[var(--card-border)] bg-[var(--background)] text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-[var(--muted)] mb-1">만남 장소 (선택)</label>
              <input
                value={meetupLocation}
                onChange={(e) => setMeetupLocation(e.target.value.slice(0, 80))}
                placeholder="예) 한강 잠실대교 북단"
                className="w-full px-3 py-2 rounded-xl border-2 border-[var(--card-border)] bg-[var(--background)] text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>
        )}

        <label className="block text-xs font-bold text-[var(--muted)] mt-3 mb-1">
          {isPublic ? '미리 초대 (선택)' : `참가자 (${selected.size + 1}명 · 나 포함)`}
        </label>
        {friends.length === 0 ? (
          <p className="text-xs text-[var(--muted)] italic">아직 친구가 없어요. 일단 나 혼자 시작할 수 있어요.</p>
        ) : (
          <div className="max-h-48 overflow-y-auto space-y-1 border border-[var(--card-border)] rounded-xl p-2">
            {friends.map(f => (
              <button
                key={f.id}
                onClick={() => toggle(f.id)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition ${
                  selected.has(f.id) ? 'bg-emerald-50 dark:bg-emerald-950/30' : 'hover:bg-[var(--card-border)]/30'
                }`}
              >
                <div className="w-8 h-8 rounded-full bg-[var(--card-border)] overflow-hidden flex-shrink-0">
                  {f.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs font-bold text-[var(--muted)]">
                      {f.display_name?.slice(0, 1) ?? '?'}
                    </div>
                  )}
                </div>
                <span className="flex-1 text-sm font-semibold truncate">{f.display_name}</span>
                {selected.has(f.id) && <span className="text-emerald-600 font-bold text-xs">선택됨</span>}
              </button>
            ))}
          </div>
        )}

        <button
          onClick={handleCreate}
          disabled={creating || title.trim().length < 2}
          className="w-full mt-4 py-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-sm disabled:opacity-50 active:scale-[0.98]"
        >
          {creating ? '만드는 중…' : `친선런 만들기 (${myName} 호스트)`}
        </button>
      </div>
    </div>
  );
}

// ── 대회 상세 sheet ─────────────────────────────────────
function ContestDetailSheet({ contestId, myUserId, activities, onClose, onChanged, onError, onToast }: {
  contestId: string;
  myUserId: string;
  activities: { id: string; activity_date: string; distance_km: number }[];
  onClose: () => void;
  onChanged: () => void;
  onError: (msg: string) => void;
  onToast: (text: string, tone?: 'ok' | 'warn') => void;
}) {
  const [rows, setRows] = useState<ContestLeaderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [info, setInfo] = useState<{ event_type: ContestEvent; status: 'open' | 'running' | 'finished'; host_user_id: string; contest_date: string; title: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchContestLeaderboard(contestId);
      setRows(list);
      const { getSupabase } = await import('@/lib/supabase');
      const sb = getSupabase();
      const { data } = await sb.from('daily_contests').select('event_type, status, host_user_id, contest_date, title').eq('id', contestId).maybeSingle();
      if (data) setInfo(data as unknown as { event_type: ContestEvent; status: 'open' | 'running' | 'finished'; host_user_id: string; contest_date: string; title: string });
    } catch (e) {
      console.warn('[contest detail] fail', e);
    } finally {
      setLoading(false);
    }
  }, [contestId]);

  useEffect(() => { load(); }, [load]);

  const submitForDate = async (activityId: string) => {
    setSubmitting(true);
    try {
      await submitContestResult(contestId, activityId);
      onToast('✨ 결과 제출됨');
      await load();
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : '제출 실패');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFinish = async () => {
    if (!confirm('친선런을 마감할까요? 이후 결과 변경 불가.')) return;
    try {
      await finishContest(contestId);
      onToast('친선런을 마감했어요');
      await load();
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : '마감 실패');
    }
  };

  const isHost = info?.host_user_id === myUserId;
  const eventType = info?.event_type ?? 'distance';
  const contestDate = info?.contest_date;
  const myActivitiesOnDate = activities.filter(a => a.activity_date === contestDate);

  return (
    <div className="fixed inset-0 z-[80] bg-black/65 flex items-end sm:items-center justify-center p-3" onClick={onClose}>
      <div className="w-full max-w-md bg-[var(--background)] rounded-3xl p-5 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-base font-extrabold">{info?.title ?? '친선런'}</h3>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              {contestDate} · {contestEventLabel(eventType)}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--card-border)]/40 active:scale-90">
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map(i => <div key={i} className="h-12 bg-[var(--card-border)]/30 animate-pulse rounded-xl" />)}
          </div>
        ) : (
          <div className="space-y-1.5">
            {rows.map(r => (
              <div key={r.user_id} className="flex items-center gap-2.5 px-2 py-2 rounded-xl bg-[var(--card)] border border-[var(--card-border)]/40">
                <span className={`w-7 h-7 rounded-full flex items-center justify-center font-extrabold text-xs ${
                  r.rank === 1 ? 'bg-amber-100 text-amber-700' :
                  r.rank === 2 ? 'bg-zinc-200 text-zinc-700' :
                  r.rank === 3 ? 'bg-orange-100 text-orange-700' :
                  'bg-[var(--card-border)]/40 text-[var(--muted)]'
                }`}>
                  {r.result_value !== null ? r.rank : '-'}
                </span>
                <div className="w-8 h-8 rounded-full bg-[var(--card-border)] overflow-hidden flex-shrink-0">
                  {r.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs font-bold text-[var(--muted)]">
                      {r.display_name?.slice(0, 1) ?? '?'}
                    </div>
                  )}
                </div>
                <span className="flex-1 text-sm font-semibold truncate">
                  {r.display_name}
                  {r.is_host && <span className="ml-1 text-[10px] font-bold text-emerald-600">호스트</span>}
                </span>
                <span className="text-sm font-extrabold tabular-nums">
                  {formatContestValue(eventType, r.result_value)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* 본인 활동 선택 — 미제출 시 노출 */}
        {info?.status !== 'finished' && (
          <div className="mt-4">
            <p className="text-xs font-bold text-[var(--muted)] mb-1.5">내 결과 제출 ({contestDate} 활동)</p>
            {myActivitiesOnDate.length === 0 ? (
              <p className="text-xs text-[var(--muted)] italic px-1">해당 날짜 활동이 없어요. 달리고 다시 와주세요.</p>
            ) : (
              <div className="space-y-1.5">
                {myActivitiesOnDate.map(a => (
                  <button
                    key={a.id}
                    onClick={() => submitForDate(a.id)}
                    disabled={submitting}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 text-sm active:scale-[0.99] disabled:opacity-50"
                  >
                    <span className="font-bold">{a.distance_km.toFixed(2)}km</span>
                    <span className="text-emerald-700 font-bold">이걸로 제출 →</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {isHost && info?.status !== 'finished' && (
          <button
            onClick={handleFinish}
            className="w-full mt-4 py-3 rounded-2xl bg-[var(--card)] border border-[var(--card-border)] text-[var(--foreground)] font-bold text-sm active:scale-[0.99] inline-flex items-center justify-center gap-1.5"
          >
            <Trophy size={14} /> 친선런 마감 (호스트)
          </button>
        )}
      </div>
    </div>
  );
}
