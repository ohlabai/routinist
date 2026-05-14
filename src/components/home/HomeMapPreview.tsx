'use client';

// 홈 캘린더 아래 미니맵 (build 100 — 지도 탭 흡수).
// 최근 7일 GPS 경로를 SVG polyline 으로 가볍게 표시 (지도 타일 없음).
// 카드 클릭 시 /map 으로 이동 → 풀 지도. 거기서 동네 러너 찾기 emerald CTA 로 진입.
// build 139: build 137 의 풀폭 "이 지역 동네 러너" CTA 회수. 홈은 내 코스 표시에 집중,
// 동네 친구 찾기는 /map 페이지에서 (사용자 결정: 흐름이 더 자연스러움).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { fetchRoutesForUser } from '@/lib/map-data';
import { MapPin, ChevronRight } from 'lucide-react';
import type { Activity } from '@/types';

const VIEWBOX_W = 320;
const VIEWBOX_H = 140;
const PADDING = 8;

// 최근 N 일 활동의 GPS 좌표를 모아 SVG 좌표계로 normalize.
// 좌표 묶음을 polyline 으로, 각 활동은 다른 emerald shade 로 구분.
// build 141: GPS 점이 활동당 2000~10000개 (HealthKit 원본). SVG path d 가 거대해져
// 브라우저 렌더 못 하거나 거의 안 보이는 진짜 회귀 — 활동당 max 120 점으로 down-sample.
function downsample<T>(arr: readonly T[], max: number): T[] {
  if (arr.length <= max) return [...arr];
  const step = (arr.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

function buildPaths(activities: Activity[]) {
  // 좌표 2개 이상인 활동만 사용 — 1점은 polyline 안 그려져 사용자에 "빈 지도" 인상.
  const usable = activities
    .filter(a => (a.route_data?.coordinates?.length ?? 0) >= 2)
    .map(a => ({ ...a, sampled: downsample(a.route_data!.coordinates, 120) }));
  if (usable.length === 0) return { paths: [], hasData: false };

  const all: { lng: number; lat: number }[] = [];
  usable.forEach(a => a.sampled.forEach(([lng, lat]) => all.push({ lng, lat })));

  const lngs = all.map(c => c.lng);
  const lats = all.map(c => c.lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const spanLng = maxLng - minLng || 0.001;
  const spanLat = maxLat - minLat || 0.001;
  const scaleX = (VIEWBOX_W - PADDING * 2) / spanLng;
  const scaleY = (VIEWBOX_H - PADDING * 2) / spanLat;
  const scale = Math.min(scaleX, scaleY);
  const offX = PADDING + ((VIEWBOX_W - PADDING * 2) - spanLng * scale) / 2;
  const offY = PADDING + ((VIEWBOX_H - PADDING * 2) - spanLat * scale) / 2;

  const paths = usable.map((a, idx) => {
    const points = a.sampled.map(([lng, lat]) => {
      const x = offX + (lng - minLng) * scale;
      const y = VIEWBOX_H - (offY + (lat - minLat) * scale);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return { idx, d: `M ${points.join(' L ')}` };
  });
  return { paths, hasData: true };
}

// 최근 → 옅음, 가장 최신 → 진함. emerald scale.
// build 139: opacity 0.95→0.45 → 1.0→0.65 로 강화 (사용자 회귀: 폴리라인 안 보임).
function strokeForIdx(idx: number, total: number) {
  const t = total <= 1 ? 0 : idx / (total - 1);
  const opacity = 1.0 - t * 0.35;
  return { stroke: '#10b981', opacity };
}

export default function HomeMapPreview() {
  const { user } = useAuth();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchRoutesForUser(user.id, { daysBack: 7, pageSize: 7 });
        if (!cancelled) {
          setActivities(data);
          setLoading(false);
        }
      } catch (e) {
        console.warn('[HomeMapPreview] fetch 실패', e);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (loading) {
    return (
      <div className="mx-4 card p-4 animate-pulse">
        <div className="h-3 w-24 bg-[var(--card-border)]/40 rounded mb-2" />
        <div className="h-[140px] w-full bg-[var(--card-border)]/30 rounded-xl" />
      </div>
    );
  }

  const { paths, hasData } = buildPaths(activities);

  // 데이터 없으면 안내 카드 (지도 페이지로 유도)
  if (!hasData) {
    return (
      <Link
        href="/map"
        className="mx-4 block card p-4 active:scale-[0.99] transition"
      >
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
            <MapPin size={20} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="flex-1">
            <p className="text-base font-bold text-[var(--foreground)]">나의 러닝 지도</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">GPS 경로가 모이면 지도가 그려져요</p>
          </div>
          <ChevronRight size={16} className="text-[var(--muted)]" />
        </div>
      </Link>
    );
  }

  const totalKm = activities.reduce((s, a) => s + Number(a.distance_km || 0), 0);

  return (
    <Link href="/map" className="mx-4 block card p-4 active:scale-[0.99] transition">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <MapPin size={16} className="text-emerald-600" />
          <h3 className="text-sm font-bold text-[var(--foreground)]">최근 7일 러닝 경로</h3>
        </div>
        <span className="text-xs text-emerald-600 dark:text-emerald-400 font-bold inline-flex items-center gap-0.5">
          지도 <ChevronRight size={12} />
        </span>
      </div>

      <div className="rounded-xl bg-gradient-to-br from-emerald-50/60 via-white to-emerald-50/30 dark:from-emerald-950/20 dark:via-zinc-900 dark:to-emerald-950/10 border border-emerald-200/30 dark:border-emerald-900/20 overflow-hidden">
        <svg
          viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
          className="w-full h-[140px]"
          preserveAspectRatio="xMidYMid meet"
        >
          {paths.map(({ idx, d }) => {
            const { stroke, opacity } = strokeForIdx(idx, paths.length);
            return (
              <path
                key={idx}
                d={d}
                fill="none"
                stroke={stroke}
                strokeOpacity={opacity}
                strokeWidth={3.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}
        </svg>
      </div>

      <p className="text-xs text-[var(--muted)] mt-2">
        {activities.length}회 · 총 <span className="font-bold text-[var(--foreground)]">{totalKm.toFixed(1)}km</span>
      </p>
    </Link>
  );
}
