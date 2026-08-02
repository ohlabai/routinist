'use client';

// 활동 상세에 표시할 Best Splits 카드 (build 197).
// 활동 자체의 split 시간 (그 활동 내 best 구간) + 사용자 전체 PB 비교.
// new_pb query param 으로 들어오면 신규 PB 갱신 강조 + 축하 toast.

import { useEffect, useMemo, useState } from 'react';
import { Trophy, Sparkles, ChevronRight } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import {
  computeBestSplits, distanceLabel, formatSplitTime, formatPaceFromSplit,
  STANDARD_PB_DISTANCES,
} from '@/lib/best-splits';
import type { GeoJSONLineString } from '@/types';

interface Props {
  userId: string;
  activityId: string;
  routeData: GeoJSONLineString | null;
  /** "new_pb" search param — 신규 PB 갱신된 거리 목록 (m). */
  newPBDistances?: number[];
}

interface PBRow {
  distance_meters: number;
  best_seconds: number;
  activity_id: string | null;
}

export default function BestSplitsCard({ userId, activityId, routeData, newPBDistances = [] }: Props) {
  const [pbRows, setPbRows] = useState<PBRow[]>([]);

  const activitySplits = useMemo(() => {
    if (!routeData?.coordinates || routeData.coordinates.length < 5) return [];
    return computeBestSplits(routeData.coordinates);
  }, [routeData]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data } = await supabase
          .from('personal_bests')
          .select('distance_meters, best_seconds, activity_id')
          .eq('user_id', userId)
          .in('distance_meters', STANDARD_PB_DISTANCES);
        if (cancelled) return;
        setPbRows((data ?? []) as PBRow[]);
      } catch { /* 무시 */ }
    })();
    return () => { cancelled = true; };
  }, [userId, activityId]);

  if (activitySplits.length === 0) return null;

  const pbByDist = new Map(pbRows.map(p => [p.distance_meters, p]));
  const newPBSet = new Set(newPBDistances);

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-3">
        <Trophy size={16} className="text-emerald-500" />
        <h3 className="text-sm font-extrabold text-[var(--foreground)]">구간별 베스트</h3>
        {newPBSet.size > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 text-[12px] font-extrabold text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40">
            <Sparkles size={10} /> NEW PB!
          </span>
        )}
      </div>

      <div className="divide-y divide-[var(--card-border)]/40">
        {activitySplits.map(sp => {
          const isPB = newPBSet.has(sp.distanceMeters);
          const myPB = pbByDist.get(sp.distanceMeters);
          const isOverallPB = myPB && myPB.activity_id === activityId;
          return (
            <div
              key={sp.distanceMeters}
              className={`py-3 flex items-center gap-3 ${isPB ? 'animate-pulse-once' : ''}`}
            >
              <div className="w-12 text-center">
                <p className={`text-sm font-extrabold ${isPB ? 'text-emerald-600' : 'text-[var(--foreground)]'}`}>
                  {distanceLabel(sp.distanceMeters)}
                </p>
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-base font-extrabold tabular-nums ${isPB ? 'text-emerald-600' : 'text-[var(--foreground)]'}`}>
                  {formatSplitTime(sp.bestSeconds)}
                </p>
                <p className="text-[13px] text-[var(--muted)] tabular-nums">
                  페이스 {formatPaceFromSplit(sp.distanceMeters, sp.bestSeconds)} · {sp.distanceMeters >= 1000 ? `${(sp.distanceMeters / 1000).toFixed(1)}km` : `${sp.distanceMeters}m`}
                </p>
              </div>
              {isPB && (
                <span className="text-[12px] font-extrabold text-white bg-gradient-to-br from-emerald-500 to-emerald-600 px-2 py-0.5 rounded-full shadow-sm">
                  새 PB
                </span>
              )}
              {!isPB && isOverallPB && (
                <Trophy size={14} className="text-amber-500" aria-label="PB" />
              )}
            </div>
          );
        })}
      </div>

      {/* 신규 PB 축하 footer */}
      {newPBSet.size > 0 && (
        <div className="mt-4 pt-3 border-t border-emerald-200/40 dark:border-emerald-900/30">
          <p className="text-xs font-extrabold text-emerald-600 inline-flex items-center gap-1.5">
            <Sparkles size={12} /> 자기 기록 {newPBSet.size}개 갱신!
            <ChevronRight size={12} />
          </p>
          <p className="text-[13px] text-[var(--muted)] mt-0.5">자랑할 만한 기록이에요. 공유카드 만들어 보내볼까요?</p>
        </div>
      )}
    </div>
  );
}
