'use client';

// 클럽 마라톤 (build 118) — 클럽 단체 코스 챌린지 section.
// 클럽 상세 페이지에 마운트. owner/admin 만 새 코스 시작 가능, 멤버 모두의 km 자동 누적.

import { useEffect, useState, useCallback } from 'react';
import { Globe, Trophy, Plus, X, Users, Crown } from 'lucide-react';
import {
  fetchClubCourses,
  fetchClubCourseLeaderboard,
  startClubCourse,
  type ClubCourse,
  type ClubCourseLeaderRow,
} from '@/lib/club-courses-data';
import { fetchAvailableCourses, type VirtualCourse } from '@/lib/world-data';
import AppToast from '@/components/AppToast';

interface Props {
  clubId: string;
  canManage: boolean;  // owner/admin 인지
}

export default function ClubChallengeSection({ clubId, canManage }: Props) {
  const [courses, setCourses] = useState<ClubCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [boardCourseId, setBoardCourseId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchClubCourses(clubId);
      setCourses(list);
    } catch (e) {
      console.warn('[club courses] load fail', e);
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => { load(); }, [load]);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-extrabold inline-flex items-center gap-1.5">
          <Trophy size={14} className="text-amber-500" /> 클럽 마라톤
        </h2>
        {canManage && (
          <button
            onClick={() => setPickerOpen(true)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-emerald-500 text-white font-bold text-xs active:scale-95"
          >
            <Plus size={12} /> 코스 시작
          </button>
        )}
      </div>

      {loading ? (
        <div className="card p-4 h-20 animate-pulse" />
      ) : courses.length === 0 ? (
        <div className="rounded-2xl bg-[var(--card)] border border-[var(--card-border)] p-5 text-center">
          <Globe size={26} className="mx-auto text-[var(--muted)] mb-2" />
          <p className="text-sm font-bold">아직 클럽 도전이 없어요</p>
          {canManage ? (
            <p className="text-xs text-[var(--muted)] mt-1">위 버튼으로 가상 코스를 시작해 멤버 km 를 합쳐보세요</p>
          ) : (
            <p className="text-xs text-[var(--muted)] mt-1">운영자가 곧 시작할 거예요</p>
          )}
        </div>
      ) : (
        courses.map(c => {
          const pct = Math.min(100, (c.total_km / c.distance_km) * 100);
          const remain = Math.max(0, c.distance_km - c.total_km);
          const done = !!c.completed_at;
          return (
            <button
              key={c.course_id}
              onClick={() => setBoardCourseId(c.course_id)}
              className="w-full rounded-2xl bg-[var(--card)] border border-[var(--card-border)] p-4 text-left active:scale-[0.99] transition"
            >
              <div className="flex items-start gap-2.5">
                <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 ${
                  done ? 'bg-gradient-to-br from-amber-400 to-orange-500' : 'bg-gradient-to-br from-emerald-100 to-teal-50 dark:from-emerald-900/40 dark:to-teal-950/40'
                }`}>
                  {done ? <Trophy size={20} className="text-white" /> : <Globe size={20} className="text-emerald-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-extrabold truncate">{c.name}</p>
                  <p className="text-[11px] text-[var(--muted)]">{c.country ?? '세계'} · {c.distance_km.toFixed(1)}km · 기여 {c.contributors}명</p>
                </div>
              </div>
              <div className="mt-3">
                <div className="h-2.5 rounded-full bg-[var(--card-border)]/30 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="flex items-center justify-between mt-1.5 text-xs">
                  <span className="font-extrabold tabular-nums">{c.total_km.toFixed(1)} / {c.distance_km.toFixed(1)} km</span>
                  {done ? (
                    <span className="text-amber-600 font-extrabold inline-flex items-center gap-1"><Trophy size={11} /> 완주</span>
                  ) : (
                    <span className="text-[var(--muted)] font-semibold">남은 {remain.toFixed(1)}km</span>
                  )}
                </div>
              </div>
            </button>
          );
        })
      )}

      {pickerOpen && (
        <StartCoursePicker
          clubId={clubId}
          alreadyStartedIds={new Set(courses.map(c => c.course_id))}
          onClose={() => setPickerOpen(false)}
          onStarted={() => { setPickerOpen(false); showToast('✨ 클럽 도전 시작됨'); load(); }}
          onError={(msg) => showToast(msg, 'warn')}
        />
      )}

      {boardCourseId && (
        <ClubLeaderboardSheet
          clubId={clubId}
          courseId={boardCourseId}
          courseName={courses.find(c => c.course_id === boardCourseId)?.name ?? ''}
          onClose={() => setBoardCourseId(null)}
        />
      )}

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2000} />}
    </section>
  );
}

function StartCoursePicker({ clubId, alreadyStartedIds, onClose, onStarted, onError }: {
  clubId: string;
  alreadyStartedIds: Set<string>;
  onClose: () => void;
  onStarted: () => void;
  onError: (msg: string) => void;
}) {
  const [list, setList] = useState<VirtualCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    fetchAvailableCourses().then(setList).catch(() => setList([])).finally(() => setLoading(false));
  }, []);

  const handleStart = async (courseId: string) => {
    setStarting(courseId);
    try {
      await startClubCourse(clubId, courseId);
      onStarted();
    } catch (e) {
      onError(e instanceof Error ? e.message : '시작 실패');
    } finally {
      setStarting(null);
    }
  };

  const candidates = list.filter(c => !alreadyStartedIds.has(c.id));

  return (
    <div className="fixed inset-0 z-[80] bg-black/65 flex items-end sm:items-center justify-center sm:p-3" onClick={onClose}>
      <div className="w-full sm:max-w-md bg-[var(--background)] rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 px-5 pt-4 pb-3 bg-[var(--background)] border-b border-[var(--card-border)] rounded-t-3xl">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-extrabold inline-flex items-center gap-1.5">
              <Trophy size={16} className="text-amber-500" /> 클럽 도전 시작
            </h3>
            <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[var(--card-border)]/40 active:scale-90">
              <X size={18} />
            </button>
          </div>
          <p className="text-xs text-[var(--muted)] mt-1">모든 클럽 멤버의 활동 km 가 자동으로 합산돼요</p>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="h-20 bg-[var(--card-border)]/30 animate-pulse rounded-xl" />
          ) : candidates.length === 0 ? (
            <p className="text-center text-sm text-[var(--muted)] py-12">이미 모든 코스를 시작했어요</p>
          ) : (
            candidates.map(c => (
              <div key={c.id} className="card p-3 flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center flex-shrink-0">
                  <Globe size={18} className="text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-extrabold truncate">{c.name}</p>
                  <p className="text-[11px] text-[var(--muted)]">{c.country ?? '세계'} · {c.distance_km.toFixed(1)}km</p>
                </div>
                <button
                  onClick={() => handleStart(c.id)}
                  disabled={starting === c.id}
                  className="px-3.5 py-2 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-xs disabled:opacity-50 active:scale-95"
                >
                  {starting === c.id ? '시작 중…' : '시작'}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ClubLeaderboardSheet({ clubId, courseId, courseName, onClose }: {
  clubId: string;
  courseId: string;
  courseName: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<ClubCourseLeaderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchClubCourseLeaderboard(clubId, courseId)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [clubId, courseId]);

  return (
    <div className="fixed inset-0 z-[80] bg-black/65 flex items-end sm:items-center justify-center sm:p-3" onClick={onClose}>
      <div className="w-full sm:max-w-md bg-[var(--background)] rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 px-5 pt-4 pb-3 bg-[var(--background)] border-b border-[var(--card-border)] rounded-t-3xl">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-extrabold inline-flex items-center gap-1.5">
                <Users size={16} className="text-emerald-500" /> 멤버 기여도
              </h3>
              <p className="text-[11px] text-[var(--muted)] mt-0.5 truncate">{courseName}</p>
            </div>
            <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[var(--card-border)]/40 active:scale-90">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
          {loading ? (
            [0,1,2].map(i => <div key={i} className="h-12 bg-[var(--card-border)]/30 animate-pulse rounded-xl" />)
          ) : rows.length === 0 ? (
            <p className="text-center text-sm text-[var(--muted)] py-12 italic">아직 기여한 멤버가 없어요</p>
          ) : (
            rows.map(r => (
              <div key={r.user_id} className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-[var(--card)] border border-[var(--card-border)]/40">
                <span className={`w-7 h-7 rounded-full flex items-center justify-center font-extrabold text-xs flex-shrink-0 ${
                  r.rank === 1 ? 'bg-amber-100 text-amber-700' :
                  r.rank === 2 ? 'bg-zinc-200 text-zinc-700' :
                  r.rank === 3 ? 'bg-orange-100 text-orange-700' :
                  'bg-[var(--card-border)]/40 text-[var(--muted)]'
                }`}>{r.rank}</span>
                <div className="w-9 h-9 rounded-full bg-[var(--card-border)]/40 overflow-hidden flex-shrink-0">
                  {r.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-sm font-bold text-[var(--muted)]">
                      {r.display_name.slice(0,1)}
                    </div>
                  )}
                </div>
                <span className="flex-1 text-sm font-bold truncate inline-flex items-center gap-1">
                  {r.display_name}
                  {r.rank === 1 && <Crown size={12} className="text-amber-500" />}
                </span>
                <span className="text-sm font-extrabold text-emerald-600 tabular-nums">{Number(r.contributed_km).toFixed(1)}km</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
