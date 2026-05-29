'use client';

// 미니멀 트래킹 화면 (build 194).
// 디자인 원칙 (안 3): 트래킹 중에는 시간 + 누적 거리 + 지도만 표시.
// 페이스(min/km), 음성 안내, km splits, Live Activity 는 의도적으로 없음.
// 완료 후 요약 sheet 에서 풍부한 데이터 (평균 페이스, splits 포함) 제공.

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Pause, Play, Check, MapPin, AlertCircle } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { loadGoogleMaps, API_KEY as MAPS_KEY } from '@/lib/google-maps';
import {
  type TrackingState,
  createInitialState, loadState, saveState, clearState,
  requestLocationPermission, checkLocationPermission, getCurrentLocation,
  startWatcher, type WatcherHandle,
  appendCoord, tickElapsed, formatDuration, formatDistanceKm,
} from '@/lib/gps-tracking';
import TrackSummarySheet from '@/components/track/TrackSummarySheet';

type PermState = 'unknown' | 'prompt' | 'granted' | 'denied';

export default function TrackPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { tt, locale } = useI18n();

  const [perm, setPerm] = useState<PermState>('unknown');
  // lazy initializer 로 진행 중인 트래킹 복원 — useEffect 안 setState 보다 cleaner.
  const [state, setState] = useState<TrackingState | null>(() => loadState());
  const [finished, setFinished] = useState<TrackingState | null>(null);

  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const youMarkerRef = useRef<google.maps.Marker | null>(null);
  const watcherRef = useRef<WatcherHandle | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 로그인 강제 (트래킹 후 저장에 user 필요)
  useEffect(() => {
    if (!authLoading && !user) router.replace('/login?redirect=/track');
  }, [user, authLoading, router]);

  // 지도 초기화 (현재 위치 중심).
  // build 205 #3: 권한이 이미 granted 라면 조용히 getCurrentLocation 으로 즉시 사용자 위치 표시.
  // 시작 전에도 "지금 내가 어디 있는지" 보여서 Strava/Nike Run Club 패턴 매칭.
  useEffect(() => {
    if (!MAPS_KEY || !mapEl.current) return;
    let cancelled = false;
    loadGoogleMaps().then(async () => {
      if (cancelled || !mapEl.current) return;
      const fallbackCenter = { lat: 37.5665, lng: 126.9780 }; // 권한 없으면 서울 기본
      const map = new google.maps.Map(mapEl.current, {
        center: fallbackCenter,
        zoom: 16,
        disableDefaultUI: true,
        gestureHandling: 'greedy',
        styles: [
          { featureType: 'poi', stylers: [{ visibility: 'off' }] },
          { featureType: 'transit', stylers: [{ visibility: 'off' }] },
        ],
      });
      mapRef.current = map;
      polylineRef.current = new google.maps.Polyline({
        path: [],
        geodesic: true,
        strokeColor: '#10b981',
        strokeOpacity: 1.0,
        strokeWeight: 5,
        map,
      });
      youMarkerRef.current = new google.maps.Marker({
        position: fallbackCenter,
        map,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#10b981',
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 3,
        },
      });
      // 복원된 state 가 있으면 polyline 도 복원
      const s = loadState();
      if (s && s.coords.length > 0) {
        const path = s.coords.map(([lng, lat]) => ({ lat, lng }));
        polylineRef.current?.setPath(path);
        const last = path[path.length - 1];
        map.setCenter(last);
        youMarkerRef.current?.setPosition(last);
        return;
      }
      // 진행 중인 트래킹 없을 때만 현재 위치로 이동 시도.
      // build 207 #7: permission state 별 분기 명확화 + 권한 prompt 시 자동 요청까지.
      //   - granted: 즉시 fetch
      //   - prompt (iOS 첫 진입): 다이얼로그 띄움 → 사용자 응답 후 granted 면 fetch
      //   - denied: 시청 fallback 유지
      let permState = await checkLocationPermission();
      if (permState === 'prompt') {
        permState = await requestLocationPermission();
      }
      if (cancelled) return;
      setPerm(permState);
      if (permState === 'granted') {
        const here = await getCurrentLocation();
        if (here && !cancelled && mapRef.current) {
          mapRef.current.panTo(here);
          youMarkerRef.current?.setPosition(here);
        }
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // 권한 확인 → 워처 시작.
  // build 205 #3: 권한 granted 직후 getCurrentLocation 으로 첫 좌표를 캐서 지도를 즉시 중심 이동.
  // 다이얼로그 후 잠시 빈 지도를 보다가 첫 watch 좌표 도착할 때 점프하는 어색함 제거.
  const startTracking = useCallback(async () => {
    const r = await requestLocationPermission();
    setPerm(r);
    if (r !== 'granted') return;
    const here = await getCurrentLocation();
    if (here && mapRef.current) {
      mapRef.current.panTo(here);
      youMarkerRef.current?.setPosition(here);
    }
    const fresh = createInitialState();
    setState(fresh);
    saveState(fresh);
  }, []);

  // state.status === 'active' 일 때 워처 + 1초 tick 실행
  useEffect(() => {
    if (!state || state.status !== 'active') {
      watcherRef.current?.clear().catch(() => {});
      watcherRef.current = null;
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      return;
    }

    let mounted = true;
    startWatcher((c) => {
      if (!mounted) return;
      setState(prev => {
        if (!prev || prev.status !== 'active') return prev;
        const next: TrackingState = { ...prev, coords: [...prev.coords] };
        const moved = appendCoord(next, c);
        // 지도 갱신
        if (mapRef.current && polylineRef.current && youMarkerRef.current) {
          const ll = { lat: c.lat, lng: c.lng };
          youMarkerRef.current.setPosition(ll);
          if (moved) polylineRef.current.setPath(next.coords.map(([lng, lat]) => ({ lat, lng })));
          mapRef.current.panTo(ll);
        }
        if (moved) saveState(next);
        return next;
      });
    }).then(h => { if (mounted) watcherRef.current = h; }).catch(() => {});

    tickRef.current = setInterval(() => {
      setState(prev => {
        if (!prev || prev.status !== 'active') return prev;
        const next: TrackingState = { ...prev };
        tickElapsed(next, Date.now());
        // 1초마다 저장 부담 → 5초마다만 저장
        if (Math.floor(next.elapsedSeconds) % 5 === 0) saveState(next);
        return next;
      });
    }, 1000);

    return () => {
      mounted = false;
      watcherRef.current?.clear().catch(() => {});
      watcherRef.current = null;
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    };
  }, [state?.status]);

  const handlePause = () => {
    setState(prev => {
      if (!prev) return prev;
      const next: TrackingState = { ...prev, status: 'paused', lastTickAt: Date.now() };
      saveState(next);
      return next;
    });
  };

  const handleResume = () => {
    setState(prev => {
      if (!prev) return prev;
      const next: TrackingState = { ...prev, status: 'active', lastTickAt: Date.now() };
      saveState(next);
      return next;
    });
  };

  const handleFinish = () => {
    if (!state) return;
    if (state.distanceMeters < 50) {
      const msg = locale === 'en'
        ? 'Distance is too short. Save anyway?'
        : '이동 거리가 너무 짧아요. 그래도 저장할까요?';
      if (!window.confirm(msg)) return;
    }
    const finalState: TrackingState = { ...state, status: 'idle' };
    setFinished(finalState);
    setState(null);
    clearState();
  };

  const handleAbort = () => {
    if (!state) return;
    const msg = locale === 'en'
      ? 'Stop tracking? Your run will not be saved.'
      : '트래킹을 종료할까요? 기록은 저장되지 않습니다.';
    if (!window.confirm(msg)) return;
    setState(null);
    clearState();
    router.back();
  };

  // 권한 거부 화면
  if (perm === 'denied') {
    return (
      <div className="max-w-lg mx-auto px-6 py-16 text-center bg-[var(--background)] min-h-screen">
        <div className="w-20 h-20 mx-auto mb-5 rounded-full bg-rose-50 dark:bg-rose-950/30 flex items-center justify-center">
          <AlertCircle size={40} className="text-rose-500" />
        </div>
        <h1 className="text-xl font-extrabold mb-2">{tt('위치 권한이 필요해요')}</h1>
        <p className="text-sm text-[var(--muted)] max-w-xs mx-auto break-keep mb-6">
          {locale === 'en' ? (
            <>To record your running route, location permission is required.<br />
            Go to Settings → Routinist → Location and pick &quot;Always&quot; or &quot;While Using App&quot;.</>
          ) : (
            <>러닝 경로를 기록하려면 위치 권한이 있어야 해요.<br />
            설정 → Routinist → 위치에서 &quot;항상&quot; 또는 &quot;앱 사용 중&quot; 으로 바꿔주세요.</>
          )}
        </p>
        <button onClick={() => router.back()}
          className="px-5 py-3 rounded-2xl bg-emerald-500 text-white text-sm font-extrabold active:scale-95">
          {tt('돌아가기')}
        </button>
      </div>
    );
  }

  // 시작 전 안내 화면 (state 가 아직 없을 때)
  const hasState = state !== null;
  const isActive = hasState && state!.status === 'active';
  const isPaused = hasState && state!.status === 'paused';

  // build 208 #2: Garmin/Nike 스타일 — 시작됨 표시 명확.
  // - 상단 헤더에 펄스 LIVE 배지 (active 일 때만)
  // - 시간 hero (5xl) + 거리 secondary (4xl)
  // - 페이스 추가 (현재까지 평균) — 가민 스타일 핵심 정보
  const paceSec = hasState && state!.distanceMeters > 50
    ? Math.round((state!.elapsedSeconds / (state!.distanceMeters / 1000)))
    : 0;
  const paceLabel = paceSec > 0
    ? `${Math.floor(paceSec / 60)}'${String(paceSec % 60).padStart(2, '0')}"`
    : '--';

  return (
    <div className="fixed inset-0 bg-[var(--background)] flex flex-col">
      {/* 상단 헤더 — 펄스 LIVE 배지 (active 일 때). build 209 #6: safe-area-inset-top 추가 (status bar 회피). */}
      <header className="flex items-center gap-2 px-3 py-3 pt-[max(env(safe-area-inset-top),12px)] bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30 z-10">
        <button onClick={hasState ? handleAbort : () => router.back()}
          aria-label={tt('뒤로')}
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-base font-extrabold tracking-tight">
          {hasState ? (isPaused ? tt('일시정지') : tt('달리는 중')) : tt('달리기 준비')}
        </h1>
        {isActive && (
          <div className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30">
            <span className="relative flex w-2 h-2">
              <span className="absolute inset-0 rounded-full bg-emerald-500 opacity-75 animate-ping" />
              <span className="relative rounded-full w-2 h-2 bg-emerald-500" />
            </span>
            <span className="text-[10px] font-extrabold text-emerald-600 dark:text-emerald-400 tracking-widest">
              {locale === 'en' ? 'LIVE' : '기록 중'}
            </span>
          </div>
        )}
        {isPaused && (
          <div className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-[10px] font-extrabold text-amber-600 dark:text-amber-400 tracking-widest">
              {locale === 'en' ? 'PAUSED' : '일시정지'}
            </span>
          </div>
        )}
      </header>

      {/* 지도 영역 */}
      <div ref={mapEl} className="flex-1 relative">
        {!MAPS_KEY && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--muted)]">
            {tt('지도를 불러올 수 없어요')}
          </div>
        )}
      </div>

      {/* 데이터 + CTA 영역 — Garmin/Nike 스타일 hero stats */}
      <div className="bg-[var(--background)] border-t border-[var(--card-border)]/30 px-5 pt-5 pb-7 shadow-[0_-8px_24px_rgba(0,0,0,0.06)]">
        {!hasState ? (
          <div className="text-center">
            <p className="text-sm text-[var(--muted)] mb-1">
              {locale === 'en' ? 'Ready? Tap to auto-record your route.' : '준비됐어요? 시작하면 자동으로 경로를 기록해요'}
            </p>
            <p className="text-[11px] text-[var(--muted)]/80 mb-5 break-keep">
              {locale === 'en'
                ? 'GPS keeps measuring while the screen is locked. Tracking stops as soon as you finish.'
                : '잠금 화면 상태에서도 GPS 가 계속 측정돼요. 트래킹을 종료하면 즉시 중단됩니다.'}
            </p>
            <button onClick={startTracking}
              className="w-full py-4 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-lg active:scale-[0.98] shadow-md shadow-emerald-500/30 inline-flex items-center justify-center gap-2">
              <MapPin size={20} />
              {tt('달리기 시작')}
            </button>
          </div>
        ) : (
          <>
            {/* 시간 hero — 5xl, 큰 초시계 명확. tabular-nums 로 흔들림 없음. */}
            <div className="text-center mb-4">
              <p className="text-[10px] font-extrabold text-[var(--muted)] tracking-[0.2em] uppercase mb-1">
                {locale === 'en' ? 'TIME' : '시간'}
              </p>
              <p className="text-6xl font-extrabold tracking-tight text-[var(--foreground)] tabular-nums leading-none">
                {formatDuration(state!.elapsedSeconds)}
              </p>
            </div>

            {/* 거리 + 페이스 — 2-col secondary */}
            <div className="grid grid-cols-2 gap-3 mb-5 pb-4 border-b border-[var(--card-border)]/40">
              <div className="text-center">
                <p className="text-[10px] font-extrabold text-[var(--muted)] tracking-widest uppercase mb-1">
                  {locale === 'en' ? 'DISTANCE' : '거리'}
                </p>
                <p className="text-3xl font-extrabold tracking-tight text-emerald-600 tabular-nums leading-none">
                  {formatDistanceKm(state!.distanceMeters)}
                  <span className="text-sm text-[var(--muted)] ml-1 font-bold">km</span>
                </p>
              </div>
              <div className="text-center">
                <p className="text-[10px] font-extrabold text-[var(--muted)] tracking-widest uppercase mb-1">
                  {locale === 'en' ? 'PACE' : '페이스'}
                </p>
                <p className="text-3xl font-extrabold tracking-tight text-[var(--foreground)] tabular-nums leading-none">
                  {paceLabel}
                  <span className="text-sm text-[var(--muted)] ml-1 font-bold">/km</span>
                </p>
              </div>
            </div>

            {/* 일시정지 / 완료 */}
            <div className="grid grid-cols-2 gap-2.5">
              {isActive ? (
                <button onClick={handlePause}
                  className="py-4 rounded-2xl bg-[var(--card)] border-2 border-[var(--card-border)] text-[var(--foreground)] font-extrabold text-base active:scale-[0.98] inline-flex items-center justify-center gap-1.5">
                  <Pause size={18} /> {tt('일시정지')}
                </button>
              ) : (
                <button onClick={handleResume}
                  className="py-4 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 text-white font-extrabold text-base active:scale-[0.98] inline-flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/30">
                  <Play size={18} /> {tt('재개')}
                </button>
              )}
              <button onClick={handleFinish}
                className="py-4 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-base active:scale-[0.98] inline-flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/30">
                <Check size={18} /> {tt('완료')}
              </button>
            </div>
          </>
        )}
      </div>

      {/* 완료 후 요약 sheet */}
      {finished && user && (
        <TrackSummarySheet
          finalState={finished}
          userId={user.id}
          onClose={() => setFinished(null)}
        />
      )}
    </div>
  );
}
