'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Heart } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { fetchRoutesForUser } from '@/lib/map-data';
import { fetchDailyQuote, toggleQuoteLike, isFallbackQuote, type DailyQuote } from '@/lib/quotes-data';
import { loadGoogleMaps, API_KEY } from '@/lib/google-maps';
import Link from 'next/link';
import type { Activity, Profile } from '@/types';
import PullToRefresh from '@/components/PullToRefresh';
import { syncRouteData, isNativeApp } from '@/lib/health-sync';

// 마지막 자동 GPS 경로 sync 시간 — localStorage 에 저장 (5분 throttle)
const ROUTE_SYNC_KEY = 'routinist_last_route_sync';
const ROUTE_SYNC_THROTTLE_MS = 5 * 60 * 1000;

type FilterMode = '1d' | '3d' | '7d' | '30d' | 'all';

// 명언은 src/lib/running-quotes.ts 로 통합 (지도 + 공유 카드 등 여러 곳에서 같은 소스 사용)

const FILTERS: { id: FilterMode; label: string }[] = [
  { id: '1d', label: '1일' },
  { id: '3d', label: '3일' },
  { id: '7d', label: '7일' },
  { id: '30d', label: '30일' },
  { id: 'all', label: '전체' },
];

// 좌표를 그리드 키로 변환 (~11m 단위 버킷)
function coordKey(lat: number, lng: number, precision: number = 4): string {
  return `${lat.toFixed(precision)},${lng.toFixed(precision)}`;
}

interface Segment {
  count: number;
  p1: { lat: number; lng: number };
  p2: { lat: number; lng: number };
}

// 활동들의 경로를 세그먼트 단위로 분해 + 누적 횟수 집계
// 동일 GPS 그리드(≈11m²)를 반복 통과하면 count 증가 → 크레파스 덧칠 효과
function buildSegmentMap(activities: Activity[]): Map<string, Segment> {
  const segments = new Map<string, Segment>();

  activities.forEach(activity => {
    if (!activity.route_data?.coordinates?.length) return;
    const coords = activity.route_data.coordinates;

    for (let i = 0; i < coords.length - 1; i++) {
      const [lng1, lat1] = coords[i];
      const [lng2, lat2] = coords[i + 1];
      const k1 = coordKey(lat1, lng1);
      const k2 = coordKey(lat2, lng2);
      if (k1 === k2) continue; // 같은 버킷 내 미세 이동 스킵
      const key = k1 < k2 ? `${k1}-${k2}` : `${k2}-${k1}`;

      const existing = segments.get(key);
      if (existing) {
        existing.count++;
      } else {
        segments.set(key, {
          count: 1,
          p1: { lat: lat1, lng: lng1 },
          p2: { lat: lat2, lng: lng2 },
        });
      }
    }
  });

  return segments;
}

// 지도 크레파스 팔레트 — 사용자 요청 (2026-05-06): 노랑→연두→초록→파랑→빨강→검정 그라데이션.
// 적은 횟수 = 밝고 눈에 띔, 많이 달린 곳 = 진한 색. 시각적 hierarchy 가 명확.
function chipStyle(visits: number, _mode: FilterMode = '7d'): { color: string; weight: number; opacity: number } {
  if (visits <= 1)  return { color: '#FBBF24', weight: 4.5, opacity: 1.0 };  // 노랑
  if (visits <= 3)  return { color: '#84CC16', weight: 5.0, opacity: 1.0 };  // 연두
  if (visits <= 7)  return { color: '#10B981', weight: 5.5, opacity: 1.0 };  // 초록
  if (visits <= 15) return { color: '#3B82F6', weight: 6.0, opacity: 1.0 };  // 파랑
  if (visits <= 30) return { color: '#EF4444', weight: 6.5, opacity: 1.0 };  // 빨강
  return              { color: '#1F2937', weight: 7.0, opacity: 1.0 };       // 검정
}

const CHIP_LEGEND = [
  { label: '1', color: '#FBBF24' },
  { label: '~3', color: '#84CC16' },
  { label: '~7', color: '#10B981' },
  { label: '~15', color: '#3B82F6' },
  { label: '~30', color: '#EF4444' },
  { label: '30+', color: '#1F2937' },
];

const CHIP_LEGEND_ALL = CHIP_LEGEND;

