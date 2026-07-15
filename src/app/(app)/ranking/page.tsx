'use client';

// 랭킹 페이지 (build 100 신규) — 내 랭킹 + 마일리지 2 서브탭.
// 이전 /social 의 me, mileage 서브탭에서 이전. /social 은 친구/클럽/포토만 유지.

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import AppLogo from '@/components/AppLogo';
import MileageRankingTab from '@/components/social/MileageRankingTab';
import RankingBreakdown from '@/components/ranking/RankingBreakdown';
import RankingTimeline from '@/components/ranking/RankingTimeline';
import { Trophy, Coins, Globe } from 'lucide-react';
import WorldTab from '@/components/world/WorldTab';
import { fetchMyCourses } from '@/lib/world-data';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { readRankingAxis, writeRankingAxis, onRankingAxisChanged } from '@/lib/ranking-filters';

// build 207 — 영문화 누락 fix (#2): "내 조건 입력하고 랭킹 보기" / "지역·출생년도·성별..." 안내 카드 tt 처리.

// 단순화 B (2026-07-11): 친선런 (contest) 탭·코드 삭제 (build 143 부터 숨김 상태였음. DB 는 유지).
// 월드런 (world) 탭은 참가 이력 (user_course_progress) 있는 사용자에게만 노출 — 참가 2명.
type SubTab = 'me' | 'mileage' | 'world';
// build 169 #11: '오늘' 제거 (의미 작음·미달리기 사용자가 0km 동률 → 혼란). week/month/year 3축으로 축소.
type TimeAxis = 'week' | 'month' | 'year';

function RankingInner() {
  const { profile } = useAuth();
  const { t, tt } = useI18n();
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') as SubTab) ?? 'me';
  const [activeSub, setActiveSub] = useState<SubTab>(
    ['me', 'mileage', 'world'].includes(initialTab) ? initialTab : 'me'
  );
  // build 209 #4-2: 홈 RankingHero 와 axis 공유. 기본 'week'. 한쪽에서 토글 시 양쪽 sync.
  const [axis, setAxisState] = useState<TimeAxis>(() => {
    const a = readRankingAxis();
    return a === 'today' ? 'week' : a;
  });
  const setAxis = (a: TimeAxis) => { setAxisState(a); writeRankingAxis(a); };
  useEffect(() => {
    const off = onRankingAxisChanged((a) => {
      const next = a === 'today' ? 'week' : a;
      setAxisState(next);
    });
    return off;
  }, []);

  // 2026-07-15 리뷰 fix: 시/도 코호트 전환 후 si-only (해외 포함) 유저가 랭킹에서 영구 차단되던 게이트 — region_si 포함
  const hasDemographics = !!(profile?.region_si || profile?.region_gu || profile?.birth_year || profile?.gender);

  // 월드런 탭 조건부 노출 — 진행 중/완주 코스가 있을 때만.
  // ?tab=world 딥링크 (진행 push 는 참가자에게만 감) 로 직접 오면 fetch 결과와 무관하게 노출.
  const [hasWorldCourses, setHasWorldCourses] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchMyCourses()
      .then(list => { if (!cancelled) setHasWorldCourses(list.length > 0); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const showWorldTab = hasWorldCourses || initialTab === 'world';

  const SUB_TABS: { id: SubTab; tKey: TranslationKey; Icon: typeof Trophy }[] = [
    { id: 'me', tKey: 'ranking.mine', Icon: Trophy },
    { id: 'mileage', tKey: 'ranking.mileage', Icon: Coins },
    ...(showWorldTab ? [{ id: 'world' as const, tKey: 'ranking.world' as TranslationKey, Icon: Globe }] : []),
  ];

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="px-4 py-3 flex items-center gap-2">
          <AppLogo size={28} />
          <h1 className="text-xl font-extrabold tracking-tight">{t('ranking.title')}</h1>
        </div>
      </header>

      <div className="px-4 pt-4">
      {/* 서브탭 — 내 랭킹 / 마일리지 (+ 월드런 참가자만). 가로 스크롤, 등분 안 함. */}
      <div className="flex bg-[var(--card)] border border-[var(--card-border)] rounded-2xl p-1 mb-5 shadow-sm overflow-x-auto scrollbar-hide gap-1">
        {SUB_TABS.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSub(s.id)}
            className={`flex-shrink-0 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-extrabold transition-all active:scale-95 whitespace-nowrap ${
              activeSub === s.id
                ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-500/30'
                : 'text-[var(--muted)]'
            }`}
          >
            <s.Icon size={16} />
            {t(s.tKey)}
          </button>
        ))}
      </div>

      {activeSub === 'me' && (
        <div className="space-y-4">
          <div className="flex gap-1.5">
            {(['week', 'month', 'year'] as TimeAxis[]).map(a => (
              <button
                key={a}
                onClick={() => setAxis(a)}
                className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${
                  axis === a
                    ? 'bg-emerald-500 text-white shadow-sm'
                    : 'bg-[var(--card-bg)] text-[var(--muted)] border border-[var(--card-border)]'
                }`}
              >
                {a === 'week' ? t('ranking.week') : a === 'month' ? t('ranking.month') : t('ranking.year')}
              </button>
            ))}
          </div>

          {hasDemographics ? (
            <>
              <RankingBreakdown axis={axis} />
              {/* 시계열 그래프 (build 100) — 주/월/년 × scope × rank/km */}
              <RankingTimeline />
            </>
          ) : (
            <Link href="/profile/edit" className="block rounded-3xl bg-gradient-to-br from-emerald-100/80 to-emerald-50/40 p-6 shadow-sm border border-emerald-200/60">
              <p className="text-lg font-bold text-[var(--foreground)]">{tt('내 조건 입력하고 랭킹 보기 →')}</p>
              <p className="text-sm text-[var(--muted)] mt-1">{tt('지역·출생년도·성별을 설정하면 4가지 축으로 내 위치가 보여요')}</p>
            </Link>
          )}

        </div>
      )}

      {activeSub === 'mileage' && <MileageRankingTab />}
      {activeSub === 'world' && showWorldTab && <WorldTab />}
      </div>
    </div>
  );
}

export default function RankingPage() {
  return (
    <Suspense fallback={<div className="p-8 flex justify-center"><div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" /></div>}>
      <RankingInner />
    </Suspense>
  );
}
