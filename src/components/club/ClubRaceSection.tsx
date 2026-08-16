'use client';

// 2026-08-16: 클럽 대회 — 2인 1조 합산 레이스.
//
// BIT Runners 1주년 트레일런(8/21)에서 쓰기 위해 만들었다. 행사 룰이 그대로 요구사항이다:
//   "조 기록 = 두 사람 시간의 합계. 합계가 가장 짧은 조가 우승"
//   "출발 전 앱에서 참가 버튼만 눌러두면 끝"
//
// 설계에서 가장 중요한 것은 **기록이 비는 사람을 받아내는 것**이다.
// 실측(2026-08-16): 참가자 12명 중 앱 계정 10명, 최근 30일 러닝 기록이 있는 사람 7명.
// 합계 방식이라 짝 중 한 명만 비어도 그 조는 순위가 안 나온다 → 운영자 수동 입력이 필수다.
// 그래서 조 카드에 "몇 명 기록됨"을 항상 드러내고, 운영자에게는 즉시 입력 UI를 준다.

import { useCallback, useEffect, useState } from 'react';
import { Timer, Plus, RefreshCw, X, UserPlus, Flag, Medal, Users2, Pencil } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import {
  fetchClubRaces, fetchRaceEntries, fetchRaceBoard,
  createClubRace, joinClubRace, leaveClubRace,
  addRaceGuest, removeRaceEntry, setRaceTeam, setRaceManualTime, setRaceDnf, syncRaceTimes,
  formatRaceTime, parseRaceTime,
  type ClubRace, type ClubRaceEntry, type RaceBoardTeam,
} from '@/lib/club-races';
import AppToast from '@/components/AppToast';
import { useI18n } from '@/lib/i18n';

interface Props {
  clubId: string;
  canManage: boolean;
}

const MEDAL = ['🥇', '🥈', '🥉'];

