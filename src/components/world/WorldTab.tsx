'use client';

// 세계를 달려! (Virtual Course) — 랭킹 탭 서브탭 (build 106).
// 유명 마라톤 / 트레일 코스를 가상으로 누적. 완주 시 메달 (수기 발급).

import { useEffect, useState, useCallback } from 'react';
import { Globe, Trophy, Sparkles, Flag, MapPin } from 'lucide-react';
import {
  fetchAvailableCourses,
  fetchMyCourses,
  startCourse,
  type VirtualCourse,
  type MyCourse,
  type PreviewPoint,
} from '@/lib/world-data';
import AppToast from '@/components/AppToast';

// 코스 카드용 미리보기 SVG — preview_path (0~100) 정규화 폴리라인.
// 시작점=에메랄드 원, 끝점=주황 원. 배경 그리드 + 폴리라인 그림자.
function CoursePreview({ path, progress }: { path: PreviewPoint[] | null; progress?: number }) {
  if (!path || path.length === 0) {
    return (
      <div className="w-full h-28 rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/40 flex items-center justify-center">
        <Globe size={28} className="text-emerald-500/40" />
      </div>
    );
  }
  const d = path.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const first = path[0];
  const last = path[path.length - 1];
  // 진행률 표시 — path 를 길이 기반으로 자른 위치에 러너 마커
  let runner: PreviewPoint | null = null;
  if (typeof progress === 'number' && progress > 0 && progress < 1 && path.length > 1) {
    const cum: number[] = [0];
    for (let i = 1; i < path.length; i++) {
      const dx = path[i].x - path[i - 1].x;
      const dy = path[i].y - path[i - 1].y;
      cum.push(cum[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    const total = cum[cum.length - 1];
    const target = total * progress;
    for (let i = 1; i < path.length; i++) {
      if (cum[i] >= target) {
        const t = (target - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
        runner = {
          x: path[i - 1].x + (path[i].x - path[i - 1].x) * t,
          y: path[i - 1].y + (path[i].y - path[i - 1].y) * t,
        };
        break;
      }
    }
  }

  return (
    <div className="relative w-full h-28 rounded-xl bg-gradient-to-br from-emerald-50/70 via-white to-teal-50/40 dark:from-emerald-950/30 dark:via-zinc-900 dark:to-teal-950/20 overflow-hidden border border-emerald-100 dark:border-emerald-900/40">
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" className="w-full h-full">
        {/* 가벼운 그리드 */}
        <defs>
          <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(16,185,129,0.08)" strokeWidth="0.3" />
          </pattern>
        </defs>
        <rect width="100" height="60" fill="url(#grid)" />
        {/* 폴리라인 그림자 */}
        <path d={d} fill="none" stroke="rgba(0,0,0,0.12)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" transform="translate(0,0.4)" />
        {/* 본체 — 에메랄드 그라데이션 */}
        <defs>
          <linearGradient id="route" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>
        </defs>
        <path d={d} fill="none" stroke="url(#route)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        {/* 시작 */}
        <circle cx={first.x} cy={first.y} r="2.4" fill="#10b981" stroke="#ffffff" strokeWidth="0.6" />
        {/* 끝 */}
        <circle cx={last.x} cy={last.y} r="2.4" fill="#f97316" stroke="#ffffff" strokeWidth="0.6" />
        {/* 러너 마커 (진행중) */}
        {runner && (
          <>
            <circle cx={runner.x} cy={runner.y} r="3.2" fill="#ffffff" stroke="#10b981" strokeWidth="1.2" />
            <circle cx={runner.x} cy={runner.y} r="1.4" fill="#10b981" />
          </>
        )}
      </svg>
    </div>
  );
}

export default function WorldTab() {
  const [mine, setMine] = useState<MyCourse[]>([]);
  const [available, setAvailable] = useState<VirtualCourse[]>([]);
  const [pathMap, setPathMap] = useState<Map<string, PreviewPoint[] | null>>(new Map());
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const showToast = useCallback((text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2200);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    // 두 fetch 를 분리해서 한쪽 실패해도 다른 쪽은 표시 (사용자 신고: 빈 코스 화면).
    const myPromise = fetchMyCourses().catch(e => {
      console.warn('[world] fetchMyCourses fail', e);
      return [] as MyCourse[];
    });
    const allPromise = fetchAvailableCourses().catch(e => {
      console.warn('[world] fetchAvailableCourses fail', e);
      return [] as VirtualCourse[];
    });
    const [my, all] = await Promise.all([myPromise, allPromise]);

    setMine(my);
    const startedIds = new Set(my.map(m => m.course_id));
    setAvailable(all.filter(c => !startedIds.has(c.id)));

    // 진행중 코스도 미리보기 보이게 — all 의 preview_path 매핑.
    const map = new Map<string, PreviewPoint[] | null>();
    all.forEach(c => map.set(c.id, c.preview_path));
    setPathMap(map);

    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleStart = async (courseId: string) => {
    setStarting(courseId);
    try {
      await startCourse(courseId);
      showToast('✨ 코스를 시작했어요');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '시작 실패', 'warn');
    } finally {
      setStarting(null);
    }
  };

  const completed = mine.filter(m => m.completed_at);
  const inProgress = mine.filter(m => !m.completed_at);

  return (
    <div className="space-y-5">
      {/* 진행 중 */}
      {inProgress.length > 0 && (
        <Section title="진행 중" icon={<Flag size={14} className="text-emerald-500" />}>
          <div className="space-y-2.5">
            {inProgress.map(c => <ProgressCard key={c.course_id} course={c} path={pathMap.get(c.course_id) ?? null} />)}
          </div>
        </Section>
      )}

      {/* 완주 메달 진열 */}
      {completed.length > 0 && (
        <Section title="완주 메달" icon={<Trophy size={14} className="text-amber-500" />}>
          <div className="grid grid-cols-3 gap-2.5">
            {completed.map(c => (
              <div key={c.course_id} className="card p-3 text-center">
                <div className="w-14 h-14 rounded-full mx-auto mb-1.5 bg-gradient-to-br from-amber-300 to-orange-500 flex items-center justify-center shadow-lg">
                  {c.has_medal ? <Trophy size={26} className="text-white" /> : <Sparkles size={22} className="text-white" />}
                </div>
                <p className="text-xs font-extrabold truncate">{c.name}</p>
                <p className="text-[10px] text-[var(--muted)]">{c.distance_km.toFixed(1)}km</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 시작 가능한 코스 */}
      <Section title="새 코스" icon={<Globe size={14} className="text-emerald-500" />}>
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map(i => <div key={i} className="card p-4 animate-pulse h-24" />)}
          </div>
        ) : available.length === 0 && mine.length === 0 ? (
          <div className="card p-6 text-center">
            <Globe size={28} className="mx-auto text-[var(--muted)] mb-2" />
            <p className="text-sm font-bold">아직 등록된 코스가 없어요</p>
            <p className="text-xs text-[var(--muted)] mt-1">곧 추가될 예정이에요</p>
          </div>
        ) : (
          <div className="space-y-3">
            {available.map(c => (
              <div key={c.id} className="rounded-2xl bg-[var(--card)] border border-[var(--card-border)] overflow-hidden">
                {/* 지도 미리보기 — 위쪽 풀폭 */}
                <CoursePreview path={c.preview_path} />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h3 className="text-base font-extrabold truncate">{c.name}</h3>
                    <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex-shrink-0">
                      {c.distance_km.toFixed(1)}km
                    </span>
                  </div>
                  <p className="text-xs text-[var(--muted)] inline-flex items-center gap-1 font-semibold">
                    <MapPin size={11} /> {c.country ?? '세계'}
                  </p>
                  {c.description && (
                    <p className="text-[13px] text-[var(--foreground)] mt-2 leading-relaxed break-keep">{c.description}</p>
                  )}
                  <button
                    onClick={() => handleStart(c.id)}
                    disabled={starting === c.id}
                    className="mt-3 w-full py-3 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-sm active:scale-[0.99] disabled:opacity-50 shadow-md shadow-emerald-500/25"
                  >
                    {starting === c.id ? '시작 중…' : '도전 시작'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2200} />}
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-extrabold mb-2.5 inline-flex items-center gap-1.5">{icon}{title}</h2>
      {children}
    </section>
  );
}

function ProgressCard({ course, path }: { course: MyCourse; path: PreviewPoint[] | null }) {
  const pct = Math.min(100, (course.progress_km / course.distance_km) * 100);
  const remain = Math.max(0, course.distance_km - course.progress_km);
  const ratio = Math.min(1, course.progress_km / course.distance_km);
  return (
    <div className="rounded-2xl bg-[var(--card)] border border-[var(--card-border)] overflow-hidden">
      {/* 지도 미리보기 + 러너 위치 마커 */}
      <CoursePreview path={path} progress={ratio} />
      <div className="p-4">
        <div className="flex items-baseline justify-between gap-2 mb-0.5">
          <p className="text-base font-extrabold truncate">{course.name}</p>
          <span className="text-xs text-[var(--muted)] flex-shrink-0 font-semibold">{course.country ?? ''}</span>
        </div>
        <p className="text-xs text-[var(--muted)] font-semibold">
          {course.progress_km.toFixed(1)} / {course.distance_km.toFixed(1)} km
        </p>

        <div className="mt-3">
          <div className="h-2.5 rounded-full bg-[var(--card-border)]/30 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all duration-700 ease-out" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex items-center justify-between mt-1.5 text-xs">
            <span className="text-emerald-600 font-extrabold">{pct.toFixed(0)}%</span>
            {remain > 0 ? (
              <span className="text-[var(--muted)] font-semibold">남은 거리 {remain.toFixed(1)}km</span>
            ) : (
              <span className="text-emerald-600 font-extrabold inline-flex items-center gap-1">
                <Trophy size={12} /> 완주!
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
