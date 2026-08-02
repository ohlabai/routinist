'use client';

// build 215 #4: 홈 메인에 진행 중인 월드 마라톤 카드 — 현재 진행률 + 클릭 시 상세 페이지로.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Globe, ChevronRight, Trophy } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { fetchMyCourses, type MyCourse } from '@/lib/world-data';
import { useI18n } from '@/lib/i18n';

export default function HomeWorldMarathonCard() {
  const { user } = useAuth();
  const { tt, locale } = useI18n();
  const [courses, setCourses] = useState<MyCourse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchMyCourses()
      .then(list => { if (!cancelled) setCourses(list); })
      .catch(() => { if (!cancelled) setCourses([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

  if (loading || courses.length === 0) return null;

  // 진행 중인 코스 (완주 안 한 것) 우선 / 모두 완주했으면 가장 최근 완주 1건
  const active = courses.filter(c => !c.completed_at);
  // 완주만 있는 경우 — 가장 최근 완주 코스 (started_at 기준 정렬은 fetch_my_courses 순서 신뢰)
  const lastCompleted = courses.find(c => !!c.completed_at) ?? courses[0];

  // ── 진행 중인 코스가 하나도 없음 = 전부 완주 → "새 도전 추천" 상태 ──
  // (2026-07-20 hans: 홈 월드런 카드가 완주 후에도 계속 "완주!" 만 보여줘서
  //  다음 도전으로 이어지는 루프가 없었음. 완주 = 축하 + 새 코스 CTA 로 전환.)
  if (active.length === 0) {
    return (
      <div className="mx-4 mt-3">
        <Link
          href="/ranking?tab=world"
          className="block rounded-2xl bg-gradient-to-br from-amber-50 via-white to-emerald-50/50 dark:from-amber-950/20 dark:via-zinc-900 dark:to-emerald-950/20 border border-amber-200/70 dark:border-amber-900/40 p-4 shadow-sm active:scale-[0.99] transition"
        >
          <div className="flex items-center gap-2 mb-2.5">
            <div className="w-9 h-9 rounded-2xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
              <Trophy size={18} className="text-amber-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-extrabold tracking-widest uppercase text-amber-600 dark:text-amber-400">
                {locale === 'en' ? 'WorldRun Challenge' : '월드런 챌린지'}
              </p>
              <p className="text-sm font-extrabold text-[var(--foreground)] truncate">
                {locale === 'en'
                  ? `${lastCompleted.name} completed! 🎉`
                  : `${lastCompleted.name} 완주! 🎉`}
              </p>
            </div>
            <ChevronRight size={16} className="text-[var(--muted)]" />
          </div>

          <p className="text-xs font-semibold text-[var(--muted)] mb-3 leading-relaxed">
            {locale === 'en'
              ? 'Ready for the next stage? Pick a new course and keep the streak going.'
              : '다음 무대는 어디로 떠나볼까요? 새로운 월드런에 도전해봐요 🌍'}
          </p>

          <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-sky-500 to-emerald-500 text-white text-sm font-extrabold shadow-sm shadow-emerald-500/25">
            <Globe size={15} />
            {locale === 'en' ? 'Start a new course' : '새 코스 도전하기'}
          </span>
        </Link>
      </div>
    );
  }

  const display = active;

  return (
    <div className="mx-4 mt-3">
      <Link
        href="/ranking?tab=world"
        className="block rounded-2xl bg-gradient-to-br from-sky-50 via-white to-emerald-50/40 dark:from-sky-950/30 dark:via-zinc-900 dark:to-emerald-950/20 border border-sky-200/60 dark:border-sky-900/40 p-4 shadow-sm active:scale-[0.99] transition"
      >
        <div className="flex items-center gap-2 mb-3">
          <div className="w-9 h-9 rounded-2xl bg-sky-100 dark:bg-sky-900/40 flex items-center justify-center">
            <Globe size={18} className="text-sky-600 dark:text-sky-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-extrabold tracking-widest uppercase text-sky-600 dark:text-sky-400">
              {locale === 'en' ? 'WorldRun Challenge' : '월드런 챌린지'}
            </p>
            <p className="text-sm font-extrabold text-[var(--foreground)]">
              {tt('진행 중')} · {display.length}
            </p>
          </div>
          <ChevronRight size={16} className="text-[var(--muted)]" />
        </div>

        <div className="space-y-2.5">
          {display.slice(0, 2).map(c => {
            const pct = Math.min(100, Math.max(0, (c.progress_km / c.distance_km) * 100));
            return (
              <div key={c.course_id}>
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-sm font-bold text-[var(--foreground)] truncate">
                    {c.name}
                  </span>
                  <span className="text-xs font-bold tabular-nums text-[var(--muted)] flex-shrink-0 ml-2">
                    {c.progress_km.toFixed(1)} / {c.distance_km}km
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[var(--card-border)]/40 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-sky-400 to-emerald-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-[12px] text-[var(--muted)] mt-0.5">
                  {locale === 'en'
                    ? `${pct.toFixed(0)}% · ${(c.distance_km - c.progress_km).toFixed(1)}km left`
                    : `${pct.toFixed(0)}% · 남은 거리 ${(c.distance_km - c.progress_km).toFixed(1)}km`}
                </p>
              </div>
            );
          })}
        </div>
      </Link>
    </div>
  );
}
