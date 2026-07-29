'use client';

import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps, API_KEY } from '@/lib/google-maps';
import { splitRouteByGaps } from '@/lib/route-segments';
import type { GeoJSONLineString } from '@/types';

interface RouteMapProps {
  routeData: GeoJSONLineString;
  height?: string;
}

export default function RouteMap({ routeData, height = '240px' }: RouteMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!API_KEY || !routeData?.coordinates?.length) return;
    loadGoogleMaps().then(() => setLoaded(true)).catch(() => {});
  }, [routeData]);

  useEffect(() => {
    if (!loaded || !mapRef.current || !routeData?.coordinates?.length) return;

    const path = routeData.coordinates.map(([lng, lat]) => ({ lat, lng }));
    const center = path[Math.floor(path.length / 2)];

    const map = new google.maps.Map(mapRef.current, {
      center,
      zoom: 14,
      disableDefaultUI: true,
      gestureHandling: 'greedy',
    });

    // build 327: GPS 공백 지점에서 폴리라인 분리 — 공백 전후를 직선으로 잇던
    // "하늘 나는 선" 제거 (이승우 신고). 세그먼트별 Polyline.
    const segments = splitRouteByGaps(routeData.coordinates);
    for (const seg of segments) {
      new google.maps.Polyline({
        path: seg.map(([lng, lat]) => ({ lat, lng })),
        geodesic: true,
        strokeColor: '#3B82F6',
        strokeOpacity: 1.0,
        strokeWeight: 4,
        map,
      });
    }

    const bounds = new google.maps.LatLngBounds();
    path.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, 40);
  }, [loaded, routeData]);

  if (!API_KEY) {
    return (
      <div style={{ height }} className="bg-[var(--card)] rounded-2xl flex items-center justify-center border border-[var(--card-border)]">
        <p className="text-xs text-[var(--muted)]">Google Maps API 키가 필요합니다</p>
      </div>
    );
  }

  if (!routeData?.coordinates?.length) {
    return (
      <div style={{ height }} className="bg-[var(--card)] rounded-2xl flex items-center justify-center border border-[var(--card-border)]">
        <p className="text-xs text-[var(--muted)]">경로 데이터가 없습니다</p>
      </div>
    );
  }

  return <div ref={mapRef} style={{ height }} className="rounded-2xl overflow-hidden" />;
}