export default function ClubRaceSection({ clubId, canManage }: Props) {
  const { tt } = useI18n();
  const [races, setRaces] = useState<ClubRace[]>([]);
  const [race, setRace] = useState<ClubRace | null>(null);
  const [entries, setEntries] = useState<ClubRaceEntry[]>([]);
  const [board, setBoard] = useState<RaceBoardTeam[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2400);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: auth } = await getSupabase().auth.getUser();
      setMyId(auth.user?.id ?? null);
      const list = await fetchClubRaces(clubId);
      setRaces(list);
      const current = list[0] ?? null;
      setRace(current);
      if (current) {
        const [e, b] = await Promise.all([fetchRaceEntries(current.id), fetchRaceBoard(current.id)]);
        setEntries(e);
        setBoard(b);
      } else {
        setEntries([]); setBoard([]);
      }
    } catch (e) {
      console.warn('[club races] load fail', e);
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => { void load(); }, [load]);

  const refreshRace = useCallback(async (raceId: string) => {
    const [e, b] = await Promise.all([fetchRaceEntries(raceId), fetchRaceBoard(raceId)]);
    setEntries(e); setBoard(b);
  }, []);

  const myEntry = entries.find(e => e.user_id && e.user_id === myId) ?? null;
  const unassigned = entries.filter(e => e.team_no == null);

  const run = async (fn: () => Promise<void>, okMsg?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      if (race) await refreshRace(race.id);
      if (okMsg) showToast(okMsg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg.slice(0, 80), 'warn');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="h-28 rounded-2xl bg-black/5 dark:bg-white/5 animate-pulse" />;
  }

  // ── 대회 없음
  if (!race) {
    return (
      <div className="rounded-2xl border border-black/5 dark:border-white/10 p-5 text-center">
        <Timer size={26} className="mx-auto text-emerald-500 mb-2" />
        <p className="text-sm font-bold text-[var(--foreground)]">{tt('아직 클럽 대회가 없어요')}</p>
        <p className="text-xs text-[var(--muted)] mt-1">
          {tt('여럿이 같은 코스를 달리고 조별 합산으로 순위를 매겨요')}
        </p>
        {canManage && (
          <button
            onClick={() => setCreateOpen(true)}
            className="mt-3 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-sm font-bold"
          >
            <Plus size={15} className="inline -mt-0.5 mr-1" />{tt('대회 만들기')}
          </button>
        )}
        {createOpen && (
          <CreateRaceModal
            clubId={clubId}
            onClose={() => setCreateOpen(false)}
            onCreated={() => { setCreateOpen(false); void load(); }}
          />
        )}
        {toast && <AppToast text={toast.text} tone={toast.tone} />}
      </div>
    );
  }

  const pending = entries.filter(e => e.seconds == null && e.source !== 'dnf').length;

  return (
    <div className="space-y-3">
      {/* 헤더 */}
      <div className="rounded-2xl overflow-hidden border border-black/5 dark:border-white/10">
        <div className="px-4 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 text-white">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-bold opacity-90 flex items-center gap-1">
                <Flag size={12} />{tt('클럽 대회')}
              </p>
              <h3 className="text-base font-black truncate">{race.title}</h3>
            </div>
            {canManage && (
              <button
                onClick={() => setManageOpen(true)}
                className="shrink-0 px-2.5 py-1.5 rounded-lg bg-white/20 text-white text-xs font-bold"
              >
                {tt('운영')}
              </button>
            )}
          </div>
          <p className="text-[11px] opacity-90 mt-1">
            {race.race_date}
            {race.distance_km ? ` · ${race.distance_km}km` : ''}
            {` · ${race.team_size}${tt('인 1조')}`}
          </p>
        </div>

        {/* 참가 버튼 */}
        <div className="px-4 py-3 bg-[var(--card)]">
          {myEntry ? (
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm">
                <span className="font-bold text-emerald-600">{tt('참가 중')}</span>
                <span className="text-[var(--muted)]">
                  {myEntry.team_no ? ` · ${myEntry.team_no}${tt('조')}` : ` · ${tt('조 편성 대기')}`}
                </span>
              </div>
              {myEntry.seconds == null && race.status === 'open' && (
                <button
                  onClick={() => run(() => leaveClubRace(race.id), tt('참가를 취소했어요'))}
                  disabled={busy}
                  className="text-xs text-[var(--muted)] underline disabled:opacity-50"
                >
                  {tt('참가 취소')}
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={() => run(() => joinClubRace(race.id), tt('참가했어요! 출발 전 준비 끝'))}
              disabled={busy || race.status === 'closed'}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-sm font-bold disabled:opacity-50"
            >
              {race.status === 'closed' ? tt('마감된 대회예요') : tt('이 대회에 참가하기')}
            </button>
          )}
          <p className="text-[11px] text-[var(--muted)] mt-2 leading-relaxed">
            {tt('참가만 눌러두면 대회 시간대에 달린 러닝이 자동으로 기록돼요. 기록은 출발~도착 실제 경과 시간이에요 (일시정지 포함).')}
          </p>
        </div>
      </div>

      {/* 조별 순위 */}
      {board.length > 0 ? (
        <div className="space-y-2">
          {board.map(team => (
            <div
              key={team.team_no}
              className="rounded-2xl border border-black/5 dark:border-white/10 bg-[var(--card)] p-3.5"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-lg leading-none">
                    {team.rank && team.rank <= 3 ? MEDAL[team.rank - 1] : '🏃'}
                  </span>
                  <span className="text-sm font-black text-[var(--foreground)]">
                    {team.team_no}{tt('조')}
                  </span>
                  {team.rank && (
                    <span className="text-[11px] font-bold text-emerald-600">{team.rank}{tt('위')}</span>
                  )}
                </div>
                <div className="text-right shrink-0">
                  {team.is_complete ? (
                    <>
                      <p className="text-base font-black tabular-nums text-[var(--foreground)]">
                        {formatRaceTime(team.total_seconds)}
                      </p>
                      {team.total_distance_km != null && (
                        <p className="text-[10px] text-[var(--muted)]">
                          {tt('합산')} {Number(team.total_distance_km).toFixed(1)}km
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-xs font-bold text-amber-600">
                      {team.finished_count}/{team.member_count} {tt('기록됨')}
                    </p>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                {team.members.map(m => (
                  <div key={m.entry_id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-[var(--foreground)]">
                      {m.name ?? tt('이름 없음')}
                      {m.is_guest && <span className="ml-1 text-[10px] text-[var(--muted)]">{tt('앱 미사용')}</span>}
                    </span>
                    <span className="shrink-0 tabular-nums font-bold text-[var(--muted)]">
                      {m.source === 'dnf'
                        ? tt('미완주')
                        : m.seconds != null
                          ? `${formatRaceTime(m.seconds)}${m.source === 'manual' ? ' ✍️' : ''}`
                          : tt('대기')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-black/10 dark:border-white/15 p-4 text-center">
          <Users2 size={20} className="mx-auto text-[var(--muted)] mb-1.5" />
          <p className="text-xs text-[var(--muted)]">
            {entries.length > 0
              ? tt('조를 편성하면 합산 순위가 나와요')
              : tt('아직 참가자가 없어요')}
          </p>
        </div>
      )}

      {/* 미편성 참가자 */}
      {unassigned.length > 0 && (
        <p className="text-[11px] text-[var(--muted)] px-1">
          {tt('조 편성 대기')} {unassigned.length}{tt('명')}
          {pending > 0 && ` · ${tt('기록 대기')} ${pending}${tt('명')}`}
        </p>
      )}

      {manageOpen && canManage && (
        <ManageRaceModal
          race={race}
          entries={entries}
          onClose={() => setManageOpen(false)}
          onChanged={() => refreshRace(race.id)}
          onToast={showToast}
        />
      )}
      {createOpen && (
        <CreateRaceModal
          clubId={clubId}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); void load(); }}
        />
      )}
      {races.length > 1 && (
        <select
          value={race.id}
          onChange={async e => {
            const next = races.find(r => r.id === e.target.value) ?? null;
            setRace(next);
            if (next) await refreshRace(next.id);
          }}
          className="w-full text-xs rounded-xl border border-black/10 dark:border-white/15 bg-[var(--card)] px-3 py-2 text-[var(--foreground)]"
        >
          {races.map(r => <option key={r.id} value={r.id}>{r.race_date} · {r.title}</option>)}
        </select>
      )}
      {toast && <AppToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}

// ───────────────────────── 대회 생성 ─────────────────────────
function CreateRaceModal({ clubId, onClose, onCreated }: {
  clubId: string; onClose: () => void; onCreated: () => void;
}) {
  const { tt } = useI18n();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  // 기본 창을 넉넉히 (당일 05:00~23:59) — 좁게 잡아 기록을 놓치는 쪽이 훨씬 나쁘다.
  const [startTime, setStartTime] = useState('05:00');
  const [endTime, setEndTime] = useState('23:59');
  const [distance, setDistance] = useState('');
  const [teamSize, setTeamSize] = useState(2);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim()) { setErr(tt('대회 이름을 입력해주세요')); return; }
    setSaving(true); setErr(null);
    try {
      // KST 기준으로 입력받아 ISO 로 (앱 전역 규약 — reference_timezone_handling)
      const startsAt = new Date(`${date}T${startTime}:00+09:00`).toISOString();
      const endsAt = new Date(`${date}T${endTime}:59+09:00`).toISOString();
      await createClubRace({
        clubId, title: title.trim(), raceDate: date, startsAt, endsAt,
        distanceKm: distance ? Number(distance) : null, teamSize,
      });
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet title={tt('클럽 대회 만들기')} onClose={onClose}>
      <Field label={tt('대회 이름')}>
        <input value={title} onChange={e => setTitle(e.target.value)}
          placeholder={tt('예) 1주년 트레일런')} className={INPUT} />
      </Field>
      <Field label={tt('날짜')}>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className={INPUT} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={tt('기록 인정 시작')}>
          <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className={INPUT} />
        </Field>
        <Field label={tt('기록 인정 종료')}>
          <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className={INPUT} />
        </Field>
      </div>
      <p className="text-[11px] text-[var(--muted)] -mt-1">
        {tt('이 시간대에 시작한 러닝이 대회 기록으로 잡혀요. 넉넉하게 잡아두는 게 안전해요.')}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Field label={tt('코스 거리 (km)')}>
          <input type="number" inputMode="decimal" step="0.1" value={distance}
            onChange={e => setDistance(e.target.value)} placeholder="6.4" className={INPUT} />
        </Field>
        <Field label={tt('조 인원')}>
          <select value={teamSize} onChange={e => setTeamSize(Number(e.target.value))} className={INPUT}>
            {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}{tt('명')}</option>)}
          </select>
        </Field>
      </div>
      {err && <p className="text-xs text-rose-500">{err}</p>}
      <button onClick={submit} disabled={saving}
        className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold disabled:opacity-50">
        {saving ? tt('만드는 중...') : tt('대회 만들기')}
      </button>
    </Sheet>
  );
}

// ───────────────────────── 운영 (조 편성 · 기록 입력) ─────────────────────────
function ManageRaceModal({ race, entries, onClose, onChanged, onToast }: {
  race: ClubRace;
  entries: ClubRaceEntry[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  onToast: (t: string, tone?: 'ok' | 'warn') => void;
}) {
  const { tt } = useI18n();
  const [guestName, setGuestName] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [timeInput, setTimeInput] = useState('');
  const [names, setNames] = useState<Record<string, string>>({});

  // 참가자 표시 이름 (앱 회원은 profiles 조회)
  useEffect(() => {
    const ids = entries.map(e => e.user_id).filter((v): v is string => !!v);
    if (ids.length === 0) return;
    void (async () => {
      const { data } = await getSupabase().from('profiles').select('id, display_name').in('id', ids);
      const map: Record<string, string> = {};
      (data ?? []).forEach((p: { id: string; display_name: string | null }) => {
        map[p.id] = p.display_name ?? '';
      });
      setNames(map);
    })();
  }, [entries]);

  const nameOf = (e: ClubRaceEntry) =>
    e.guest_name ?? (e.user_id ? names[e.user_id] || tt('회원') : tt('이름 없음'));

  const act = async (fn: () => Promise<void>, msg?: string) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); await onChanged(); if (msg) onToast(msg); }
    catch (e) { onToast(e instanceof Error ? e.message.slice(0, 80) : String(e), 'warn'); }
    finally { setBusy(false); }
  };

  const saveTime = async (entryId: string) => {
    const secs = parseRaceTime(timeInput);
    if (secs == null) { onToast(tt('시간 형식이 올바르지 않아요 (예: 42:10)'), 'warn'); return; }
    await act(() => setRaceManualTime(entryId, secs), tt('기록을 입력했어요'));
    setEditing(null); setTimeInput('');
  };

  return (
    <Sheet title={`${tt('운영')} · ${race.title}`} onClose={onClose}>
      {/* 자동 동기화 */}
      <button
        onClick={() => act(async () => {
          const r = await syncRaceTimes(race.id);
          onToast(r.missing > 0
            ? `${tt('자동 기록')} ${r.matched}${tt('명')} · ${tt('아직 없음')} ${r.missing}${tt('명')}`
            : `${tt('자동 기록')} ${r.matched}${tt('명')} · ${tt('전원 완료')}`);
        })}
        disabled={busy}
        className="w-full py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-bold disabled:opacity-50"
      >
        <RefreshCw size={15} className="inline -mt-0.5 mr-1.5" />{tt('앱 러닝에서 기록 가져오기')}
      </button>
      <p className="text-[11px] text-[var(--muted)] -mt-1">
        {tt('직접 입력한 기록은 덮어쓰지 않아요.')}
      </p>

      {/* 참가자 추가 (앱 미사용) */}
      <div className="flex gap-2">
        <input value={guestName} onChange={e => setGuestName(e.target.value)}
          placeholder={tt('앱 없는 참가자 이름')} className={`${INPUT} flex-1`} />
        <button
          onClick={() => act(async () => {
            if (!guestName.trim()) return;
            await addRaceGuest(race.id, guestName);
            setGuestName('');
          }, tt('참가자를 추가했어요'))}
          disabled={busy || !guestName.trim()}
          className="px-3 rounded-xl bg-black/5 dark:bg-white/10 text-sm font-bold text-[var(--foreground)] disabled:opacity-40"
        >
          <UserPlus size={16} />
        </button>
      </div>

      {/* 참가자 목록 */}
      <div className="space-y-1.5 max-h-[46vh] overflow-y-auto -mx-1 px-1">
        {entries.length === 0 && (
          <p className="text-xs text-[var(--muted)] text-center py-4">{tt('아직 참가자가 없어요')}</p>
        )}
        {entries.map(e => (
          <div key={e.id} className="rounded-xl border border-black/5 dark:border-white/10 p-2.5">
            <div className="flex items-center gap-2">
              <span className="flex-1 min-w-0 truncate text-sm font-bold text-[var(--foreground)]">
                {nameOf(e)}
                {!e.user_id && <span className="ml-1 text-[10px] font-normal text-[var(--muted)]">{tt('앱 미사용')}</span>}
              </span>
              {/* 조 번호 */}
              <select
                value={e.team_no ?? ''}
                onChange={ev => act(() => setRaceTeam(e.id, ev.target.value ? Number(ev.target.value) : null))}
                className="text-xs rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-1.5 py-1 text-[var(--foreground)]"
              >
                <option value="">{tt('미편성')}</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
                  <option key={n} value={n}>{n}{tt('조')}</option>
                ))}
              </select>
              <button onClick={() => act(() => removeRaceEntry(e.id))} disabled={busy}
                className="p-1 text-[var(--muted)]" aria-label={tt('삭제')}>
                <X size={14} />
              </button>
            </div>
            {/* 기록 */}
            <div className="flex items-center gap-2 mt-1.5">
              {editing === e.id ? (
                <>
                  <input
                    value={timeInput} onChange={ev => setTimeInput(ev.target.value)}
                    placeholder="42:10" autoFocus
                    className="flex-1 text-sm rounded-lg border border-emerald-400 bg-transparent px-2 py-1 text-[var(--foreground)]"
                  />
                  <button onClick={() => saveTime(e.id)} disabled={busy}
                    className="px-2.5 py-1 rounded-lg bg-emerald-500 text-white text-xs font-bold">
                    {tt('저장')}
                  </button>
                  <button onClick={() => { setEditing(null); setTimeInput(''); }}
                    className="text-xs text-[var(--muted)]">{tt('취소')}</button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-xs tabular-nums text-[var(--muted)]">
                    {e.source === 'dnf' ? tt('미완주')
                      : e.seconds != null ? `${formatRaceTime(e.seconds)} · ${e.source === 'manual' ? tt('직접 입력') : tt('앱 자동')}`
                        : tt('기록 없음')}
                  </span>
                  <button
                    onClick={() => { setEditing(e.id); setTimeInput(e.seconds ? formatRaceTime(e.seconds) : ''); }}
                    className="px-2 py-1 rounded-lg bg-black/5 dark:bg-white/10 text-[11px] font-bold text-[var(--foreground)]"
                  >
                    <Pencil size={11} className="inline -mt-0.5 mr-0.5" />{tt('기록 입력')}
                  </button>
                  {e.source !== 'dnf' && (
                    <button onClick={() => act(() => setRaceDnf(e.id), tt('미완주 처리했어요'))} disabled={busy}
                      className="px-2 py-1 rounded-lg bg-black/5 dark:bg-white/10 text-[11px] text-[var(--muted)]">
                      DNF
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

// ───────────────────────── 공용 ─────────────────────────
const INPUT =
  'w-full rounded-xl border border-black/10 dark:border-white/15 bg-transparent px-3 py-2.5 text-sm text-[var(--foreground)] outline-none focus:border-emerald-400';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-bold text-[var(--muted)] mb-1">{label}</span>
      {children}
    </label>
  );
}

function Sheet({ title, onClose, children }: {
  title: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full sm:max-w-md bg-[var(--card)] rounded-t-3xl sm:rounded-3xl p-5 space-y-3 max-h-[88vh] overflow-y-auto"
        style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
        onClick={ev => ev.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-black text-[var(--foreground)] flex items-center gap-1.5">
            <Medal size={17} className="text-emerald-500" />{title}
          </h3>
          <button onClick={onClose} className="p-1 text-[var(--muted)]"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
