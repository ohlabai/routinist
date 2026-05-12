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
} from '@/lib/world-data';
import AppToast from '@/components/AppToast';

export default function WorldTab() {
  const [mine, setMine] = useState<MyCourse[]>([]);
  const [available, setAvailable] = useState<VirtualCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const showToast = useCallback((text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2200);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [my, all] = await Promise.all([fetchMyCourses(), fetchAvailableCourses()]);
      setMine(my);
      const startedIds = new Set(my.map(m => m.course_id));
      setAvailable(all.filter(c => !startedIds.has(c.id)));
    } catch (e) {
      console.warn('[world] load fail', e);
    } finally {
      setLoading(false);
    }
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
            {inProgress.map(c => <ProgressCard key={c.course_id} course={c} />)}
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
          <div className="space-y-2.5">
            {available.map(c => (
              <div key={c.id} className="card p-4">
                <div className="flex items-start gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-100 to-teal-50 dark:from-emerald-900/40 dark:to-teal-950/40 flex items-center justify-center flex-shrink-0">
                    <Globe size={26} className="text-emerald-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-extrabold truncate">{c.name}</p>
                    <p className="text-xs text-[var(--muted)] inline-flex items-center gap-1 mt-0.5">
                      <MapPin size={10} />
                      {c.country ?? '세계'} · {c.distance_km.toFixed(1)}km
                    </p>
                    {c.description && (
                      <p className="text-[11px] text-[var(--muted)] mt-1 line-clamp-2">{c.description}</p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleStart(c.id)}
                  disabled={starting === c.id}
                  className="mt-3 w-full py-2.5 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-bold text-sm active:scale-[0.99] disabled:opacity-50"
                >
                  {starting === c.id ? '시작 중…' : '도전 시작'}
                </button>
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

function ProgressCard({ course }: { course: MyCourse }) {
  const pct = Math.min(100, (course.progress_km / course.distance_km) * 100);
  const remain = Math.max(0, course.distance_km - course.progress_km);
  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-100 to-teal-50 dark:from-emerald-900/40 dark:to-teal-950/40 flex items-center justify-center flex-shrink-0">
          <Globe size={22} className="text-emerald-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-extrabold truncate">{course.name}</p>
            <span className="text-xs text-[var(--muted)] flex-shrink-0">
              {course.country ?? ''}
            </span>
          </div>
          <p className="text-[11px] text-[var(--muted)] mt-0.5">
            {course.progress_km.toFixed(1)} / {course.distance_km.toFixed(1)} km
          </p>
        </div>
      </div>

      <div className="mt-2.5">
        <div className="h-2.5 rounded-full bg-[var(--card-border)]/30 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all duration-700 ease-out" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center justify-between mt-1.5 text-[11px]">
          <span className="text-emerald-600 font-extrabold">{pct.toFixed(0)}%</span>
          {remain > 0 ? (
            <span className="text-[var(--muted)] font-semibold">남은 거리 {remain.toFixed(1)}km</span>
          ) : (
            <span className="text-emerald-600 font-extrabold inline-flex items-center gap-0.5">
              <Trophy size={11} /> 완주!
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
