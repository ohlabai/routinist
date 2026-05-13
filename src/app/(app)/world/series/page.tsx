'use client';

// 챌린지 시리즈 상세 (build 131).
// /world/series?slug=korea_heritage 형태 query string (output: export 호환)

import { useEffect, useState, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Trophy, MapPin, Sparkles, Coins, Check } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import AppLogo from '@/components/AppLogo';
import AppToast from '@/components/AppToast';
import CourseDetailSheet from '@/components/world/CourseDetailSheet';

interface SeriesCourse {
  course_id: string;
  name: string;
  country: string | null;
  description: string | null;
  distance_km: number;
  preview_path: { x: number; y: number }[] | null;
  entry_fee_p: number;
  series_name: string;
  series_emoji: string;
  series_description: string;
  my_started_at: string | null;
  my_completed_at: string | null;
  my_progress_km: number;
}

function SeriesInner() {
  const sp = useSearchParams();
  const slug = sp.get('slug') ?? '';
  const router = useRouter();
  const [rows, setRows] = useState<SeriesCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [openCourseId, setOpenCourseId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2000);
  };

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.rpc('fetch_series_courses', { p_slug: slug });
      if (error) throw error;
      setRows((data ?? []) as SeriesCourse[]);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '조회 실패', 'warn');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  const seriesMeta = rows[0];
  const completed = rows.filter(r => r.my_completed_at).length;
  const started = rows.filter(r => r.my_started_at).length;
  const pct = rows.length > 0 ? Math.round((completed / rows.length) * 100) : 0;
  const allDone = completed > 0 && completed === rows.length;

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/85 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="px-3 py-3 flex items-center gap-2">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full active:bg-[var(--card-border)]/30">
            <ArrowLeft size={20} />
          </button>
          <AppLogo size={24} />
          <h1 className="text-xl font-extrabold tracking-tight">챌린지 시리즈</h1>
        </div>
      </header>

      <div className="p-4 space-y-3">
        {!slug ? (
          <Link href="/ranking?tab=world" className="block card p-5 text-center">
            <p className="text-sm font-bold">시리즈를 선택해주세요</p>
            <p className="text-xs text-emerald-600 mt-1">월드런 탭으로 →</p>
          </Link>
        ) : loading ? (
          <>
            <div className="card p-5 h-40 animate-pulse" />
            {[0,1,2].map(i => <div key={i} className="card p-4 h-32 animate-pulse" />)}
          </>
        ) : !seriesMeta ? (
          <p className="text-center py-12 text-sm text-[var(--muted)]">시리즈를 찾을 수 없어요</p>
        ) : (
          <>
            <div className={`relative overflow-hidden rounded-3xl p-5 shadow-lg ${
              allDone ? 'bg-gradient-to-br from-amber-400 to-orange-500 shadow-amber-500/40' : 'bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-500/30'
            }`}>
              <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/10 blur-2xl" />
              <div className="relative">
                <div className="text-3xl mb-1">{seriesMeta.series_emoji}</div>
                <h2 className="text-xl font-extrabold text-white">{seriesMeta.series_name}</h2>
                <p className="text-xs text-white/90 mt-1 leading-relaxed">{seriesMeta.series_description}</p>
                <div className="mt-3">
                  <div className="flex items-center gap-2 text-xs font-extrabold text-white mb-1.5">
                    <span>진행률 {pct}%</span>
                    <span className="text-white/85">완주 {completed} / {rows.length}</span>
                    {started > completed && <span className="text-white/85">· 진행중 {started - completed}</span>}
                  </div>
                  <div className="h-2.5 rounded-full bg-white/25 overflow-hidden">
                    <div className="h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                {allDone && (
                  <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/20 backdrop-blur text-xs font-extrabold text-white">
                    <Sparkles size={12} /> 시리즈 완주! 운영자 메달 신청 가능
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              {rows.map((c, i) => {
                const done = !!c.my_completed_at;
                const inProgress = !!c.my_started_at && !done;
                const progress = c.distance_km > 0 ? Math.min(100, (c.my_progress_km / c.distance_km) * 100) : 0;
                return (
                  <button
                    key={c.course_id}
                    onClick={() => setOpenCourseId(c.course_id)}
                    className={`w-full rounded-2xl border-2 p-4 text-left active:scale-[0.99] transition ${
                      done ? 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-300/60' :
                      inProgress ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-300/60' :
                      'bg-[var(--card)] border-[var(--card-border)]'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 ${
                        done ? 'bg-gradient-to-br from-amber-400 to-orange-500' : 'bg-emerald-100 dark:bg-emerald-900/40'
                      }`}>
                        {done ? <Trophy size={20} className="text-white" /> : <span className="text-base font-extrabold text-emerald-700 dark:text-emerald-300">{i + 1}</span>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-base font-extrabold truncate">{c.name}</p>
                        <p className="text-xs text-[var(--muted)] inline-flex items-center gap-1 mt-0.5">
                          <MapPin size={11} /> {c.country ?? '세계'} · {c.distance_km.toFixed(1)}km
                          <Coins size={11} className="ml-1 text-amber-500" />
                          <span className="font-bold">{c.entry_fee_p}</span>
                        </p>
                      </div>
                      {done && <Check size={18} className="text-amber-600 flex-shrink-0 mt-1" />}
                    </div>
                    {inProgress && (
                      <div className="mt-3">
                        <div className="h-1.5 rounded-full bg-[var(--card-border)]/30 overflow-hidden">
                          <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600" style={{ width: `${progress}%` }} />
                        </div>
                        <p className="text-[10px] text-emerald-600 font-bold mt-1">{c.my_progress_km.toFixed(1)} / {c.distance_km.toFixed(1)}km · {progress.toFixed(0)}%</p>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {openCourseId && (
        <CourseDetailSheet courseId={openCourseId} onClose={() => { setOpenCourseId(null); load(); }} />
      )}

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2000} />}
    </div>
  );
}

export default function SeriesDetailPage() {
  return (
    <Suspense fallback={<div className="p-8 flex justify-center"><div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" /></div>}>
      <SeriesInner />
    </Suspense>
  );
}