// 좌표 → 국가/지역 라벨 (다국가 클러스터 칩 표시용). 정밀도 낮지만 시작점.
function labelByCoords(lat: number, lng: number): string {
  if (lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132) return '🇰🇷 한국';
  if (lat >= 30 && lat <= 46 && lng >= 129 && lng <= 146) return '🇯🇵 일본';
  if (lat >= 18 && lat <= 54 && lng >= 73 && lng <= 135) return '🇨🇳 중국';
  if (lat >= 24 && lat <= 50 && lng >= -125 && lng <= -66) return '🇺🇸 미국';
  if (lat >= 35 && lat <= 71 && lng >= -10 && lng <= 40) return '🇪🇺 유럽';
  if (lat >= -10 && lat <= 25 && lng >= 95 && lng <= 125) return '🌏 동남아';
  if (lat >= -45 && lat <= -10 && lng >= 110 && lng <= 155) return '🇦🇺 호주';
  return '🌍 그 외';
}

interface RouteCluster {
  id: string;
  label: string;
  centerLat: number;
  centerLng: number;
  activities: Activity[];
}

// 활동들을 좌표 거리 기준으로 클러스터링. 한국+중국처럼 멀리 떨어진 두 지역을 별도 그룹으로.
function clusterActivities(activities: Activity[], thresholdDeg: number = 5): RouteCluster[] {
  const clusters: RouteCluster[] = [];
  for (const a of activities) {
    const coords = a.route_data?.coordinates;
    if (!coords?.length) continue;
    const [lng, lat] = coords[0];
    let added = false;
    for (const c of clusters) {
      if (Math.abs(c.centerLat - lat) < thresholdDeg && Math.abs(c.centerLng - lng) < thresholdDeg) {
        c.activities.push(a);
        const n = c.activities.length;
        c.centerLat = c.centerLat + (lat - c.centerLat) / n;
        c.centerLng = c.centerLng + (lng - c.centerLng) / n;
        added = true;
        break;
      }
    }
    if (!added) {
      clusters.push({
        id: `c${clusters.length}`,
        label: labelByCoords(lat, lng),
        centerLat: lat,
        centerLng: lng,
        activities: [a],
      });
    }
  }
  // 같은 라벨 클러스터들 합치기 (예: 한국 안에 두 도시 떨어져있으면 한 그룹으로)
  const merged = new Map<string, RouteCluster>();
  for (const c of clusters) {
    if (merged.has(c.label)) {
      const m = merged.get(c.label)!;
      m.activities.push(...c.activities);
    } else {
      merged.set(c.label, c);
    }
  }
  return [...merged.values()].sort((a, b) => b.activities.length - a.activities.length);
}

// 시·도 단위 대표 좌표 (지도 폴백용). geolocation 거부됐을 때 profile.region_si 로 매핑.
const REGION_COORDS: Record<string, { lat: number; lng: number; zoom: number }> = {
  '서울특별시': { lat: 37.5665, lng: 126.9780, zoom: 12 },
  '부산광역시': { lat: 35.1796, lng: 129.0756, zoom: 12 },
  '인천광역시': { lat: 37.4563, lng: 126.7052, zoom: 12 },
  '대구광역시': { lat: 35.8714, lng: 128.6014, zoom: 12 },
  '광주광역시': { lat: 35.1595, lng: 126.8526, zoom: 12 },
  '대전광역시': { lat: 36.3504, lng: 127.3845, zoom: 12 },
  '울산광역시': { lat: 35.5384, lng: 129.3114, zoom: 12 },
  '세종특별자치시': { lat: 36.4800, lng: 127.2890, zoom: 13 },
  '경기도': { lat: 37.4138, lng: 127.5183, zoom: 10 },
  '강원특별자치도': { lat: 37.8228, lng: 128.1555, zoom: 9 },
  '강원도': { lat: 37.8228, lng: 128.1555, zoom: 9 },
  '충청북도': { lat: 36.6357, lng: 127.4912, zoom: 10 },
  '충청남도': { lat: 36.5184, lng: 126.8000, zoom: 10 },
  '전라북도': { lat: 35.7175, lng: 127.1530, zoom: 10 },
  '전북특별자치도': { lat: 35.7175, lng: 127.1530, zoom: 10 },
  '전라남도': { lat: 34.8679, lng: 126.9910, zoom: 10 },
  '경상북도': { lat: 36.2486, lng: 128.6647, zoom: 9 },
  '경상남도': { lat: 35.4606, lng: 128.2132, zoom: 10 },
  '제주특별자치도': { lat: 33.4996, lng: 126.5312, zoom: 11 },
  '제주도': { lat: 33.4996, lng: 126.5312, zoom: 11 },
};

