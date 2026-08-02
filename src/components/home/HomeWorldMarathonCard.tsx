'use client';

// build 215 #4: 홈 메인에 진행 중인 월드 마라톤 카드 — 현재 진행률 + 클릭 시 상세 페이지로.
// 2026-08-02 (hans): 월드런 허브로 통합 — "월드런의 최소 요건 = 매달 42.195km" 이므로
// 기본 챌린지(MonthlyChallengeCard)를 이 카드 안으로 흡수. 홈 목표 카드의 중복 노출 제거.
// 코스가 없어도 기본 챌린지가 항상 보임 = 월드런 입문 퍼널.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Globe, ChevronRight, Trophy } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { fetchMyCourses, type MyCourse } from '@/lib/world-data';
import { useI18n } from '@/lib/i18n';
import MonthlyChallengeCard from './MonthlyChallengeCard';

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

  if (loading) return null;

  const active = courses.filter(c => !c.completed_at);
  const lastCompleted = courses.find(c => !!c.completed_at);
  const allCompleted = courses.length > 0 && active.length === 0;

  const headerStatus = active.length > 0
    ? `${tt('진행 중')} · ${active.length}`
    : allCompleted
      ? (locale === 'en' ? `${lastCompleted!.name} done — pick a new course! 🌍` : `${lastCompleted!.name} 완주! 새 코스에 도전해봐요 🌍`)
      : (locale === 'en' ? 'Start with this month’s base course' : '이달의 기본 코스부터 시작해요');

  return (
    <div className="mx-4 mt-3 rounded-2xl bg-gradient-to-br from-sky-50 via-white to-emerald-50/40 dark:from-sky-950/30 dark:via-zinc-900 dark:to-emerald-950/20 border border-sky-200/60 dark:border-sky-900/40 p-4 shadow-sm">
      {/* 헤더 — 월드런 허브 진입 */}
      <Link href="/ranking?tab=world" className="flex items-center gap-2 mb-3 active:opacity-70 transition">
        <div className="w-9 h-9 rounded-2xl bg-sky-100 dark:bg-sky-900/40 flex items-center justify-center">
          {allCompleted
            ? <Trophy size={18} className="text-amber-500" />
            : <Globe size={18} className="text-sky-600 dark:text-sky-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-extrabold tracking-widest uppercase text-sky-600 dark:text-sky-400">
            {locale === 'en' ? 'WorldRun Challenge' : '월드런 챌린지'}
          </p>
          <p className="text-sm font-extrabold text-[var(--foreground)] truncate">{headerStatus}</p>
        </div>
        <ChevronRight size={16} className="text-[var(--muted)]" />
      </Link>

      {/* 기본 코스 — 매달 풀코스 거리 42.195km (월드런 최소 요건, hans 통합 지시) */}
      <MonthlyChallengeCard flat />

      {/* 진행 중 코스 */}
      {active.length > 0 && (
        <Link href="/ranking?tab=world" className="block mt-3 space-y-2.5 active:opacity-80 transition">
          {active.slice(0, 2).map(c => {
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
        </Link>
      )}

      {/* 2026-08-02 hans "버튼 하나로 심플하게": 새 코스 CTA 버튼 제거 —
          완주 상태는 헤더 문구가 새 코스를 유도하고, 카드 탭(>) = 월드탭 진입. */}
    </div>
  );
}
