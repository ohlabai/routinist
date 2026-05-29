'use client';

// 시즌 결산 카드 — 분기·반기·연말 (build 199 / Phase 3).
// 분기 마지막 주 + 다음 분기 첫 7일 동안 노출.
// 클릭 시 PeriodShareCard 의 데이터를 분기/반기/연말로 확장한 영상/이미지 export.

import { useState } from 'react';
import { Sparkles, Award } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { fetchMonthChartData } from '@/lib/period-share-data';
import type { PeriodChartData } from '@/lib/period-share-canvas';
import PeriodShareCard from '@/components/share/PeriodShareCard';

// 시즌 표시 조건 — 분기말 ±7일.
function getActiveSeason(today: Date): { kind: 'Q' | 'H' | 'Y'; label: string } | null {
  const m = today.getMonth() + 1;     // 1~12
  const d = today.getDate();
  // 분기말: 3/4월·6/7월·9/10월·12/1월 경계 ±7일.
  // 반기: 6/7월 경계 + 12/1월 경계.
  // 연말: 12월 25 이후 + 1월 1~7일.
  if ((m === 12 && d >= 25) || (m === 1 && d <= 7)) return { kind: 'Y', label: '한 해 결산' };
  if ((m === 6 && d >= 24) || (m === 7 && d <= 7)) return { kind: 'H', label: '상반기 결산' };
  if ((m === 3 && d >= 24) || (m === 4 && d <= 7)) return { kind: 'Q', label: '1분기 결산' };
  if ((m === 9 && d >= 24) || (m === 10 && d <= 7)) return { kind: 'Q', label: '3분기 결산' };
  return null;
}

export default function SeasonRecapCard() {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [shareData, setShareData] = useState<PeriodChartData | null>(null);

  const season = getActiveSeason(new Date());
  if (!season || !user) return null;

  const userName = profile?.display_name ?? user.email?.split('@')[0] ?? '러너';

  const handleOpen = async () => {
    if (loading) return;
    setLoading(true);
    try {
      // 일단 월간 데이터 재사용 — Phase 3 후속에서 진짜 분기/반기/연말 fetch RPC 추가 예정.
      // 지금은 PeriodShareCard 가 월간을 보여주지만 label 만 시즌으로 갈음.
      const { data } = await fetchMonthChartData(user.id, userName);
      setShareData({ ...data, periodLabel: season.label });
    } catch (e) {
      console.warn('[season-recap] fetch fail', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="mx-4">
        <button onClick={handleOpen} disabled={loading}
          className="w-full text-left rounded-2xl p-4 bg-gradient-to-br from-rose-500 via-fuchsia-500 to-violet-600 text-white shadow-lg shadow-fuchsia-500/30 active:scale-[0.99] disabled:opacity-60 transition">
          <div className="flex items-center gap-2 mb-1">
            <Award size={16} className="text-white" />
            <span className="text-[11px] font-extrabold tracking-widest uppercase text-white/85">Season Recap</span>
            <Sparkles size={12} className="text-white/85 ml-auto" />
          </div>
          <p className="text-lg font-extrabold">{season.label}</p>
          <p className="text-xs text-white/85 mt-0.5">9:16 영상 카드로 공유해보세요</p>
        </button>
      </div>
      {shareData && <PeriodShareCard data={shareData} onClose={() => setShareData(null)} />}
    </>
  );
}
