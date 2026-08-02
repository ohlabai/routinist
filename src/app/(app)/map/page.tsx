'use client';

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { fetchRoutesForUser } from '@/lib/map-data';
import { loadGoogleMaps, API_KEY } from '@/lib/google-maps';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { Activity, Profile } from '@/types';
import PullToRefresh from '@/components/PullToRefresh';
import AppLogo from '@/components/AppLogo';
import { syncRouteData, isNativeApp } from '@/lib/health-sync';
import { detectRegionLabel } from '@/lib/region-from-gps';
import { useI18n } from '@/lib/i18n';

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
const CELL_PRECISION = 4;
const CELL_DEG = 1e-4; // 10^-CELL_PRECISION
function coordKey(lat: number, lng: number, precision: number = CELL_PRECISION): string {
  return `${lat.toFixed(precision)},${lng.toFixed(precision)}`;
}

// 셀 단위 빈도 집계 (2026-07-19 지도 리뷰): 이전의 "버킷 쌍(세그먼트) 키" 방식은
// GPS 샘플 간격이 러닝마다 다르면 같은 길도 다른 키로 흩어져 count 가 분산됐음.
// 경로를 셀 크기의 절반 간격으로 걸어가며 (라인 래스터라이즈) "지나간 셀"을 수집하고,
// 러닝(activity) 단위로 +1 — 샘플 간격/격자 지터와 무관하게 같은 길 = 같은 셀.
// 한 러닝 안에서 같은 셀을 여러 번 지나도 1회 (루프 코스 이중 카운트 방지).
function buildCellCounts(activities: Activity[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const activity of activities) {
    const coords = activity.route_data?.coordinates;
    if (!coords?.length) continue;
    const cells = new Set<string>();
    for (let i = 0; i < coords.length - 1; i++) {
      const [lng1, lat1] = coords[i];
      const [lng2, lat2] = coords[i + 1];
      const span = Math.max(Math.abs(lat2 - lat1), Math.abs(lng2 - lng1));
      // sanitize 가 점프를 제거하지만 방어적 cap — 비정상 세그먼트가 만 단위 스텝을 만들지 않게.
      const steps = Math.min(200, Math.max(1, Math.ceil(span / (CELL_DEG / 2))));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        cells.add(coordKey(lat1 + (lat2 - lat1) * t, lng1 + (lng2 - lng1) * t));
      }
    }
    cells.forEach(k => counts.set(k, (counts.get(k) ?? 0) + 1));
  }
  return counts;
}

// 색 버킷 인덱스 — chipStyle 임계값과 동일. 병합 판정용.
function bucketFor(visits: number): number {
  if (visits <= 1) return 0;
  if (visits <= 3) return 1;
  if (visits <= 7) return 2;
  if (visits <= 15) return 3;
  if (visits <= 30) return 4;
  return 5;
}

// 렌더용 병합 run (2026-07-19 지도 리뷰 성능): 세그먼트당 Polyline 1개(수만 개 → 프리즈)
// 대신, 활동별 경로를 따라가며 색 버킷(세그먼트 중점 셀의 count)이 같은 연속 구간을
// 하나의 Polyline 으로 병합. 객체 수 = 색 전환 횟수 수준으로 감소.
function buildMergedRuns(activities: Activity[]): Array<{ count: number; path: google.maps.LatLngLiteral[] }> {
  const cellCounts = buildCellCounts(activities);
  const runs: Array<{ count: number; path: google.maps.LatLngLiteral[] }> = [];
  for (const activity of activities) {
    const coords = activity.route_data?.coordinates;
    if (!coords || coords.length < 2) continue;
    let cur: { count: number; path: google.maps.LatLngLiteral[] } | null = null;
    for (let i = 0; i < coords.length - 1; i++) {
      const [lng1, lat1] = coords[i];
      const [lng2, lat2] = coords[i + 1];
      const count = cellCounts.get(coordKey((lat1 + lat2) / 2, (lng1 + lng2) / 2)) ?? 1;
      if (cur && bucketFor(cur.count) === bucketFor(count)) {
        cur.path.push({ lat: lat2, lng: lng2 });
        cur.count = Math.max(cur.count, count);
      } else {
        if (cur) runs.push(cur);
        cur = { count, path: [{ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 }] };
      }
    }
    if (cur) runs.push(cur);
  }
  // 방문 횟수가 적은 것부터 그려서 많이 달린 구간이 위로 올라옴 (z-order)
  return runs.sort((a, b) => a.count - b.count);
}

