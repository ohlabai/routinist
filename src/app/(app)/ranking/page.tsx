'use client';

// 랭킹 페이지 (build 100 신규) — 내 랭킹 + 마일리지 2 서브탭.
// 이전 /social 의 me, mileage 서브탭에서 이전. /social 은 친구/클럽/포토만 유지.

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import AppLogo from '@/components/AppLogo';
import MileageRankingTab from '@/components/social/MileageRankingTab';
import RankingBreakdown from '@/components/ranking/RankingBreakdown';
import RankingTimeline from '@/components/ranking/RankingTimeline';
import { Trophy, Coins, Globe } from 'lucide-react';
import ContestTab from '@/components/contest/ContestTab';
import WorldTab from '@/components/world/WorldTab';
import { useI18n, type TranslationKey } from '@/lib/i18n';

// build 143: 친선런 메뉴 숨김 (사용량 0건, 사용자 결정). 코드/ContestTab/DB 는 유지 — 필요 시 복원.
type SubTab = 'me' | 'mileage' | 'contest' | 'world';
// build 169 #11: '오늘' 제거 (의미 작음·미달리기 사용자가 0km 동률 → 혼란). week/month/year 3축으로 축소.
type TimeAxis = 'week' | 'month' | 'year';

function RankingInner() {
  const { profile } = useAuth();
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') as SubTab) ?? 'me';
  const [activeSub, setActiveSub] = useState<SubTab>(
    ['me', 'mileage', 'world'].includes(initialTab) ? initialTab : 'me'
  );
  const [axis, setAxis] = useState<TimeAxis>('week');

  const hasDemographics = !!(profile?.region_gu || profile?.birth_year || profile?.gender);

  const SUB_TABS: { id: SubTab; tKey: TranslationKey; Icon: typeof Trophy }[] = [
    { id: 'me', tKey: 'ranking.mine', Icon: Trophy },
    { id: 'mileage', tKey: 'ranking.mileage', Icon: Coins },
    { id: 'world', tKey: 'ranking.world', Icon: Globe },
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
      {/* 4탭 — 가로 스크롤 (build 106 하루 대회·세계를 달려 추가). 화면 좁아서 등분 안 함. */}
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
              <p className="text-lg font-bold text-[var(--foreground)]">내 조건 입력하고 랭킹 보기 →</p>
              <p className="text-sm text-[var(--muted)] mt-1">지역·출생년도·성별을 설정하면 4가지 축으로 내 위치가 보여요</p>
            </Link>
          )}

        </div>
      )}

      {activeSub === 'mileage' && <MileageRankingTab />}
      {activeSub === 'contest' && <ContestTab />}
      {activeSub === 'world' && <WorldTab />}
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
