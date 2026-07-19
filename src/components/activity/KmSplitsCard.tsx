'use client';

// 구간별 페이스 카드 (2026-07-19, hans): 완주 요약 시트가 활동 상세 직행으로 바뀌면서
// 시트에만 있던 km splits 를 활동 상세로 이식. TrackSummarySheet.computeKmSplits 와
// 같은 알고리즘 (km 경계 timestamp 비례 보간) — 입력만 route_data 좌표.
// route_data 의 ts 슬롯은 unix "초" (build 151), 시트의 finalState 는 ms 라 자동 판별.
// ts 없는 옛 3-tuple 경로는 계산 불가 → 카드 자체를 렌더하지 않는다.

import { useMemo } from 'react';
import { haversineMeters } from '@/lib/gps-tracking';
import { useI18n } from '@/lib/i18n';
import type { GeoJSONLineString } from '@/types';

function computeKmSplitsFromRoute(
  coordinates: GeoJSONLineString['coordinates'] | undefined,
): Array<{ km: number; pace: string }> {
  if (!coordinates || coordinates.length < 2) return [];
  // 전 좌표에 ts 필요 — 하나라도 없으면 보간이 깨지므로 포기.
  if (coordinates.some(c => typeof c[3] !== 'number' || !c[3])) return [];
  const toMs = (ts: number) => (ts > 1e12 ? ts : ts * 1000);
  const splits: Array<{ km: number; pace: string }> = [];
  let cumMeters = 0;
  let kmMarker = 1;
  let kmStartTs = toMs(coordinates[0][3] as number);
  for (let i = 1; i < coordinates.length; i++) {
    const prev = coordinates[i - 1];
    const cur = coordinates[i];
    const segMeters = haversineMeters({ lat: prev[1], lng: prev[0] }, { lat: cur[1], lng: cur[0] });
    if (segMeters <= 0) continue;
    const segStart = cumMeters;
    const segEnd = cumMeters + segMeters;
    const prevMs = toMs(prev[3] as number);
    const segDtMs = toMs(cur[3] as number) - prevMs;
    while (segEnd >= kmMarker * 1000) {
      const fraction = (kmMarker * 1000 - segStart) / segMeters;
      const tsAtMarker = prevMs + segDtMs * fraction;
      const seconds = Math.max(0, (tsAtMarker - kmStartTs) / 1000);
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      splits.push({ km: kmMarker, pace: `${m}'${s.toString().padStart(2, '0')}"` });
      kmMarker++;
      kmStartTs = tsAtMarker;
    }
    cumMeters = segEnd;
  }
  return splits;
}

export default function KmSplitsCard({ routeData }: { routeData: GeoJSONLineString }) {
  const { tt } = useI18n();
  const splits = useMemo(() => computeKmSplitsFromRoute(routeData?.coordinates), [routeData]);
  if (splits.length === 0) return null;
  return (
    <div className="card p-5">
      <h3 className="text-xs font-extrabold uppercase tracking-widest text-[var(--muted)] mb-2">
        {tt('구간별 페이스')}
      </h3>
      <div className="divide-y divide-[var(--card-border)]/40">
        {splits.map(s => (
          <div key={s.km} className="py-2.5 flex items-center justify-between">
            <span className="text-sm font-bold">{s.km} km</span>
            <span className="text-sm font-extrabold tabular-nums text-emerald-600">{s.pace}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
