'use client';

// 페이스 그룹 (build 119) — 6개 페이스대 가상 클럽. 내 페이스대 자동 추천 + 가입.

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Zap, Users, Check, Sparkles, ChevronRight, MapPin, Calendar, Plus, X } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import {
  fetchPaceGroups,
  fetchPaceGroupMembers,
  joinPaceGroup,
  leavePaceGroup,
  createPaceGroupContest,
  type PaceGroup,
  type PaceGroupMember,
} from '@/lib/pace-group-data';
import { todayStr } from '@/lib/kst';
import { formatPace } from '@/lib/nearby-data';
import AppLogo from '@/components/AppLogo';
import AppToast from '@/components/AppToast';
import GenderBadge from '@/components/profile/GenderBadge';
import { track } from '@/lib/analytics';
import { useI18n } from '@/lib/i18n';

export default function PaceGroupsPage() {
  const router = useRouter();
  const { tt, locale } = useI18n();
  const { user } = useAuth();
  const [groups, setGroups] = useState<PaceGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [openMembers, setOpenMembers] = useState<string | null>(null);
  const [members, setMembers] = useState<PaceGroupMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [contestModal, setContestModal] = useState<PaceGroup | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchPaceGroups();
      setGroups(list);
    } catch (e) {
      showToast(e instanceof Error ? e.message : tt('조회 실패'), 'warn');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleJoin = async (g: PaceGroup) => {
    if (!user) { showToast(tt('로그인이 필요해요'), 'warn'); return; }
    setBusy(g.group_id);
    try {
      if (g.is_joined) {
        await leavePaceGroup();
        showToast(locale === 'en' ? 'Left the group' : '탈퇴');
      } else {
        await joinPaceGroup(g.group_id);
        showToast(locale === 'en' ? `✨ Joined ${g.label}` : `✨ ${g.label} 가입`);
        track('pace_group_join', { slug: g.slug });
      }
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : tt('실패'), 'warn');
    } finally {
      setBusy(null);
    }
  };

  const handleOpenMembers = async (g: PaceGroup) => {
    setOpenMembers(g.group_id);
    setMembersLoading(true);
    try {
      const list = await fetchPaceGroupMembers(g.group_id);
      setMembers(list);
    } catch {
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto pb-20 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/85 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="px-3 py-3 flex items-center gap-2">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full active:bg-[var(--card-border)]/30">
            <ArrowLeft size={20} />
          </button>
          <AppLogo size={24} />
          <h1 className="text-xl font-extrabold tracking-tight">{tt('페이스 그룹')}</h1>
        </div>
      </header>

      <div className="p-4 space-y-3">
        {/* 안내 */}
        <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-4 shadow-md shadow-emerald-500/30">
          <p className="text-sm font-extrabold text-white inline-flex items-center gap-1.5">
            <Zap size={14} /> {tt('내 페이스대 러너 모임')}
          </p>
          <p className="text-xs text-white/90 mt-1 leading-relaxed">
            {tt('6단계 페이스 그룹 중 하나에 가입해 비슷한 속도의 러너들과 친해지세요.')}
            <br />{tt('30일 평균 페이스 기반으로 추천 그룹이 표시돼요.')}
          </p>
        </div>

        {loading ? (
          [0,1,2,3].map(i => <div key={i} className="card p-4 h-24 animate-pulse" />)
        ) : (
          groups.map(g => (
            <article key={g.group_id} className={`rounded-2xl border-2 p-4 transition ${
              g.is_joined
                ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-300/60 dark:border-emerald-800/40'
                : 'bg-[var(--card)] border-[var(--card-border)]'
            }`}>
              <div className="flex items-start gap-3">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 text-2xl ${
                  g.is_joined ? 'bg-gradient-to-br from-emerald-500 to-emerald-600' : 'bg-emerald-50 dark:bg-emerald-950/30'
                }`}>
                  <span>{g.emoji ?? '🏃'}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-base font-extrabold">{g.label}</p>
                    {g.is_recommended && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 inline-flex items-center gap-0.5">
                        <Sparkles size={9} /> {tt('내 페이스')}
                      </span>
                    )}
                    {g.is_joined && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-0.5">
                        <Check size={9} /> {tt('가입')}
                      </span>
                    )}
                  </div>
                  {g.description && <p className="text-[11px] text-[var(--muted)] mt-0.5 leading-snug">{g.description}</p>}
                  <p className="text-[11px] text-[var(--muted)] mt-1 inline-flex items-center gap-2">
                    <span className="font-bold">{formatPace(g.min_pace_sec)} ~ {formatPace(g.max_pace_sec)}/km</span>
                    <span>·</span>
                    <span className="font-bold inline-flex items-center gap-0.5"><Users size={10} /> {locale === 'en' ? g.member_count : `${g.member_count}명`}</span>
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => handleOpenMembers(g)}
                  className="flex-1 py-2.5 rounded-xl bg-[var(--card-border)]/30 font-bold text-xs active:scale-95 inline-flex items-center justify-center gap-1"
                >
                  <Users size={12} /> {tt('멤버')}
                </button>
                {g.is_joined && (
                  <button
                    onClick={() => setContestModal(g)}
                    className="flex-1 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 font-extrabold text-xs active:scale-95 inline-flex items-center justify-center gap-1 border border-amber-200/60 dark:border-amber-800/40"
                  >
                    <Calendar size={12} /> {tt('친선런')}
                  </button>
                )}
                <button
                  onClick={() => handleJoin(g)}
                  disabled={busy === g.group_id}
                  className={`flex-1 py-2.5 rounded-xl font-extrabold text-xs disabled:opacity-50 active:scale-95 ${
                    g.is_joined
                      ? 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--foreground)]'
                      : 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-500/30'
                  }`}
                >
                  {busy === g.group_id ? '…' : (g.is_joined ? (locale === 'en' ? 'Leave' : '탈퇴') : tt('가입'))}
                </button>
              </div>
            </article>
          ))
        )}

        <p className="text-[10px] text-[var(--muted)] text-center px-6 leading-relaxed">
          {tt('한 사용자 = 한 그룹. 다른 그룹에 가입하면 이전 그룹은 자동 탈퇴됩니다.')}
        </p>
      </div>

      {/* 멤버 sheet */}
      {openMembers && (
        <div className="fixed inset-0 z-[80] bg-black/65 flex items-end sm:items-center justify-center sm:p-3" onClick={() => setOpenMembers(null)}>
          <div className="w-full sm:max-w-md bg-[var(--background)] rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 px-5 pt-4 pb-3 bg-[var(--background)] border-b border-[var(--card-border)] rounded-t-3xl flex items-center justify-between">
              <h3 className="text-base font-extrabold inline-flex items-center gap-1.5">
                <Users size={16} className="text-emerald-500" /> {tt('멤버')} · {groups.find(g => g.group_id === openMembers)?.label}
              </h3>
              <button onClick={() => setOpenMembers(null)} className="text-xs font-bold text-[var(--muted)] px-3 py-1.5">{tt('닫기')}</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
              {membersLoading ? (
                [0,1,2].map(i => <div key={i} className="h-12 bg-[var(--card-border)]/30 animate-pulse rounded-xl" />)
              ) : members.length === 0 ? (
                <p className="text-center text-sm text-[var(--muted)] py-12 italic">{tt('아직 멤버가 없어요. 첫 멤버가 되어보세요.')}</p>
              ) : (
                members.map(m => (
                  <Link
                    key={m.user_id}
                    href={`/social/user?id=${m.user_id}`}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-[var(--card)] border border-[var(--card-border)]/40 active:scale-[0.99]"
                  >
                    <div className="w-9 h-9 rounded-full bg-[var(--card-border)]/40 overflow-hidden flex-shrink-0">
                      {m.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-sm font-bold text-[var(--muted)]">{m.display_name.slice(0,1)}</div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-extrabold inline-flex items-center gap-1 truncate">
                        {m.display_name}
                        <GenderBadge gender={m.gender} show={m.show_gender} size={11} />
                      </p>
                      {m.region_gu && (
                        <p className="text-[10px] text-[var(--muted)] inline-flex items-center gap-0.5">
                          <MapPin size={9} /> {m.region_gu}
                        </p>
                      )}
                    </div>
                    <span className="text-xs font-bold text-emerald-600 tabular-nums">{m.km_30d.toFixed(1)}km</span>
                    <ChevronRight size={14} className="text-[var(--muted)]" />
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 그룹 친선런 만들기 모달 */}
      {contestModal && (
        <PaceGroupContestModal
          group={contestModal}
          onClose={() => setContestModal(null)}
          onCreated={(id) => {
            setContestModal(null);
            showToast(tt('✨ 그룹 친선런 생성됨'));
            router.push(`/ranking?tab=contest&open=${id}`);
          }}
          onError={(m) => showToast(m, 'warn')}
        />
      )}

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2000} />}
    </div>
  );
}

function PaceGroupContestModal({ group, onClose, onCreated, onError }: {
  group: PaceGroup;
  onClose: () => void;
  onCreated: (contestId: string) => void;
  onError: (m: string) => void;
}) {
  const { tt, locale } = useI18n();
  const [title, setTitle] = useState(locale === 'en' ? `${group.label} Friendly Run` : `${group.label} 친선런`);
  const [contestDate, setContestDate] = useState(todayStr());
  const [meetupTime, setMeetupTime] = useState('07:00');
  const [meetupLocation, setMeetupLocation] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    if (title.trim().length < 2) { onError(tt('제목이 너무 짧아요')); return; }
    setBusy(true);
    try {
      const id = await createPaceGroupContest(group.group_id, title.trim(), contestDate, {
        meetupLocation: meetupLocation.trim() || null,
        meetupTime: meetupTime.trim() || null,
      });
      onCreated(id);
    } catch (e) {
      onError(e instanceof Error ? e.message : tt('생성 실패'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/65 flex items-end sm:items-center justify-center sm:p-3" onClick={() => !busy && onClose()}>
      <div className="w-full sm:max-w-md bg-[var(--background)] rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 px-5 pt-4 pb-3 bg-[var(--background)] border-b border-[var(--card-border)] rounded-t-3xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                <Calendar size={18} className="text-white" />
              </div>
              <div>
                <h3 className="text-base font-extrabold">{tt('그룹 친선런')}</h3>
                <p className="text-[11px] text-[var(--muted)] mt-0.5">{group.emoji} {group.label} · {locale === 'en' ? `${group.member_count} auto-invited` : `${group.member_count}명 자동 초대`}</p>
              </div>
            </div>
            <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[var(--card-border)]/40 active:scale-90"><X size={18} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <Field label={tt('제목')}>
            <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 80))} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={tt('날짜')}>
              <input type="date" value={contestDate} onChange={(e) => setContestDate(e.target.value)} className={inputCls} />
            </Field>
            <Field label={tt('시간')}>
              <input type="time" value={meetupTime} onChange={(e) => setMeetupTime(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <Field label={tt('만남 장소 (선택)')}>
            <input value={meetupLocation} onChange={(e) => setMeetupLocation(e.target.value.slice(0, 80))} placeholder={tt('예) 한강 잠실대교 북단')} className={inputCls} />
          </Field>
          <div className="rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-900/40 p-3">
            <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1">
              <Users size={11} /> {locale === 'en' ? `All ${group.member_count} group members are added as participants automatically` : `그룹 전원 ${group.member_count}명이 자동으로 참가자에 추가돼요`}
            </p>
            <p className="text-[10px] text-[var(--muted)] mt-1">{tt('공개 모집판에도 노출됩니다.')}</p>
          </div>
        </div>
        <div className="sticky bottom-0 px-5 py-4 bg-[var(--background)] border-t border-[var(--card-border)]/40" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}>
          <button
            onClick={handleSubmit}
            disabled={busy || title.trim().length < 2}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 text-white font-extrabold text-sm disabled:opacity-50 active:scale-[0.98] inline-flex items-center justify-center gap-1.5 shadow-lg shadow-amber-500/30"
          >
            {busy ? tt('만드는 중…') : <><Plus size={16} /> {tt('그룹 친선런 만들기')}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls = 'w-full px-3.5 py-3 rounded-xl border-2 border-[var(--card-border)] bg-[var(--card)] text-[15px] focus:outline-none focus:border-amber-500';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-bold text-[var(--muted)] mb-1">{label}</label>
      {children}
    </div>
  );
}
