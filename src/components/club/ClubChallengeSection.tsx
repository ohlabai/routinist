'use client';

// 클럽 마라톤 (build 118) — 클럽 단체 코스 챌린지 section.
// 클럽 상세 페이지에 마운트. owner/admin 만 새 코스 시작 가능, 멤버 모두의 km 자동 누적.

import { useEffect, useState, useCallback } from 'react';
import { Globe, Trophy, Plus, X, Users, Crown, Download, Sparkles } from 'lucide-react';
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
  const [celebrate, setCelebrate] = useState<ClubCourse | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchClubCourses(clubId);
      // 신규 완주 감지 (localStorage 에 안 본 코스만) — 한 번만 셀러브레이션
      const seenKey = `club_celebrated_${clubId}`;
      const seen: string[] = JSON.parse(localStorage.getItem(seenKey) ?? '[]');
      const justDone = list.find(c => c.completed_at && !seen.includes(c.course_id));
      if (justDone) {
        setCelebrate(justDone);
        localStorage.setItem(seenKey, JSON.stringify([...seen, justDone.course_id]));
      }
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

      {celebrate && (
        <ClubCompletionCelebration
          clubId={clubId}
          course={celebrate}
          onClose={() => setCelebrate(null)}
        />
      )}

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2000} />}
    </section>
  );
}

// ── 클럽 완주 셀러브레이션 모달 ─────────────────────────
function ClubCompletionCelebration({ clubId, course, onClose }: {
  clubId: string;
  course: ClubCourse;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<ClubCourseLeaderRow[]>([]);

  useEffect(() => {
    fetchClubCourseLeaderboard(clubId, course.course_id).then(setMembers).catch(() => setMembers([]));
  }, [clubId, course.course_id]);

  const handleDownload = () => {
    downloadClubCertificate(course, members);
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/80 flex items-center justify-center p-4 animate-[fadeIn_0.3s_ease-out]" onClick={onClose}>
      <div className="w-full max-w-sm bg-gradient-to-br from-amber-50 via-white to-emerald-50 dark:from-amber-950/40 dark:via-zinc-900 dark:to-emerald-950/40 rounded-3xl p-6 shadow-2xl text-center" onClick={(e) => e.stopPropagation()}>
        {/* 트로피 애니메이션 영역 */}
        <div className="relative w-24 h-24 mx-auto mb-3">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-amber-300 to-orange-500 blur-2xl opacity-50 animate-pulse" />
          <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-2xl shadow-amber-500/40">
            <Trophy size={48} className="text-white drop-shadow" />
          </div>
        </div>

        <p className="text-xs font-extrabold text-amber-700 dark:text-amber-300 tracking-widest inline-flex items-center gap-1 justify-center">
          <Sparkles size={12} /> 클럽 완주 <Sparkles size={12} />
        </p>
        <h2 className="text-2xl font-extrabold mt-1 break-keep">{course.name}</h2>
        <p className="text-sm text-[var(--muted)] mt-1">
          {course.country ?? '세계'} · {course.distance_km.toFixed(1)}km · 함께 해낸 {members.length}명
        </p>

        {/* 멤버 아바타 row */}
        {members.length > 0 && (
          <div className="mt-4 flex items-center justify-center -space-x-2">
            {members.slice(0, 7).map(m => (
              <div key={m.user_id} className="w-9 h-9 rounded-full bg-white dark:bg-zinc-900 border-2 border-amber-300 overflow-hidden">
                {m.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs font-bold text-amber-700">{m.display_name.slice(0,1)}</div>
                )}
              </div>
            ))}
            {members.length > 7 && (
              <div className="w-9 h-9 rounded-full bg-amber-500 text-white flex items-center justify-center font-extrabold text-[10px] border-2 border-amber-300">+{members.length - 7}</div>
            )}
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button
            onClick={handleDownload}
            className="flex-1 py-3 rounded-xl bg-white dark:bg-zinc-800 border-2 border-amber-300/60 dark:border-amber-800/40 text-amber-700 dark:text-amber-300 font-extrabold text-sm active:scale-[0.98] inline-flex items-center justify-center gap-1.5"
          >
            <Download size={14} /> 인증서
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 text-white font-extrabold text-sm active:scale-[0.98] shadow-md shadow-amber-500/30"
          >
            축하해요!
          </button>
        </div>
      </div>
    </div>
  );
}

// 클럽 완주 인증서 PDF — canvas 생성. CourseDetailSheet 패턴 재활용 + 멤버 합산.
function downloadClubCertificate(course: ClubCourse, members: ClubCourseLeaderRow[]) {
  const W = 1600;
  const H = 1131;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#fefce8');
  bg.addColorStop(1, '#f0fdf4');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 20;
  ctx.strokeRect(40, 40, W - 80, H - 80);
  ctx.strokeStyle = '#10b981'; ctx.lineWidth = 4;
  ctx.strokeRect(70, 70, W - 140, H - 140);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#10b981';
  ctx.font = 'bold 36px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('ROUTINIST · CLUB MARATHON', W / 2, 160);

  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold 92px Georgia, serif';
  ctx.fillText('클럽 완주 인증서', W / 2, 300);

  ctx.fillStyle = '#6b7280';
  ctx.font = '32px Georgia, serif';
  ctx.fillText('CLUB CERTIFICATE OF COMPLETION', W / 2, 350);

  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold 80px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(course.name, W / 2, 500);

  ctx.fillStyle = '#f59e0b';
  ctx.font = 'bold 56px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(`${course.distance_km.toFixed(1)} km · ${course.country ?? '세계'}`, W / 2, 580);

  ctx.fillStyle = '#374151';
  ctx.font = '32px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(`함께 해낸 ${members.length}명의 러너`, W / 2, 670);

  // top 6 멤버 이름 row
  ctx.fillStyle = '#10b981';
  ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, sans-serif';
  const names = members.slice(0, 6).map(m => `${m.display_name} (${Number(m.contributed_km).toFixed(0)}km)`).join('  ·  ');
  ctx.fillText(names, W / 2, 740);

  if (members.length > 6) {
    ctx.fillStyle = '#9ca3af';
    ctx.font = '22px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(`+ ${members.length - 6}명 더`, W / 2, 780);
  }

  const dateStr = course.completed_at
    ? new Date(course.completed_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  ctx.fillStyle = '#6b7280';
  ctx.font = '30px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(`완주일: ${dateStr}`, W / 2, 920);

  ctx.fillStyle = '#9ca3af';
  ctx.font = '24px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('Run Your Routine Together.', W / 2, 1020);
  ctx.fillStyle = '#10b981';
  ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('routinist.kr', W / 2, 1060);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const link = document.createElement('a');
    link.download = `Routinist_Club_${course.name.replace(/\s/g, '_')}.png`;
    link.href = URL.createObjectURL(blob);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }, 'image/png');
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
