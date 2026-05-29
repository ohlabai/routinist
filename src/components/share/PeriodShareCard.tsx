'use client';

// 주간·월간 공유카드 (build 195) — build 209 #2/#3 재작성.
// 일간 ShareCard 와 동일 layout 사용. periodOverrides 로 지도(기간 경로 합성) + hero KM 만 교체.
// 기존 자체 canvas(period-share-canvas.ts) 폐기 — 폼/디자인 완전 통일.

import { useAuth } from '@/components/AuthProvider';
import ShareCard from '@/components/activity/ShareCard';
import type { PeriodChartData } from '@/lib/period-share-canvas';
import type { Activity } from '@/types';
import { toLocalDateStr } from '@/lib/kst';

interface Props {
  data: PeriodChartData;
  onClose: () => void;
}

export default function PeriodShareCard({ data, onClose }: Props) {
  const { user } = useAuth();
  const periodWord = data.period === 'week' ? '이번 주' : '이번 달';
  const today = toLocalDateStr(new Date());

  // 합성 Activity — 일간 ShareCard 가 이걸 활동처럼 처리.
  // distance_km/duration/pace 는 기간 누적값. activity_date 는 오늘 (월간 막대/목표바가 현재 달 기준).
  // route_data 는 첫 번째 경로 (없으면 null) — drawCard 의 extraRoutes 가 우선이라 사실상 무시됨.
  const firstRoute = data.routes?.[0];
  const syntheticActivity: Activity = {
    id: `period-${data.period}-${today}`,
    user_id: user?.id ?? '',
    activity_date: today,
    distance_km: data.totalKm,
    duration_seconds: data.totalDurationSec,
    pace_avg_sec_per_km: data.avgPaceSec,
    calories: null,
    memo: null,
    source: 'manual',
    route_data: firstRoute && firstRoute.length >= 2
      ? { type: 'LineString', coordinates: firstRoute.map(([lng, lat]) => [lng, lat]) as [number, number][] }
      : null,
    map_snapshot_url: null,
    started_at: null,
    ended_at: null,
    visibility: 'private',
    created_at: new Date().toISOString(),
  };

  return (
    <ShareCard
      activity={syntheticActivity}
      displayName={data.userName}
      onClose={onClose}
      hideRegister={true}
      periodOverrides={{
        extraRoutes: data.routes,
        periodWord,
        title: `${periodWord} 공유`,
      }}
    />
  );
}
