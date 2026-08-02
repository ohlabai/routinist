'use client';

// 동네 러너 지도 (build 125 — Google Maps 통합).
// 본인 + 같은 region_gu 다른 러너의 최근 N일 폴리라인을 실제 지도 위에 색별 표시.

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, MapPin, Users, ChevronRight } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { fetchRoutesForUser } from '@/lib/map-data';
import { loadGoogleMaps, API_KEY } from '@/lib/google-maps';
import type { Activity } from '@/types';
import AppLogo from '@/components/AppLogo';
import AppToast from '@/components/AppToast';
import { track } from '@/lib/analytics';

interface NeighborhoodRoute {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  activity_id: string;
  distance_km: number;
  activity_date: string;
  route_data: { coordinates?: [number, number][] } | null;
}

type DaysFilter = 3 | 7 | 30;

// 12색 팔레트 — 본인은 emerald, 타인은 색 순환
const PALETTE = ['#3b82f6', '#f97316', '#a855f7', '#ec4899', '#06b6d4', '#84cc16', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9', '#22c55e', '#eab308'];
const MY_COLOR = '#10b981';

declare global {
  interface Window {
    google: typeof google;
  }
}

export default function NeighborhoodMapPage() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [days, setDays] = useState<DaysFilter>(7);
  const [myActivities, setMyActivities] = useState<Activity[]>([]);
  const [neighborRoutes, setNeighborRoutes] = useState<NeighborhoodRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [highlightUserId, setHighlightUserId] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const polylinesRef = useRef<{ key: string; polyline: google.maps.Polyline }[]>([]);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2000);
  };

  // Google Maps 로드
  useEffect(() => {
    if (!API_KEY) { setMapError('지도 API 키가 설정되지 않았어요'); return; }
    loadGoogleMaps()
      .then(() => setMapLoaded(true))
      .catch(e => setMapError(e instanceof Error ? e.message : '지도 로드 실패'));
  }, []);

  // 데이터 fetch
  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [mine, nb] = await Promise.all([
        fetchRoutesForUser(user.id, { daysBack: days, pageSize: days }).catch(() => [] as Activity[]),
        (async () => {
          const supabase = getSupabase();
          const { data, error } = await supabase.rpc('fetch_neighborhood_routes', { p_days: days, p_limit: 20 });
          if (error) throw error;
          return (data ?? []) as NeighborhoodRoute[];
        })().catch(() => [] as NeighborhoodRoute[]),
      ]);
      setMyActivities(mine);
      setNeighborRoutes(nb);
      track('neighborhood_map_view', { days, mine_count: mine.length, neighbor_count: nb.length });
    } catch (e) {
      showToast(e instanceof Error ? e.message : '조회 실패', 'warn');
    } finally {
      setLoading(false);
    }
  }, [user, days]);

  useEffect(() => { load(); }, [load]);

  // 지도 + 폴리라인 그리기
  useEffect(() => {
    if (!mapLoaded || !mapDivRef.current) return;

    // 모든 좌표 모아서 bbox 계산
    const allLatLng: { lat: number; lng: number }[] = [];
    myActivities.forEach(a => a.route_data?.coordinates?.forEach(([lng, lat]) => allLatLng.push({ lat, lng })));
    neighborRoutes.forEach(r => r.route_data?.coordinates?.forEach(([lng, lat]) => allLatLng.push({ lat, lng })));

    if (allLatLng.length === 0) {
      // 지도는 그대로, 데이터 없음
      if (!mapRef.current) {
        // 지역 기본 center (서울)
        mapRef.current = new window.google.maps.Map(mapDivRef.current, {
          center: { lat: 37.5665, lng: 126.978 },
          zoom: 12,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'greedy',
        });
      }
      return;
    }

    const bounds = new window.google.maps.LatLngBounds();
    allLatLng.forEach(p => bounds.extend(p));

    if (!mapRef.current) {
      mapRef.current = new window.google.maps.Map(mapDivRef.current, {
        center: bounds.getCenter(),
        zoom: 12,
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: 'greedy',
      });
    }
    mapRef.current.fitBounds(bounds, 24);

    // 기존 폴리라인 제거
    polylinesRef.current.forEach(p => p.polyline.setMap(null));
    polylinesRef.current = [];

    // 이웃 폴리라인 추가
    neighborRoutes.forEach((r, i) => {
      const coords = r.route_data?.coordinates ?? [];
      if (coords.length < 2) return;
      const color = PALETTE[i % PALETTE.length];
      const path = coords.map(([lng, lat]) => ({ lat, lng }));
      const opacity = highlightUserId && highlightUserId !== r.user_id ? 0.15 : 0.85;
      const polyline = new window.google.maps.Polyline({
        path,
        map: mapRef.current!,
        strokeColor: color,
        strokeOpacity: opacity,
        strokeWeight: highlightUserId === r.user_id ? 6 : 4,
      });
      polylinesRef.current.push({ key: r.user_id, polyline });
    });

    // 본인 폴리라인 추가 (위에 그려져야 잘 보임 — 마지막에 추가)
    myActivities.forEach((a, i) => {
      const coords = a.route_data?.coordinates ?? [];
      if (coords.length < 2) return;
      const path = coords.map(([lng, lat]) => ({ lat, lng }));
      const polyline = new window.google.maps.Polyline({
        path,
        map: mapRef.current!,
        strokeColor: MY_COLOR,
        strokeOpacity: highlightUserId ? 0.4 : 1.0,
        strokeWeight: highlightUserId ? 4 : 6,
      });
      polylinesRef.current.push({ key: `me-${i}`, polyline });
    });
  }, [mapLoaded, myActivities, neighborRoutes, highlightUserId]);

  // unmount 시 polyline 정리
  useEffect(() => {
    return () => {
      polylinesRef.current.forEach(p => p.polyline.setMap(null));
      polylinesRef.current = [];
    };
  }, []);

  const noRegion = !profile?.region_gu;

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/85 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="px-3 py-3 flex items-center gap-2">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full active:bg-[var(--card-border)]/30">
            <ArrowLeft size={20} />
          </button>
          <AppLogo size={24} />
          <h1 className="text-xl font-extrabold tracking-tight">동네 러너 지도</h1>
        </div>
        <div className="px-4 pb-3 flex items-center gap-1.5">
          {([3, 7, 30] as const).map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold active:scale-95 ${
                days === d ? 'bg-emerald-500 text-white shadow' : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
              }`}
            >
              최근 {d}일
            </button>
          ))}
          <span className="ml-auto text-[13px] text-[var(--muted)] font-bold">
            {profile?.region_gu ?? '지역 미설정'}
          </span>
        </div>
      </header>

      <div className="p-4 space-y-3">
        {noRegion ? (
          <Link href="/profile/edit" className="block rounded-2xl bg-gradient-to-br from-emerald-100/80 to-emerald-50/40 dark:from-emerald-950/30 dark:to-emerald-950/10 border border-emerald-200/60 p-5 active:scale-[0.99]">
            <p className="text-base font-extrabold inline-flex items-center gap-1.5">
              <MapPin size={16} className="text-emerald-600" /> 우리 동네부터 설정해주세요
            </p>
            <p className="text-sm text-[var(--muted)] mt-1.5 leading-relaxed">
              지역을 입력하면 같은 동네 러너의 코스를 보여드려요.
            </p>
            <p className="text-xs font-bold text-emerald-600 mt-2">프로필 편집 →</p>
          </Link>
        ) : (
          <>
            {/* 안내 */}
            <div className="rounded-2xl bg-gradient-to-br from-emerald-50/60 to-emerald-50/20 dark:from-emerald-950/30 dark:to-emerald-950/10 border border-emerald-200/50 dark:border-emerald-900/40 p-3">
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                <span className="font-extrabold text-emerald-700 dark:text-emerald-300">{profile?.region_gu}</span>에서 최근 {days}일 달린 러너들의 코스. 본인은 <span className="font-extrabold" style={{ color: MY_COLOR }}>에메랄드</span>, 다른 러너는 색별로 구분돼요.
              </p>
            </div>

            {/* Google Maps — build 137 fix: mapDiv 를 항상 visible 로 두고 placeholder 를 absolute overlay 로.
                이전 코드는 placeholder 표시 중 mapDiv 가 display:none 되어 Google Maps init 이 0×0 영역에 적용 → 빈 지도 회귀. */}
            <div className="rounded-2xl overflow-hidden border-2 border-[var(--card-border)] relative" style={{ height: 320 }}>
              {mapError ? (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-[var(--muted)] gap-2 px-6 bg-[var(--card-border)]/20">
                  <MapPin size={32} className="opacity-30" />
                  <p className="text-sm font-bold text-center">지도를 불러올 수 없어요</p>
                  <p className="text-xs text-center text-rose-500">{mapError}</p>
                </div>
              ) : (loading || !mapLoaded) ? (
                <div className="absolute inset-0 z-10 animate-pulse bg-[var(--card-border)]/30 flex items-center justify-center pointer-events-none">
                  <p className="text-xs text-[var(--muted)] font-bold">지도 로딩…</p>
                </div>
              ) : null}
              <div
                ref={mapDivRef}
                style={{ height: 320, display: mapError ? 'none' : 'block' }}
              />
            </div>

            {/* 러너 list — 클릭 시 highlight */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-extrabold inline-flex items-center gap-1.5">
                  <Users size={14} className="text-emerald-500" /> 동네 러너 · {neighborRoutes.length}명
                </h3>
                {highlightUserId && (
                  <button onClick={() => setHighlightUserId(null)} className="text-[13px] font-bold text-emerald-600 active:scale-95">
                    전체 보기
                  </button>
                )}
              </div>

              {/* 본인 row */}
              {myActivities.length > 0 && (
                <div className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border-2 ${highlightUserId === null ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-300/60' : 'bg-[var(--card)] border-[var(--card-border)]/40'}`}>
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 flex-shrink-0" />
                  <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/40 overflow-hidden flex-shrink-0">
                    {profile?.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-sm font-bold text-emerald-700">{profile?.display_name?.slice(0,1) ?? '나'}</div>
                    )}
                  </div>
                  <span className="text-sm font-extrabold flex-1 truncate">나 ({profile?.display_name ?? '러너'})</span>
                  <span className="text-xs font-bold text-emerald-600 tabular-nums">
                    {myActivities.reduce((s, a) => s + Number(a.distance_km), 0).toFixed(1)}km
                  </span>
                </div>
              )}

              {loading ? (
                [0,1,2].map(i => <div key={i} className="h-12 bg-[var(--card-border)]/30 animate-pulse rounded-xl" />)
              ) : neighborRoutes.length === 0 ? (
                <p className="text-center text-xs text-[var(--muted)] italic py-4">동네에 다른 러너가 아직 없어요</p>
              ) : (
                neighborRoutes.map((r, i) => {
                  const color = PALETTE[i % PALETTE.length];
                  const active = highlightUserId === r.user_id;
                  return (
                    <button
                      key={r.user_id}
                      onClick={() => setHighlightUserId(active ? null : r.user_id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border-2 transition active:scale-[0.99] ${
                        active ? 'border-emerald-300/60 bg-emerald-50/40 dark:bg-emerald-950/20' : 'border-[var(--card-border)]/40 bg-[var(--card)]'
                      }`}
                    >
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                      <div className="w-9 h-9 rounded-full bg-[var(--card-border)]/40 overflow-hidden flex-shrink-0">
                        {r.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-sm font-bold text-[var(--muted)]">{r.display_name.slice(0,1)}</div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-sm font-bold truncate">{r.display_name}</p>
                        <p className="text-[12px] text-[var(--muted)]">{r.activity_date} · {r.distance_km.toFixed(1)}km</p>
                      </div>
                      <Link
                        href={`/social/user?id=${r.user_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[13px] font-bold text-emerald-600 px-2 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 active:scale-95 inline-flex items-center gap-0.5"
                      >
                        프로필 <ChevronRight size={10} />
                      </Link>
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2000} />}
    </div>
  );
}
