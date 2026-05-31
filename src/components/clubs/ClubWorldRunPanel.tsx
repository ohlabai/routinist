'use client';

// build 232: 클럽 월드런 챌린지 패널 — 거리 합산형 릴레이.
// owner/admin 이 코스 시작 → 클럽 멤버 누구나 평소처럼 달리기만 하면 자동 합산.
// 합산 ≥ 코스 distance 도달 시 자동 완주 처리 + 모든 멤버에게 push.

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { Globe, Trophy, Users, Plus, X, MapPin, Crown, Sparkles } from 'lucide-react';
import {
  fetchClubCourses, startClubCourse, fetchClubCourseLeaderboard,
  fetchClubCourseIndividualLeaderboard,
  type ClubCourse, type ClubCourseLeaderboardRow, type ClubCourseIndividualRow,
  type ClubCourseMode,
} from '@/lib/club-courses';
import { fetchAvailableCourses } from '@/lib/world-data';
import type { VirtualCourse } from '@/lib/world-data';

interface Props {
  clubId: string;
  myRole: string | null;
  currentUserId: string | null;
}

const isAdmin = (role: string | null) => role === 'owner' || role === 'admin';

export default function ClubWorldRunPanel({ clubId, myRole, currentUserId }: Props) {
  const [courses, setCourses] = useState<ClubCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerCourses, setPickerCourses] = useState<VirtualCourse[]>([]);
  const [pickerMode, setPickerMode] = useState<ClubCourseMode>('individual');
  const [starting, setStarting] = useState<string | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const cs = await fetchClubCourses(clubId);
    setCourses(cs);
    setLoading(false);
  };

  useEffect(() => { load(); }, [clubId]);

  const active = courses.filter(c => !c.completed_at);
  const finished = courses.filter(c => c.completed_at);

  const handleOpenPicker = async () => {
    setPickerOpen(true);
    if (pickerCourses.length === 0) {
      const all = await fetchAvailableCourses();
      // 이미 진행 중인 코스 제외
      const startedIds = new Set(courses.map(c => c.course_id));
      setPickerCourses(all.filter(c => !startedIds.has(c.id)));
    }
  };

  const handleStart = async (courseId: string) => {
    setStarting(courseId);
    try {
      await startClubCourse(clubId, courseId, pickerMode);
      setPickerOpen(false);
      await load();
    } catch (e) {
      const msg = (typeof e === 'object' && e && 'message' in e)
        ? String((e as { message: unknown }).message)
        : '시작 실패';
      alert(msg);
    } finally {
      setStarting(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1].map(i => <div key={i} className="card h-32 animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 안내 */}
      <div className="rounded-2xl bg-gradient-to-br from-purple-50 to-indigo-50/40 dark:from-purple-950/30 dark:to-indigo-950/15 border border-purple-200/50 dark:border-purple-800/40 p-4">
        <p className="text-sm font-extrabold inline-flex items-center gap-1.5 mb-1.5">
          <Sparkles size={14} className="text-purple-600" /> 클럽 함께 도전
        </p>
        <p className="text-xs text-[var(--muted)] break-keep leading-relaxed">
          멤버들이 달리는 모든 km 가 자동으로 클럽 합산에 쌓여요. 모이면 함께 완주!
          {isAdmin(myRole) ? ' 운영자가 코스를 시작할 수 있어요.' : ' 운영자가 코스를 시작하면 시작돼요.'}
        </p>
      </div>

      {/* 진행 중 코스 */}
      {active.length === 0 && (
        <div className="rounded-2xl bg-[var(--card)] border border-[var(--card-border)] p-6 text-center">
          <Globe size={28} className="mx-auto text-[var(--muted)] mb-2" />
          <p className="text-sm font-bold">{isAdmin(myRole) ? '아직 시작한 도전이 없어요' : '운영자가 새 도전을 시작하면 알림이 와요'}</p>
          {isAdmin(myRole) && (
            <button
              onClick={handleOpenPicker}
              className="mt-3 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-gradient-to-br from-purple-500 to-indigo-500 text-white font-extrabold text-xs active:scale-95 shadow-md shadow-purple-500/30"
            >
              <Plus size={13} /> 새 도전 시작
            </button>
          )}
        </div>
      )}

      {active.length > 0 && active.map(c => {
        const isIndividual = c.mode === 'individual';
        // pooled: 클럽 합산 / total → distance. individual: 멤버별 누적 합 (참고용).
        const pct = Math.min(100, (c.total_km / Math.max(c.distance_km, 0.1)) * 100);
        const remain = Math.max(0, c.distance_km - c.total_km);
        const accent = isIndividual ? 'purple' : 'indigo';
        return (
          <button
            key={c.course_id}
            onClick={() => setSelectedCourseId(c.course_id)}
            className={`w-full text-left rounded-2xl bg-gradient-to-br ${
              isIndividual
                ? 'from-purple-50 to-purple-50/40 dark:from-purple-950/30 dark:to-purple-950/15 border-2 border-purple-300/60 dark:border-purple-800/40 shadow-purple-500/10'
                : 'from-indigo-50 to-indigo-50/40 dark:from-indigo-950/30 dark:to-indigo-950/15 border-2 border-indigo-300/60 dark:border-indigo-800/40 shadow-indigo-500/10'
            } p-5 shadow-md active:scale-[0.99]`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className={`text-[10px] font-extrabold uppercase tracking-widest inline-flex items-center gap-1 ${
                isIndividual ? 'text-purple-700 dark:text-purple-300' : 'text-indigo-700 dark:text-indigo-300'
              }`}>
                {isIndividual ? <><Users size={11} /> 각자 달리기</> : <><Trophy size={11} /> 자동 합산</>}
              </span>
              <span className="text-xs text-[var(--muted)] inline-flex items-center gap-1">
                <Users size={11} /> {c.contributors}명 {isIndividual ? '가입' : '기여'}
              </span>
            </div>
            <h3 className="text-base font-extrabold tracking-tight mb-0.5">{c.name}</h3>
            <p className="text-xs text-[var(--muted)] mb-3">
              <MapPin size={10} className="inline mr-0.5" />{c.country ?? '세계'} · {c.distance_km.toFixed(1)}km
            </p>
            {isIndividual ? (
              <p className="text-sm font-bold text-[var(--foreground)]">
                멤버 {c.contributors}명 도전 중 · 탭해서 순위 보기 →
              </p>
            ) : (
              <>
                <p className="text-3xl font-extrabold tabular-nums leading-none">
                  {c.total_km.toFixed(1)}
                  <span className="text-base font-bold text-[var(--muted)] ml-1">/ {c.distance_km.toFixed(1)}km</span>
                  <span className={`text-sm font-extrabold ml-2 ${accent === 'indigo' ? 'text-indigo-600' : 'text-purple-600'}`}>{Math.round(pct)}%</span>
                </p>
                <div className="mt-2.5 h-3 rounded-full bg-white/70 dark:bg-zinc-900/70 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-indigo-500 transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-[var(--muted)]">
                  남은 거리 <span className="font-extrabold text-indigo-700 dark:text-indigo-300">{remain.toFixed(1)}km</span> · 탭해서 리더보드 →
                </p>
              </>
            )}
          </button>
        );
      })}

      {/* 추가 도전 시작 (active 가 있어도) */}
      {isAdmin(myRole) && active.length > 0 && (
        <button
          onClick={handleOpenPicker}
          className="w-full py-3 rounded-2xl border-2 border-dashed border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 font-extrabold text-sm active:scale-[0.99] inline-flex items-center justify-center gap-1.5"
        >
          <Plus size={14} /> 새 도전 추가
        </button>
      )}

      {/* 완주 list */}
      {finished.length > 0 && (
        <div>
          <h4 className="text-xs font-extrabold uppercase tracking-widest text-[var(--muted)] mb-2 px-1">
            🏆 완주한 도전
          </h4>
          <div className="space-y-2">
            {finished.map(c => (
              <button
                key={c.course_id}
                onClick={() => setSelectedCourseId(c.course_id)}
                className="w-full text-left rounded-2xl bg-gradient-to-br from-amber-50 to-amber-50/40 dark:from-amber-950/30 dark:to-amber-950/15 border border-amber-200/60 dark:border-amber-800/40 p-4 active:scale-[0.99]"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Trophy size={14} className="text-amber-600" />
                  <span className="text-sm font-extrabold flex-1 truncate">{c.name}</span>
                  <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300">
                    {c.completed_at && new Date(c.completed_at).toLocaleDateString('ko-KR')}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--muted)]">
                  {c.distance_km.toFixed(1)}km · {c.contributors}명 기여 · 클럽 합산 {c.total_km.toFixed(1)}km
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 코스 picker 모달 */}
      {pickerOpen && (
        <div className="fixed inset-0 z-[80] bg-black/65 flex items-end sm:items-center justify-center sm:p-3" onClick={() => setPickerOpen(false)}>
          <div className="w-full sm:max-w-md bg-[var(--background)] rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[var(--card-border)]/40">
              <h3 className="text-base font-extrabold">새 클럽 도전 시작</h3>
              <button onClick={() => setPickerOpen(false)} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[var(--card-border)]/40 active:scale-90">
                <X size={18} />
              </button>
            </div>

            {/* build 235: 모드 선택 — 디폴트 각자 달리기. */}
            <div className="px-5 pt-3 pb-1">
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted)] mb-1.5">진행 방식</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setPickerMode('individual')}
                  className={`px-3 py-2.5 rounded-xl text-xs font-extrabold transition active:scale-[0.98] text-left ${
                    pickerMode === 'individual'
                      ? 'bg-purple-500 text-white shadow-md shadow-purple-500/30'
                      : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
                  }`}
                >
                  <div className="text-sm font-extrabold mb-0.5">🏃 각자 달리기</div>
                  <div className="text-[10px] font-normal opacity-90">멤버 각자 본인 진행률</div>
                </button>
                <button
                  onClick={() => setPickerMode('pooled')}
                  className={`px-3 py-2.5 rounded-xl text-xs font-extrabold transition active:scale-[0.98] text-left ${
                    pickerMode === 'pooled'
                      ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/30'
                      : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
                  }`}
                >
                  <div className="text-sm font-extrabold mb-0.5">🤝 자동 합산</div>
                  <div className="text-[10px] font-normal opacity-90">전 멤버 km 합쳐 1회 완주</div>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
              {pickerCourses.length === 0 ? (
                <p className="text-sm text-[var(--muted)] text-center py-8">선택 가능한 코스가 없어요</p>
              ) : pickerCourses.map(pc => (
                <button
                  key={pc.id}
                  onClick={() => handleStart(pc.id)}
                  disabled={starting !== null}
                  className="w-full text-left rounded-xl bg-[var(--card)] border border-[var(--card-border)] p-3 active:scale-[0.99] disabled:opacity-50"
                >
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-extrabold truncate">{pc.name}</p>
                      <p className="text-[11px] text-[var(--muted)]">{pc.country ?? '세계'} · {pc.distance_km.toFixed(1)}km</p>
                    </div>
                    {starting === pc.id ? (
                      <span className="text-xs text-emerald-600 font-bold">시작 중…</span>
                    ) : (
                      <span className="text-purple-600 text-sm font-extrabold">시작 →</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
            <p className="px-5 pb-4 pt-2 text-[11px] text-[var(--muted)] text-center border-t border-[var(--card-border)]/40">
              참가비는 차감되지 않아요. 클럽 멤버 활동이 자동 합산됩니다.
            </p>
          </div>
        </div>
      )}

      {/* 코스 상세 sheet (leaderboard) */}
      {selectedCourseId && (
        <ClubCourseDetailSheet
          clubId={clubId}
          course={courses.find(c => c.course_id === selectedCourseId)!}
          currentUserId={currentUserId}
          onClose={() => setSelectedCourseId(null)}
        />
      )}
    </div>
  );
}

interface DetailProps {
  clubId: string;
  course: ClubCourse;
  currentUserId: string | null;
  onClose: () => void;
}

function ClubCourseDetailSheet({ clubId, course, currentUserId, onClose }: DetailProps) {
  const isIndividual = course.mode === 'individual';
  const [pooledRows, setPooledRows] = useState<ClubCourseLeaderboardRow[]>([]);
  const [indivRows, setIndivRows] = useState<ClubCourseIndividualRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const load = isIndividual
      ? fetchClubCourseIndividualLeaderboard(clubId, course.course_id).then(r => { if (!cancelled) setIndivRows(r); })
      : fetchClubCourseLeaderboard(clubId, course.course_id).then(r => { if (!cancelled) setPooledRows(r); });
    load.finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clubId, course.course_id, isIndividual]);

  const pct = Math.min(100, (course.total_km / Math.max(course.distance_km, 0.1)) * 100);
  const completed = !!course.completed_at;
  const maxKm = useMemo(() => {
    if (isIndividual) return Math.max(...indivRows.map(r => r.progress_km), course.distance_km * 0.1, 1);
    return Math.max(...pooledRows.map(r => r.contributed_km), 1);
  }, [isIndividual, indivRows, pooledRows, course.distance_km]);

  return (
    <div className="fixed inset-0 z-[90] bg-black/65 flex items-end sm:items-center justify-center sm:p-3" onClick={onClose}>
      <div
        className="w-full sm:max-w-lg bg-[var(--background)] rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-4 pb-3 border-b border-[var(--card-border)]/40 flex items-center justify-between">
          <div className="min-w-0">
            <h3 className="text-base font-extrabold tracking-tight truncate">{course.name}</h3>
            <p className="text-[11px] text-[var(--muted)]">{course.country ?? '세계'} · {course.distance_km.toFixed(1)}km</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[var(--card-border)]/40 active:scale-90">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* 진행 hero — pooled 만 표시. individual 은 멤버 수 / 평균 강조. */}
          {!isIndividual && (
            <div className={`rounded-2xl p-5 ${
              completed
                ? 'bg-gradient-to-br from-amber-50 to-orange-50/40 dark:from-amber-950/30 border-2 border-amber-300/60 dark:border-amber-800/40'
                : 'bg-gradient-to-br from-indigo-50 to-indigo-50/40 dark:from-indigo-950/30 border-2 border-indigo-300/60 dark:border-indigo-800/40'
            }`}>
              <p className={`text-[10px] font-extrabold uppercase tracking-widest mb-1 inline-flex items-center gap-1 ${
                completed ? 'text-amber-700 dark:text-amber-300' : 'text-indigo-700 dark:text-indigo-300'
              }`}>
                <Trophy size={11} /> {completed ? '완주!' : '클럽 합산 진행'}
              </p>
              <p className="text-4xl font-extrabold tabular-nums leading-none">
                {course.total_km.toFixed(1)}
                <span className="text-lg font-bold text-[var(--muted)] ml-1">/ {course.distance_km.toFixed(1)}km</span>
              </p>
              <div className="mt-3 h-3 rounded-full bg-white/70 dark:bg-zinc-900/70 overflow-hidden">
                <div
                  className={`h-full rounded-full ${completed ? 'bg-gradient-to-r from-amber-400 to-orange-500' : 'bg-gradient-to-r from-indigo-400 to-indigo-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-[var(--muted)]">
                {completed
                  ? `🎉 ${course.completed_at && new Date(course.completed_at).toLocaleDateString('ko-KR')} 클럽이 함께 완주했어요!`
                  : `남은 거리 ${Math.max(0, course.distance_km - course.total_km).toFixed(1)}km · ${course.contributors}명 기여 중`}
              </p>
            </div>
          )}

          {isIndividual && (
            <div className="rounded-2xl p-5 bg-gradient-to-br from-purple-50 to-purple-50/40 dark:from-purple-950/30 border-2 border-purple-300/60 dark:border-purple-800/40">
              <p className="text-[10px] font-extrabold uppercase tracking-widest mb-1 inline-flex items-center gap-1 text-purple-700 dark:text-purple-300">
                <Users size={11} /> 각자 달리기 · {course.distance_km.toFixed(1)}km
              </p>
              <p className="text-2xl font-extrabold tracking-tight leading-tight">{course.contributors}명 도전 중</p>
              <p className="mt-1 text-xs text-[var(--muted)] break-keep">
                멤버들이 각자 본인 페이스로 같은 코스를 달려요. 본인 도전이 아직이면 월드런 챌린지 탭에서 시작할 수 있어요.
              </p>
            </div>
          )}

          {/* 멤버 리더보드 — mode 별 다른 데이터 */}
          <div>
            <h4 className="text-sm font-extrabold mb-2.5 inline-flex items-center gap-1.5">
              <Users size={14} className="text-purple-600" />
              {isIndividual ? '멤버 진행률 순위' : '멤버 기여 순위'}
            </h4>
            {loading ? (
              <p className="text-xs text-[var(--muted)] text-center py-4">불러오는 중…</p>
            ) : isIndividual ? (
              indivRows.length === 0 ? (
                <p className="text-xs text-[var(--muted)] text-center py-4 italic">아직 도전한 멤버가 없어요</p>
              ) : (
                <div className="space-y-1.5">
                  {indivRows.map((r, i) => {
                    const isMe = r.user_id === currentUserId;
                    const barPct = Math.min(100, (r.progress_km / maxKm) * 100);
                    const memberPct = Math.round(r.ratio * 100);
                    return (
                      <Link
                        key={r.user_id}
                        href={isMe ? '/profile' : `/social/user?id=${r.user_id}`}
                        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl ${
                          isMe
                            ? 'bg-gradient-to-r from-amber-50 to-amber-50/40 dark:from-amber-950/30 border border-amber-300/60 dark:border-amber-800/40'
                            : 'bg-[var(--card)] border border-[var(--card-border)]/40'
                        }`}
                      >
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-extrabold flex-shrink-0 ${
                          i === 0 ? 'bg-amber-100 text-amber-700' :
                          i === 1 ? 'bg-zinc-200 text-zinc-700' :
                          i === 2 ? 'bg-orange-100 text-orange-700' :
                          'bg-[var(--card-border)]/40 text-[var(--muted)]'
                        }`}>
                          {i === 0 ? <Crown size={11} className="text-amber-600" /> : i + 1}
                        </span>
                        <div className="w-7 h-7 rounded-full bg-[var(--card-border)]/40 overflow-hidden flex-shrink-0">
                          {r.avatar_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[11px] font-bold text-[var(--muted)]">{r.display_name.slice(0, 1)}</div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className={`text-sm truncate ${isMe ? 'font-extrabold text-amber-700 dark:text-amber-300' : 'font-bold'}`}>
                              {r.display_name}{isMe && <span className="ml-1 text-[10px] font-bold">(나)</span>}
                              {r.completed_at && <Trophy size={11} className="inline ml-1 text-emerald-600" />}
                            </span>
                            <span className="text-[11px] font-extrabold text-[var(--muted)] tabular-nums">
                              {r.progress_km.toFixed(1)}km · {memberPct}%
                            </span>
                          </div>
                          <div className="mt-1 h-1.5 rounded-full bg-[var(--card-border)]/40 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${isMe ? 'bg-gradient-to-r from-amber-400 to-amber-500' : 'bg-purple-400/70'}`}
                              style={{ width: `${barPct}%` }}
                            />
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )
            ) : pooledRows.length === 0 ? (
              <p className="text-xs text-[var(--muted)] text-center py-4 italic">아직 기여한 멤버가 없어요</p>
            ) : (
              <div className="space-y-1.5">
                {pooledRows.map((r, i) => {
                  const isMe = r.user_id === currentUserId;
                  const barPct = Math.min(100, (r.contributed_km / maxKm) * 100);
                  return (
                    <Link
                      key={r.user_id}
                      href={isMe ? '/profile' : `/social/user?id=${r.user_id}`}
                      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl ${
                        isMe
                          ? 'bg-gradient-to-r from-amber-50 to-amber-50/40 dark:from-amber-950/30 border border-amber-300/60 dark:border-amber-800/40'
                          : 'bg-[var(--card)] border border-[var(--card-border)]/40'
                      }`}
                    >
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-extrabold flex-shrink-0 ${
                        i === 0 ? 'bg-amber-100 text-amber-700' :
                        i === 1 ? 'bg-zinc-200 text-zinc-700' :
                        i === 2 ? 'bg-orange-100 text-orange-700' :
                        'bg-[var(--card-border)]/40 text-[var(--muted)]'
                      }`}>
                        {i === 0 ? <Crown size={11} className="text-amber-600" /> : i + 1}
                      </span>
                      <div className="w-7 h-7 rounded-full bg-[var(--card-border)]/40 overflow-hidden flex-shrink-0">
                        {r.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[11px] font-bold text-[var(--muted)]">{r.display_name.slice(0, 1)}</div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className={`text-sm truncate ${isMe ? 'font-extrabold text-amber-700 dark:text-amber-300' : 'font-bold'}`}>
                            {r.display_name}{isMe && <span className="ml-1 text-[10px] font-bold">(나)</span>}
                          </span>
                          <span className="text-[11px] font-extrabold text-[var(--muted)] tabular-nums">{r.contributed_km.toFixed(1)}km</span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-[var(--card-border)]/40 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${isMe ? 'bg-gradient-to-r from-amber-400 to-amber-500' : 'bg-indigo-400/70'}`}
                            style={{ width: `${barPct}%` }}
                          />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
