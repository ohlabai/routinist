'use client';

// 홈 캘린더 아래 미니맵 (build 100 — 지도 탭 흡수).
// 최근 7일 GPS 경로를 SVG polyline 으로 가볍게 표시 (지도 타일 없음).
// 카드 클릭 시 /map 으로 이동 → 풀 지도.
// 첫 paint 영향 최소화: LazyMount 로 뷰포트 진입 시에만 마운트, GPS 데이터만 fetch.

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
function buildPaths(activities: Activity[]) {
  const all: { lng: number; lat: number; idx: number }[] = [];
  activities.forEach((a, idx) => {
    const coords = a.route_data?.coordinates ?? [];
    coords.forEach(([lng, lat]) => all.push({ lng, lat, idx }));
  });
  if (all.length === 0) return { paths: [], hasData: false };

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

  // 각 activity 별로 path 분리
  const byIdx = new Map<number, string[]>();
  activities.forEach((a, idx) => {
    const coords = a.route_data?.coordinates ?? [];
    if (coords.length === 0) return;
    const points = coords.map(([lng, lat]) => {
      const x = offX + (lng - minLng) * scale;
      // SVG y 는 위→아래라 lat 반전
      const y = VIEWBOX_H - (offY + (lat - minLat) * scale);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    byIdx.set(idx, points);
  });

  const paths = Array.from(byIdx.entries()).map(([idx, points]) => ({
    idx,
    d: `M ${points.join(' L ')}`,
  }));
  return { paths, hasData: true };
}

// 최근 → 옅음, 가장 최신 → 진함. emerald scale.
function strokeForIdx(idx: number, total: number) {
  // idx 0 = 가장 최신. opacity 0.95 → 0.45.
  const t = total <= 1 ? 0 : idx / (total - 1);
  const opacity = 0.95 - t * 0.5;
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
    <Link
      href="/map"
      className="mx-4 block card p-4 active:scale-[0.99] transition"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <MapPin size={16} className="text-emerald-600" />
          <h3 className="text-sm font-bold text-[var(--foreground)]">최근 7일 러닝 경로</h3>
        </div>
        <div className="flex items-center gap-2">
          <span
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.location.href = '/map/neighborhood'; }}
            className="text-[11px] text-emerald-700 dark:text-emerald-300 font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 active:scale-95 cursor-pointer"
          >
            동네 러너
          </span>
          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-bold inline-flex items-center gap-0.5">
            지도 <ChevronRight size={12} />
          </span>
        </div>
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
                strokeWidth={2.5}
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
