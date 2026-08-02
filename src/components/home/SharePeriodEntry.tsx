'use client';

// 홈 진입점: 이번 주·이번 달 공유 (build 195).
// 활동 1건 이상일 때만 표시. 탭하면 PeriodShareCard 열림 (9:16, 8초 영상).

import { useState } from 'react';
import { Share2, Calendar, CalendarDays, Loader2 } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { fetchWeekChartData, fetchMonthChartData } from '@/lib/period-share-data';
import type { PeriodChartData } from '@/lib/period-share-canvas';
import PeriodShareCard from '@/components/share/PeriodShareCard';
import type { Activity } from '@/types';
import { useI18n } from '@/lib/i18n';

interface Props { activities: Activity[]; }

export default function SharePeriodEntry({ activities }: Props) {
  const { user, profile } = useAuth();
  const { tt } = useI18n();
  const [loading, setLoading] = useState<'week' | 'month' | null>(null);
  const [shareData, setShareData] = useState<PeriodChartData | null>(null);

  if (!user || activities.length === 0) return null;

  const userName = profile?.display_name ?? user.email?.split('@')[0] ?? tt('러너');

  const open = async (period: 'week' | 'month') => {
    if (loading) return;
    setLoading(period);
    try {
      const fn = period === 'week' ? fetchWeekChartData : fetchMonthChartData;
      const { data } = await fn(user.id, userName);
      setShareData(data);
    } catch (e) {
      console.warn('[share-period-entry] fetch fail', e);
    } finally {
      setLoading(null);
    }
  };

  return (
    <>
      <div className="mx-4">
        <div className="card p-4 bg-gradient-to-br from-emerald-50/40 via-transparent to-transparent dark:from-emerald-950/15">
          <div className="flex items-center gap-2 mb-3">
            <Share2 size={16} className="text-emerald-500" />
            <h3 className="text-sm font-extrabold">{tt('공유카드')}</h3>
            <span className="text-[12px] font-bold text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40">
              NEW
            </span>
          </div>
          <p className="text-xs text-[var(--muted)] mb-3 leading-relaxed">
            {tt('한 주·한 달 기록을 8초 영상 또는 9:16 이미지로 친구에게 자랑하세요')}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => open('week')}
              disabled={loading !== null}
              className="py-3 rounded-xl bg-[var(--background)] border-2 border-emerald-500/40 text-[var(--foreground)] font-extrabold text-sm active:scale-[0.98] disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
            >
              {loading === 'week' ? <Loader2 size={14} className="animate-spin text-emerald-500" /> : <Calendar size={14} className="text-emerald-500" />}
              {tt('이번 주')}
            </button>
            <button
              onClick={() => open('month')}
              disabled={loading !== null}
              className="py-3 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-sm active:scale-[0.98] disabled:opacity-50 shadow-md shadow-emerald-500/25 inline-flex items-center justify-center gap-1.5"
            >
              {loading === 'month' ? <Loader2 size={14} className="animate-spin" /> : <CalendarDays size={14} />}
              {tt('이번 달')}
            </button>
          </div>
        </div>
      </div>

      {shareData && <PeriodShareCard data={shareData} onClose={() => setShareData(null)} />}
    </>
  );
}
