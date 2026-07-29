'use client';

// 내 기록 통계 — 홈 UX Phase B (build 327, hans 리뷰).
// 홈에 쌓여 있던 차트 7종을 전용 페이지로 분리 — 홈은 "오늘 뭐 하지"에 집중하고,
// 깊은 분석은 좋아하는 사람만 여기서. 진입점: 홈 "내 기록" 카드 + (추후) 프로필.

import { useRouter } from 'next/navigation';
import { ChevronLeft, BarChart3 } from 'lucide-react';
import StatsCharts from '@/components/stats/StatsCharts';
import { useI18n } from '@/lib/i18n';

export default function StatsPage() {
  const router = useRouter();
  const { tt } = useI18n();

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="px-4 py-3 flex items-center gap-2">
          <button onClick={() => router.back()} aria-label={tt('뒤로')} className="active:scale-90 transition -ml-1">
            <ChevronLeft size={24} className="text-[var(--foreground)]" />
          </button>
          <BarChart3 size={20} className="text-emerald-600" />
          <h1 className="text-xl font-extrabold tracking-tight">{tt('내 기록 통계')}</h1>
        </div>
      </header>

      <div className="p-4">
        <StatsCharts />
      </div>
    </div>
  );
}