// GPS 데이터 0건일 때 지도 폴백.
// 사용자 의도(2026-05-06): "내 현재 위치 말고 달린 지역을 보여줘".
// 1순위: 사용자 등록 region (시·도) — 한국 전국 19개 매핑
// 2순위: geolocation (region 미설정 사용자만)
// 3순위: 서울 중심 (기존)
function navigateToFallback(map: google.maps.Map, profile: Profile | null) {
  const region = profile?.region_si ? REGION_COORDS[profile.region_si] : null;
  if (region) {
    map.setCenter({ lat: region.lat, lng: region.lng });
    map.setZoom(region.zoom);
    return;
  }

  // region 미설정 → geolocation 폴백
  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        map.setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        map.setZoom(14);
      },
      () => {}, // 실패하면 서울 중심 유지
      { timeout: 5000, maximumAge: 5 * 60 * 1000 }
    );
  }
  // geolocation 도 거부되면 서울 중심 유지 (지도 init 시 기본값)
}

export default function MapPage() {
  const { user, profile } = useAuth();
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  const [allActivities, setAllActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>('7d');
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  // 다국가 클러스터 — null = 전체 보기 (모든 cluster fitBounds), id = 해당 cluster zoom in
  const [activeCluster, setActiveCluster] = useState<string | null>(null);
  // GPS 경로 자동 sync 진행 상태
  const [routeSyncing, setRouteSyncing] = useState(false);
  const [routeSyncMsg, setRouteSyncMsg] = useState<string | null>(null);

  const clusters = useMemo(() => clusterActivities(allActivities), [allActivities]);

  // 지도 초기화
  useEffect(() => {
    if (!API_KEY) return;
    loadGoogleMaps().then(() => {
      if (!mapRef.current || googleMapRef.current) return;
      googleMapRef.current = new google.maps.Map(mapRef.current, {
        center: { lat: 37.5665, lng: 126.978 },
        zoom: 12,
        disableDefaultUI: true,
        gestureHandling: 'greedy',
        styles: [
          { featureType: 'poi', stylers: [{ visibility: 'off' }] },
          { featureType: 'transit', stylers: [{ visibility: 'off' }] },
        ],
      });
      setMapLoaded(true);
    }).catch(() => {});
  }, []);

  // 경로 데이터 로드 — 필터 모드에 따라 서버에서 범위 제한 (이전엔 전체 200건만 받아서 옛날 경로 잘림)
  // 10s race 가드 — 토큰 stale 시 hang 방지.
  const loadRoutes = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const daysBack = filterMode === 'all' ? undefined : parseInt(filterMode);
      const data = await Promise.race([
        fetchRoutesForUser(user.id, { daysBack }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('routes fetch 10s timeout')), 10000)
        ),
      ]);
      setAllActivities(data);
    } catch (e) {
      console.warn('[map] loadRoutes 실패:', e);
      setAllActivities([]);
    } finally {
      setLoading(false);
    }
  }, [user, filterMode]);

  useEffect(() => { loadRoutes(); }, [loadRoutes]);

  // 회귀 fix (2026-05-07): syncRouteData 가 dashboard sync 백그라운드에서만 돌고 있어
  // 결과가 invisible. Map 진입 시 명시적으로 트리거 + 진행 상태 표시 + 끝나면 자동 reload.
  // 5분 throttle 로 과도 호출 방지.
  useEffect(() => {
    if (!user || !isNativeApp()) return;

    let cancelled = false;
    (async () => {
      try {
        const last = Number(localStorage.getItem(ROUTE_SYNC_KEY) || 0);
        if (Date.now() - last < ROUTE_SYNC_THROTTLE_MS) return;

        setRouteSyncing(true);
        setRouteSyncMsg('GPS 경로 가져오는 중...');

        const r = await Promise.race([
          syncRouteData(user.id, 90),
          new Promise<{ fetched: 0; matched: 0; updated: 0; reason: string }>((resolve) =>
            setTimeout(() => resolve({ fetched: 0, matched: 0, updated: 0, reason: '60s timeout' }), 60000)
          ),
        ]);

        if (cancelled) return;
        localStorage.setItem(ROUTE_SYNC_KEY, String(Date.now()));

        if (r.updated > 0) {
          setRouteSyncMsg(`GPS 경로 ${r.updated}건 추가됨`);
          await loadRoutes();
        } else if (r.fetched === 0) {
          setRouteSyncMsg(r.reason === 'no_routes_from_plugin'
            ? 'Apple Watch 러닝이 없어요'
            : `GPS 경로 0건 (${r.reason ?? '알 수 없음'})`);
        } else {
          setRouteSyncMsg(`경로 ${r.fetched}건 확인 (이미 매칭됨)`);
        }
        setTimeout(() => setRouteSyncMsg(null), 4000);
      } catch (e) {
        if (cancelled) return;
        setRouteSyncMsg(`동기화 실패: ${e instanceof Error ? e.message : '알 수 없음'}`);
        setTimeout(() => setRouteSyncMsg(null), 4000);
      } finally {
        if (!cancelled) setRouteSyncing(false);
      }
    })();

    return () => { cancelled = true; };
  }, [user, loadRoutes]);

  // 서버에서 이미 필터링된 데이터. JS 측 추가 필터 불필요.
  const filteredActivities = useCallback(() => allActivities, [allActivities]);

  // 크레파스 히트맵 렌더링
  useEffect(() => {
    if (!mapLoaded || !googleMapRef.current) return;

    // 기존 폴리라인 제거
    polylinesRef.current.forEach(p => p.setMap(null));
    polylinesRef.current = [];

    const filtered = filteredActivities();
    const bounds = new google.maps.LatLngBounds();
    let hasPoints = false;

    if (filterMode === '1d') {
      // 1일 모드: 단일 경로들 — 클릭 가능, 연한 민트색으로 가늘게
      filtered.forEach(activity => {
        if (!activity.route_data?.coordinates?.length) return;
        const path = activity.route_data.coordinates.map(([lng, lat]) => {
          const point = { lat, lng };
          bounds.extend(point);
          hasPoints = true;
          return point;
        });

        const style = chipStyle(1, filterMode);
        const polyline = new google.maps.Polyline({
          path,
          geodesic: true,
          strokeColor: style.color,
          strokeOpacity: style.opacity,
          strokeWeight: style.weight,
          map: googleMapRef.current,
        });
        polyline.addListener('click', () => setSelectedActivity(activity));
        polylinesRef.current.push(polyline);
      });
    } else {
      // 3일/7일/30일/전체: 크레파스 덧칠 방식 (세그먼트 단위)
      // 같은 GPS 그리드(≈11m)를 반복 통과할수록 진해지고 굵어짐
      const segments = buildSegmentMap(filtered);

      // 방문 횟수가 적은 것부터 그려서 많이 달린 세그먼트가 위로 올라옴
      const sorted = [...segments.values()].sort((a, b) => a.count - b.count);

      sorted.forEach(seg => {
        bounds.extend(seg.p1); bounds.extend(seg.p2);
        hasPoints = true;
        const style = chipStyle(seg.count, filterMode);
        const polyline = new google.maps.Polyline({
          path: [seg.p1, seg.p2],
          geodesic: true,
          strokeColor: style.color,
          strokeOpacity: style.opacity,
          strokeWeight: style.weight,
          map: googleMapRef.current,
          clickable: false,
        });
        polylinesRef.current.push(polyline);
      });
    }

    if (hasPoints) {
      // 클러스터 선택됐으면 그 그룹 기준으로 zoom, 아니면 전체 bounds
      if (activeCluster && clusters.length > 1) {
        const cluster = clusters.find(c => c.id === activeCluster || c.label === activeCluster);
        if (cluster) {
          const clusterBounds = new google.maps.LatLngBounds();
          for (const a of cluster.activities) {
            for (const [lng, lat] of (a.route_data?.coordinates ?? [])) {
              clusterBounds.extend({ lat, lng });
            }
          }
          googleMapRef.current.fitBounds(clusterBounds, 40);
        } else {
          googleMapRef.current.fitBounds(bounds, 40);
        }
      } else {
        googleMapRef.current.fitBounds(bounds, 40);
      }
    } else {
      // 데이터 없을 때 폴백: (1) profile.region_si → (2) geolocation → (3) 서울 중심
      navigateToFallback(googleMapRef.current, profile);
    }
  }, [mapLoaded, allActivities, filterMode, filteredActivities, profile, activeCluster, clusters]);

  const filtered = filteredActivities();
  const totalKm = filtered.reduce((sum, a) => sum + Number(a.distance_km), 0);
  const routeCount = filtered.filter(a => a.route_data).length;

  // 일별 명언 — DB daily_quote RPC. 좋아요 누르면 카운트 + 하트 색 변경.
  const [quote, setQuote] = useState<DailyQuote | null>(null);
  const [likeBusy, setLikeBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchDailyQuote().then(q => { if (!cancelled) setQuote(q); });
    return () => { cancelled = true; };
  }, []);

  const handleToggleQuoteLike = useCallback(async () => {
    if (!quote || likeBusy || isFallbackQuote(quote)) return;
    setLikeBusy(true);
    const prev = quote;
    setQuote({
      ...quote,
      liked_by_me: !quote.liked_by_me,
      like_count: quote.like_count + (quote.liked_by_me ? -1 : 1),
    });
    try {
      const res = await toggleQuoteLike(quote.id);
      setQuote(q => (q ? { ...q, liked_by_me: res.liked, like_count: res.like_count } : q));
    } catch (err) {
      console.warn('명언 좋아요 실패:', err);
      setQuote(prev);
    } finally {
      setLikeBusy(false);
    }
  }, [quote, likeBusy]);

  return (
    <PullToRefresh onRefresh={loadRoutes}>
    <div className="max-w-lg mx-auto px-4 py-4 space-y-4 pb-8">

      {/* 오늘의 명언 — DB daily_quote, 좋아요 가능 */}
      {quote && (
        <div className="card p-3 bg-gradient-to-r from-blue-50 to-green-50 dark:from-blue-950/30 dark:to-green-950/30 border-0">
          <p className="text-sm text-center italic text-[var(--foreground)]">
            &ldquo;{quote.text}&rdquo;
            {quote.author && <span className="not-italic text-xs text-[var(--muted)]"> — {quote.author}</span>}
          </p>
          {!isFallbackQuote(quote) && (
            <div className="flex items-center justify-center mt-2">
              <button
                onClick={handleToggleQuoteLike}
                disabled={likeBusy}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/60 dark:bg-black/20 disabled:opacity-50"
                aria-label={quote.liked_by_me ? '좋아요 취소' : '명언 좋아요'}
              >
                <Heart
                  size={14}
                  className={quote.liked_by_me ? 'text-red-500' : 'text-[var(--muted)]'}
                  fill={quote.liked_by_me ? '#ef4444' : 'transparent'}
                />
                <span className={`text-xs ${quote.liked_by_me ? 'text-red-500 font-semibold' : 'text-[var(--muted)]'}`}>
                  {quote.like_count}
                </span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* GPS 경로 자동 sync 인디케이터 — Map 진입 시 5분 throttle 로 1회 자동 실행. */}
      {(routeSyncing || routeSyncMsg) && (
        <div className="card p-2.5 flex items-center gap-2 bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
          {routeSyncing && (
            <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full flex-shrink-0" />
          )}
          <p className="text-xs text-blue-700 dark:text-blue-300 flex-1">{routeSyncMsg}</p>
        </div>
      )}

      {/* 기간 필터 + 잔디 칩 범례 (스크롤 없이 바로 보임) */}
      <div className="space-y-2">
        <div className="flex gap-1.5">
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => { setFilterMode(f.id); setSelectedActivity(null); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                filterMode === f.id ? 'bg-[var(--accent)] text-white' : 'bg-[var(--card)] text-[var(--muted)]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* 다국가 클러스터 칩 — 두 곳 이상에서 달렸을 때만 표시 */}
        {clusters.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
            <button
              onClick={() => setActiveCluster(null)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                activeCluster === null ? 'bg-emerald-500 text-white' : 'bg-[var(--card)] text-[var(--muted)] border border-[var(--card-border)]'
              }`}
            >
              🌍 전체
            </button>
            {clusters.map(c => (
              <button
                key={c.id}
                onClick={() => setActiveCluster(c.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                  activeCluster === c.id ? 'bg-emerald-500 text-white' : 'bg-[var(--card)] text-[var(--muted)] border border-[var(--card-border)]'
                }`}
              >
                {c.label} {c.activities.length}회
              </button>
            ))}
          </div>
        )}
        {filterMode !== '1d' && (
          <div className="card px-3 py-2">
            <div className="flex items-center justify-center gap-1 text-xs text-[var(--muted)]">
              <span className="mr-1">덧칠 횟수</span>
              {(filterMode === 'all' ? CHIP_LEGEND_ALL : CHIP_LEGEND).map(c => (
                <div key={c.label} className="flex items-center gap-0.5">
                  <span className="w-3.5 h-3.5 rounded-sm" style={{ background: c.color }} />
                  <span className="text-[10px]">{c.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 통계 요약 (작게) */}
      <div className="card p-3">
        <div className="grid grid-cols-2 text-center">
          <div>
            <p className="text-xl font-extrabold text-[var(--foreground)]">{totalKm.toFixed(1)} km</p>
            <p className="text-xs text-[var(--muted)]">총 거리</p>
          </div>
          <div>
            <p className="text-xl font-extrabold text-[var(--foreground)]">{routeCount}</p>
            <p className="text-xs text-[var(--muted)]">GPS 기록</p>
          </div>
        </div>
      </div>

      {/* 지도 */}
      <div className="rounded-2xl overflow-hidden" style={{ height: '450px' }}>
        {API_KEY ? (
          <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
        ) : (
          <div className="h-full bg-[var(--card)] flex items-center justify-center border border-[var(--card-border)] rounded-2xl">
            <p className="text-xs text-[var(--muted)]">Google Maps API 키를 설정하면 지도가 표시됩니다</p>
          </div>
        )}
      </div>

      {loading && (
        <div className="flex justify-center py-4">
          <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
        </div>
      )}

      {selectedActivity && (
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-base font-bold text-[var(--foreground)]">{selectedActivity.distance_km.toFixed(2)} km</p>
              <p className="text-xs text-[var(--muted)]">
                {new Date(selectedActivity.activity_date).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
            <Link href={`/activity?id=${selectedActivity.id}`} className="text-sm text-[var(--accent)] font-semibold">상세 보기</Link>
          </div>
        </div>
      )}

      {!loading && routeCount === 0 && (
        <div className="card p-6 text-center space-y-4">
          <p className="text-4xl">🗺️</p>
          <p className="text-base font-semibold text-[var(--foreground)]">아직 GPS 러닝 기록이 없습니다</p>
          <p className="text-xs text-[var(--muted)]">
            Apple Health만 연동하면 거리·시간은 보이지만 GPS 경로는 포함되지 않아요.<br />
            아래 앱에서 달리면 자동으로 이 지도에 경로가 쌓입니다.
          </p>

          <div className="space-y-2 pt-2">
            <Link
              href="/connect"
              className="block w-full py-3 rounded-xl bg-red-500 text-white font-semibold text-sm"
            >
              ❤️ Apple Health 연동하기
            </Link>
            <div className="grid grid-cols-2 gap-2">
              <a
                href="https://apps.apple.com/kr/app/nike-run-club/id387771637"
                target="_blank"
                rel="noopener noreferrer"
                className="py-2.5 rounded-xl border border-[var(--card-border)] text-[var(--foreground)] font-semibold text-xs flex items-center justify-center gap-1.5"
              >
                👟 Nike Run Club
              </a>
              <a
                href="https://apps.apple.com/kr/app/%EB%9F%B0%EB%8D%B0%EC%9D%B4-%EC%B4%88%EB%B3%B4-%EB%8B%AC%EB%A6%AC%EA%B8%B0-%EC%95%B1/id1061944231"
                target="_blank"
                rel="noopener noreferrer"
                className="py-2.5 rounded-xl border border-[var(--card-border)] text-[var(--foreground)] font-semibold text-xs flex items-center justify-center gap-1.5"
              >
                🏃 런데이
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
    </PullToRefresh>
  );
}