// 지도 크레파스 팔레트 — 사용자 요청 (2026-05-06): 노랑→연두→초록→파랑→빨강→검정 그라데이션.
// 적은 횟수 = 밝고 눈에 띔, 많이 달린 곳 = 진한 색. 시각적 hierarchy 가 명확.
function chipStyle(visits: number): { color: string; weight: number; opacity: number } {
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

// 활동들을 좌표 거리 기준으로 클러스터링.
// 2026-07-19 (hans: 서울-창원 동시 표시 시 경로가 안 보임): 임계값 5°(~550km) → 0.8°(~90km).
// 이전엔 서울+창원이 "🇰🇷 한국" 한 덩어리라 도시별 줌이 불가능했음. 이제 도시 단위로
// 갈라지고, 라벨도 국가 대신 지역명 (detectRegionLabel — "서울 강남", "경남 창원").
function clusterActivities(activities: Activity[], locale: 'ko' | 'en', thresholdDeg: number = 0.8): RouteCluster[] {
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
        label: detectRegionLabel([lng, lat], null, locale) ?? labelByCoords(lat, lng),
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

// 클러스터 자동 선택 센티널 — 사용자가 아직 지역을 고르지 않은 상태 (주 활동 지역으로 줌).
const CLUSTER_AUTO = '__auto__';

// build 156: ?userId= 받으면 친구 경로 모드 (자체 sync skip, 읽기 전용)
function MapPageInner() {
  const router = useRouter();
  const { tt, locale } = useI18n();
  const { user, profile } = useAuth();
  const searchParams = useSearchParams();
  const viewUserId = searchParams.get('userId');
  // 친구 모드 여부 — viewUserId 가 본인 외 id 일 때
  const isFriendMode = !!viewUserId && viewUserId !== user?.id;
  const effectiveUserId = viewUserId || user?.id || null;
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const clusterMarkersRef = useRef<google.maps.Marker[]>([]);

  const [allActivities, setAllActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapLoaded, setMapLoaded] = useState(false);
  // 2026-07-19 (hans): 기본 30일 — 반복 코스가 진해지는 효과는 누적에서 나오는데
  // 7일 기본에선 취지가 안 보였음.
  const [filterMode, setFilterMode] = useState<FilterMode>('30d');
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  // 지역 클러스터 선택. null = 전체 보기 (모든 cluster fitBounds), id = 해당 지역 zoom in.
  // 2026-07-19 (hans): 서울-창원처럼 먼 두 지역을 한 화면에 fit 하면 경로가 픽셀 수준으로
  // 뭉개짐 — 기본값을 "주 활동 지역 자동 줌" (AUTO 센티널) 으로. 전체는 명시적 선택.
  const [clusterChoice, setClusterChoice] = useState<string | null>(CLUSTER_AUTO);
  // GPS 경로 자동 sync 진행 상태
  const [routeSyncing, setRouteSyncing] = useState(false);
  const [routeSyncMsg, setRouteSyncMsg] = useState<string | null>(null);

  const clusters = useMemo(() => clusterActivities(allActivities, locale), [allActivities, locale]);

  // 실제 적용되는 클러스터: 명시적 선택 > (자동) 활동 최다 지역 > 전체.
  // 필터 변경으로 선택했던 클러스터가 사라지면 자동으로 복귀.
  const effectiveCluster = useMemo(() => {
    if (clusterChoice === null) return null; // 사용자가 "전체" 선택
    if (clusterChoice !== CLUSTER_AUTO && clusters.some(c => c.id === clusterChoice)) return clusterChoice;
    return clusters.length > 1 ? clusters[0].id : null; // clusters 는 활동 수 내림차순 정렬
  }, [clusterChoice, clusters]);

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
  // build 156: effectiveUserId — 본인 또는 친구(?userId=)
  const loadRoutes = useCallback(async () => {
    if (!effectiveUserId) return;
    setLoading(true);
    try {
      const daysBack = filterMode === 'all' ? undefined : parseInt(filterMode);
      const data = await Promise.race([
        fetchRoutesForUser(effectiveUserId, { daysBack }),
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
  }, [effectiveUserId, filterMode]);

  useEffect(() => { loadRoutes(); }, [loadRoutes]);

  // 회귀 fix (2026-05-07): syncRouteData 가 dashboard sync 백그라운드에서만 돌고 있어
  // 결과가 invisible. Map 진입 시 명시적으로 트리거 + 진행 상태 표시 + 끝나면 자동 reload.
  // 5분 throttle 로 과도 호출 방지.
  // build 156: 친구 모드일 땐 sync skip — 본인 데이터만 sync.
  useEffect(() => {
    if (!user || !isNativeApp() || isFriendMode) return;

    let cancelled = false;
    (async () => {
      try {
        const last = Number(localStorage.getItem(ROUTE_SYNC_KEY) || 0);
        if (Date.now() - last < ROUTE_SYNC_THROTTLE_MS) return;

        setRouteSyncing(true);
        setRouteSyncMsg(tt('GPS 경로 가져오는 중...'));

        const r = await Promise.race([
          syncRouteData(user.id, 90),
          new Promise<{ fetched: 0; matched: 0; updated: 0; reason: string }>((resolve) =>
            setTimeout(() => resolve({ fetched: 0, matched: 0, updated: 0, reason: '60s timeout' }), 60000)
          ),
        ]);

        if (cancelled) return;
        localStorage.setItem(ROUTE_SYNC_KEY, String(Date.now()));

        if (r.updated > 0) {
          setRouteSyncMsg(locale === 'en' ? `Added ${r.updated} GPS route${r.updated > 1 ? 's' : ''}` : `GPS 경로 ${r.updated}건 추가됨`);
          await loadRoutes();
        } else if (r.fetched === 0) {
          setRouteSyncMsg(r.reason === 'no_routes_from_plugin'
            ? tt('Apple Watch 러닝이 없어요')
            : locale === 'en' ? `0 GPS routes (${r.reason ?? 'unknown'})` : `GPS 경로 0건 (${r.reason ?? '알 수 없음'})`);
        } else {
          setRouteSyncMsg(locale === 'en' ? `All GPS routes are in! ${r.fetched} found ✨` : `GPS 경로 다 챙겨놨어요! ${r.fetched}건 ✨`);
        }
        setTimeout(() => setRouteSyncMsg(null), 4000);
      } catch (e) {
        if (cancelled) return;
        setRouteSyncMsg(`${tt('동기화 실패')}: ${e instanceof Error ? e.message : tt('알 수 없음')}`);
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

    // 기존 폴리라인/마커 제거
    polylinesRef.current.forEach(p => p.setMap(null));
    polylinesRef.current = [];
    clusterMarkersRef.current.forEach(m => m.setMap(null));
    clusterMarkersRef.current = [];

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

        const style = chipStyle(1);
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
      // 3일/7일/30일/전체: 크레파스 덧칠 방식 — 셀 빈도 기반, 같은 색 구간 병합 렌더
      // (2026-07-19: 세그먼트당 폴리라인 1개 → 색 전환 단위 병합으로 객체 수 대폭 감소)
      const merged = buildMergedRuns(filtered);

      merged.forEach(run => {
        run.path.forEach(p => bounds.extend(p));
        hasPoints = true;
        const style = chipStyle(run.count);
        const polyline = new google.maps.Polyline({
          path: run.path,
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
      // 클러스터 선택 (자동 = 주 활동 지역 포함) 이면 그 그룹 기준으로 zoom, 아니면 전체 bounds
      if (effectiveCluster && clusters.length > 1) {
        const cluster = clusters.find(c => c.id === effectiveCluster || c.label === effectiveCluster);
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
        // 2026-07-19 (hans): 전체 보기 = 전국/대륙 축척이라 경로가 픽셀 수준 — 지역마다
        // 횟수 배지 원을 띄워 "어디서 몇 번 달렸는지" 가 보이게. 탭하면 그 지역으로 줌.
        if (clusters.length > 1) {
          clusters.forEach(c => {
            const marker = new google.maps.Marker({
              position: { lat: c.centerLat, lng: c.centerLng },
              map: googleMapRef.current,
              icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 16,
                fillColor: '#10B981',
                fillOpacity: 0.95,
                strokeColor: '#ffffff',
                strokeWeight: 2.5,
              },
              label: {
                text: String(c.activities.length),
                color: '#ffffff',
                fontSize: '12px',
                fontWeight: '800',
              },
              title: c.label,
            });
            marker.addListener('click', () => setClusterChoice(c.id));
            clusterMarkersRef.current.push(marker);
          });
        }
      }
    } else {
      // 데이터 없을 때 폴백: (1) profile.region_si → (2) geolocation → (3) 서울 중심
      navigateToFallback(googleMapRef.current, profile);
    }
  }, [mapLoaded, allActivities, filterMode, filteredActivities, profile, effectiveCluster, clusters]);

  const filtered = filteredActivities();
  const totalKm = filtered.reduce((sum, a) => sum + Number(a.distance_km), 0);
  const routeCount = filtered.filter(a => a.route_data).length;

  // 명언 영역 제거 (build 100) — 사용자 피드백.

  return (
    <PullToRefresh onRefresh={loadRoutes}>
    <div className="max-w-lg mx-auto pb-8 bg-[var(--background)] min-h-screen">
      {/* Sticky Header — 다른 탭과 동일 패턴 (build 100 통일) */}
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="px-3 py-3 flex items-center gap-2">
          <button
            onClick={() => router.back()}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition"
            aria-label={tt('뒤로')}
          >
            <ArrowLeft size={20} />
          </button>
          <AppLogo size={28} />
          <h1 className="text-xl font-extrabold tracking-tight">{tt('지도')}</h1>
        </div>
      </header>

      <div className="px-4 py-4 space-y-4">

      {/* 오늘의 명언 영역 제거 (build 100) — 사용자 피드백: 지도 위 명언 불필요. */}

      {/* GPS 경로 자동 sync 인디케이터 — Map 진입 시 5분 throttle 로 1회 자동 실행. */}
      {(routeSyncing || routeSyncMsg) && (
        <div className="card p-2.5 flex items-center gap-2 bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
          {routeSyncing && (
            <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full flex-shrink-0" />
          )}
          <p className="text-xs text-blue-700 dark:text-blue-300 flex-1">{routeSyncMsg}</p>
        </div>
      )}

      {/* 동네 러너 진입점 (build 124) */}
      <Link
        href="/map/neighborhood"
        className="block rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-3.5 shadow-md shadow-emerald-500/30 active:scale-[0.99]"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center flex-shrink-0">
            <AppLogo size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-extrabold text-white">{tt('동네 러너 코스 보기')}</p>
            <p className="text-[13px] text-white/85 mt-0.5">{tt('같은 동네 러너들의 폴리라인을 색별로')}</p>
          </div>
          <span className="text-white text-base font-bold">→</span>
        </div>
      </Link>

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
              {tt(f.label)}
            </button>
          ))}
        </div>

        {/* 다국가 클러스터 칩 — 두 곳 이상에서 달렸을 때만 표시 */}
        {clusters.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
            <button
              onClick={() => setClusterChoice(null)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                effectiveCluster === null ? 'bg-emerald-500 text-white' : 'bg-[var(--card)] text-[var(--muted)] border border-[var(--card-border)]'
              }`}
            >
              🌍 {tt('전체')}
            </button>
            {clusters.map(c => (
              <button
                key={c.id}
                onClick={() => setClusterChoice(c.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                  effectiveCluster === c.id ? 'bg-emerald-500 text-white' : 'bg-[var(--card)] text-[var(--muted)] border border-[var(--card-border)]'
                }`}
              >
                {tt(c.label)} {locale === 'en' ? `${c.activities.length}x` : `${c.activities.length}회`}
              </button>
            ))}
          </div>
        )}
        {filterMode !== '1d' && (
          <div className="card px-3 py-2">
            <div className="flex items-center justify-center gap-1 text-xs text-[var(--muted)]">
              <span className="mr-1">{tt('덧칠 횟수')}</span>
              {CHIP_LEGEND.map(c => (
                <div key={c.label} className="flex items-center gap-0.5">
                  <span className="w-3.5 h-3.5 rounded-sm" style={{ background: c.color }} />
                  <span className="text-[12px]">{c.label}</span>
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
            <p className="text-xs text-[var(--muted)]">{tt('총 거리')}</p>
          </div>
          <div>
            <p className="text-xl font-extrabold text-[var(--foreground)]">{routeCount}</p>
            <p className="text-xs text-[var(--muted)]">{tt('GPS 기록')}</p>
          </div>
        </div>
      </div>

      {/* 지도 */}
      <div className="rounded-2xl overflow-hidden" style={{ height: '450px' }}>
        {API_KEY ? (
          <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
        ) : (
          <div className="h-full bg-[var(--card)] flex items-center justify-center border border-[var(--card-border)] rounded-2xl">
            <p className="text-xs text-[var(--muted)]">{tt('Google Maps API 키를 설정하면 지도가 표시됩니다')}</p>
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
                {new Date(selectedActivity.activity_date).toLocaleDateString(locale === 'en' ? 'en-US' : 'ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
            <Link href={`/activity?id=${selectedActivity.id}`} className="text-sm text-[var(--accent)] font-semibold">{tt('상세 보기')}</Link>
          </div>
        </div>
      )}

      {!loading && routeCount === 0 && (
        <div className="card p-6 text-center space-y-4">
          <p className="text-4xl">🗺️</p>
          <p className="text-base font-semibold text-[var(--foreground)]">{tt('아직 GPS 러닝 기록이 없습니다')}</p>
          <p className="text-xs text-[var(--muted)]">
            {tt('Apple Health만 연동하면 거리·시간은 보이지만 GPS 경로는 포함되지 않아요.')}<br />
            {tt('아래 앱에서 달리면 자동으로 이 지도에 경로가 쌓입니다.')}
          </p>

          <div className="space-y-2 pt-2">
            <Link
              href="/connect"
              className="block w-full py-3 rounded-xl bg-red-500 text-white font-semibold text-sm"
            >
              ❤️ {tt('Apple Health 연동하기')}
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
                🏃 {tt('런데이')}
              </a>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
    </PullToRefresh>
  );
}

export default function MapPage() {
  return (
    <Suspense fallback={<div className="p-8 flex justify-center"><div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" /></div>}>
      <MapPageInner />
    </Suspense>
  );
}
