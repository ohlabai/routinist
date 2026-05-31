'use client';

// 미니멀 트래킹 화면 (build 194).
// 디자인 원칙 (안 3): 트래킹 중에는 시간 + 누적 거리 + 지도만 표시.
// 페이스(min/km), 음성 안내, km splits, Live Activity 는 의도적으로 없음.
// 완료 후 요약 sheet 에서 풍부한 데이터 (평균 페이스, splits 포함) 제공.

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Pause, Play, Check, MapPin, AlertCircle, Volume2, VolumeX } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { loadGoogleMaps, API_KEY as MAPS_KEY } from '@/lib/google-maps';
import { logClientInfo, logClientWarn } from '@/lib/error-logger';
import {
  speakMilestone, getVoiceCueIntervalMeters,
  isVoiceCueEnabled, setVoiceCueEnabled,
  setVoiceCueIntervalMeters, speakSample,
} from '@/lib/voice-cue';
import {
  type TrackingState,
  createInitialState, loadState, saveState, clearState,
  requestLocationPermission, checkLocationPermission, getCurrentLocation,
  startWatcher, type WatcherHandle,
  appendCoord, tickElapsed, formatDistanceKm,
} from '@/lib/gps-tracking';

// build 213 #7: 카운트다운 타이밍 상수 — 튜닝 쉽게.
const COUNTDOWN_TICK_MS = 800;   // 각 숫자 (3, 2, 1) 표시 시간
const GO_HOLD_MS = 500;          // GO! 표시 후 트래킹 시작까지 hold

// build 220 #1: 카운트다운 beep — Web Audio API 로 발생.
// 3/2/1 = 짧은 660Hz, GO = 길고 높은 880Hz. AudioContext 는 lazy 생성 후 재사용.
let _audioCtx: AudioContext | null = null;
function playCountdownBeep(kind: 'tick' | 'go') {
  if (typeof window === 'undefined') return;
  try {
    type WindowWithWebkit = typeof window & { webkitAudioContext?: typeof AudioContext };
    if (!_audioCtx) {
      const win = window as WindowWithWebkit;
      const AC = win.AudioContext || win.webkitAudioContext;
      if (!AC) return;
      _audioCtx = new AC();
    }
    const ctx = _audioCtx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = kind === 'go' ? 880 : 660;
    const now = ctx.currentTime;
    const dur = kind === 'go' ? 0.45 : 0.12;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  } catch { /* ignore */ }
}
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
  // build 210 #1: 시작 카운트다운 (3 → 2 → 1 → GO!) — Apple Fitness 패턴 + 차별화 효과
  const [countdown, setCountdown] = useState<number | null>(null);
  // build 219 #10: 시작 화면에 음성 cue 토글 + 간격 선택 (1km / 500m). build 214 백엔드 존재했으나 UI 미노출.
  const [voiceOn, setVoiceOn] = useState<boolean>(() => isVoiceCueEnabled());
  const [voiceInterval, setVoiceInterval] = useState<500 | 1000>(() => (getVoiceCueIntervalMeters() === 500 ? 500 : 1000));
  const toggleVoice = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    setVoiceCueEnabled(next);
    if (next) speakSample(locale);
  };
  const changeInterval = (m: 500 | 1000) => {
    setVoiceInterval(m);
    setVoiceCueIntervalMeters(m);
  };

  // build 214 #1: 스톱워치 포맷 MM:SS.CC (분:초.1/100초). 1시간 넘으면 HH:MM:SS.CC.
  // elapsedSeconds 는 float — tick 100ms 마다 누적되므로 centisecond 정밀도 보존.
  const formatStopwatch = (seconds: number): string => {
    const totalCs = Math.max(0, Math.floor(seconds * 100));  // 1/100 초 단위 정수
    const cs = totalCs % 100;
    const totalS = Math.floor(totalCs / 100);
    const ss = totalS % 60;
    const totalM = Math.floor(totalS / 60);
    const mm = totalM % 60;
    const hh = Math.floor(totalM / 60);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return hh > 0
      ? `${pad(hh)}:${pad(mm)}:${pad(ss)}.${pad(cs)}`
      : `${pad(mm)}:${pad(ss)}.${pad(cs)}`;
  };

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

  // 권한 확인 → 카운트다운 → 워처 시작.
  // build 205 #3: 권한 granted 직후 getCurrentLocation 으로 첫 좌표를 캐서 지도를 즉시 중심 이동.
  // build 210 #1: 시작 전 3-2-1 카운트다운 — Apple Fitness 영감, 사용자에게 출발 알림.
  const beginTrackingAfterCountdown = useCallback(() => {
    const fresh = createInitialState();
    setState(fresh);
    saveState(fresh);
    logClientInfo('track-start', 'begin', { startedAt: fresh.startedAt });
  }, []);
  // build 213 #1: countdown 진행 중이거나 이미 active 면 더블탭 무시 (race condition guard).
  const startingRef = useRef(false);
  const startTracking = useCallback(async () => {
    if (startingRef.current || countdown !== null || state !== null) return;
    startingRef.current = true;
    try {
      const r = await requestLocationPermission();
      setPerm(r);
      if (r !== 'granted') return;
      const here = await getCurrentLocation();
      if (here && mapRef.current) {
        mapRef.current.panTo(here);
        youMarkerRef.current?.setPosition(here);
      }
      setCountdown(3);
    } finally {
      startingRef.current = false;
    }
  }, [countdown, state]);

  // 카운트다운 tick (3 → 2 → 1 → GO!)
  // build 220 #1: 각 tick 마다 짧은 beep (3,2,1: 660Hz, GO: 880Hz 길게).
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      playCountdownBeep('go');
      const t = setTimeout(() => {
        setCountdown(null);
        beginTrackingAfterCountdown();
      }, GO_HOLD_MS);
      return () => clearTimeout(t);
    }
    playCountdownBeep('tick');
    const t = setTimeout(() => setCountdown(c => (c !== null ? c - 1 : null)), COUNTDOWN_TICK_MS);
    return () => clearTimeout(t);
  }, [countdown, beginTrackingAfterCountdown]);

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
        const prevMeters = prev.distanceMeters;
        const moved = appendCoord(next, c);
        // 지도 갱신
        if (mapRef.current && polylineRef.current && youMarkerRef.current) {
          const ll = { lat: c.lat, lng: c.lng };
          youMarkerRef.current.setPosition(ll);
          if (moved) polylineRef.current.setPath(next.coords.map(([lng, lat]) => ({ lat, lng })));
          mapRef.current.panTo(ll);
        }
        // build 214 #3: 마일스톤 (기본 1km, 옵션 0.5km) 음성 알림.
        if (moved) {
          const intervalM = getVoiceCueIntervalMeters();
          const prevBucket = Math.floor(prevMeters / intervalM);
          const nextBucket = Math.floor(next.distanceMeters / intervalM);
          if (nextBucket > prevBucket && nextBucket > 0) {
            const totalKm = (nextBucket * intervalM) / 1000;
            const avgPace = next.distanceMeters > 100
              ? Math.round(next.elapsedSeconds / (next.distanceMeters / 1000))
              : null;
            speakMilestone({
              totalKm,
              elapsedSeconds: Math.floor(next.elapsedSeconds),
              avgPaceSecPerKm: avgPace,
              locale,
            });
          }
        }
        if (moved) saveState(next);
        return next;
      });
    }).then(h => { if (mounted) watcherRef.current = h; }).catch(() => {});

    // build 214 #1: 스톱워치 1/100초 디스플레이 위해 tick 100ms.
    // setState 빈도 증가하지만 React 18 batching + 단순 산술이라 perf 영향 적음.
    // localStorage 저장은 여전히 5초마다 (5000ms / 100ms = 50 tick 마다 한 번).
    let saveCounter = 0;
    tickRef.current = setInterval(() => {
      setState(prev => {
        if (!prev || prev.status !== 'active') return prev;
        const next: TrackingState = { ...prev };
        tickElapsed(next, Date.now());
        saveCounter++;
        if (saveCounter >= 50) { saveState(next); saveCounter = 0; }
        return next;
      });
    }, 100);

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

  // build 214 #2: 모든 종료 흐름 관측 + clearState 직전 archive 키로 백업 (복구 가능)
  const archiveStateBeforeClear = (s: TrackingState, reason: string) => {
    try {
      if (typeof window === 'undefined') return;
      const archive = {
        archivedAt: Date.now(),
        reason,
        state: s,
      };
      window.localStorage.setItem('routinist:gps-archive-v1', JSON.stringify(archive));
    } catch {}
  };

  const handleFinish = () => {
    if (!state) return;
    logClientInfo('track-finish', 'click', {
      distance_m: Math.round(state.distanceMeters),
      elapsed_s: Math.floor(state.elapsedSeconds),
      coords_n: state.coords.length,
    });
    if (state.distanceMeters < 50) {
      const msg = locale === 'en'
        ? 'Distance is too short. Save anyway?'
        : '이동 거리가 너무 짧아요. 그래도 저장할까요?';
      if (!window.confirm(msg)) {
        logClientWarn('track-finish', 'short-distance-cancelled', {
          distance_m: Math.round(state.distanceMeters),
        });
        return;
      }
    } else {
      // build 222 #4: 완료 한 번 더 확인 — 손가락 미스터치로 의도치 않게 종료되는 사고 차단.
      const km = (state.distanceMeters / 1000).toFixed(2);
      const msg = locale === 'en'
        ? `Finish run? (${km} km recorded)`
        : `달리기를 완료할까요? (${km} km 기록됨)`;
      if (!window.confirm(msg)) {
        logClientWarn('track-finish', 'cancelled', {
          distance_m: Math.round(state.distanceMeters),
        });
        return;
      }
    }
    const finalState: TrackingState = { ...state, status: 'idle' };
    archiveStateBeforeClear(finalState, 'finish-handoff-to-sheet');
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
    logClientWarn('track-abort', 'user-cancel', {
      distance_m: Math.round(state.distanceMeters),
      elapsed_s: Math.floor(state.elapsedSeconds),
      coords_n: state.coords.length,
    });
    archiveStateBeforeClear(state, 'abort');
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
          <div className="ml-auto inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/40">
            <span className="relative flex w-2.5 h-2.5">
              <span className="absolute inset-0 rounded-full bg-emerald-500 opacity-75 animate-ping" />
              <span className="relative rounded-full w-2.5 h-2.5 bg-emerald-500" />
            </span>
            <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 tracking-wider leading-none">
              {locale === 'en' ? 'LIVE' : '기록 중'}
            </span>
          </div>
        )}
        {isPaused && (
          <div className="ml-auto inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/40">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            <span className="text-sm font-extrabold text-amber-600 dark:text-amber-400 tracking-wider leading-none">
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
            <p className="text-[11px] text-[var(--muted)]/80 mb-3 break-keep">
              {locale === 'en'
                ? 'GPS keeps measuring while the screen is locked. Tracking stops as soon as you finish.'
                : '잠금 화면 상태에서도 GPS 가 계속 측정돼요. 트래킹을 종료하면 즉시 중단됩니다.'}
            </p>
            {/* build 219 #10: 음성 안내 토글 + 간격 선택 (1km / 500m) */}
            <div className="mb-4 flex items-center gap-2">
              <button
                onClick={toggleVoice}
                aria-label={voiceOn ? (locale === 'en' ? 'Voice on' : '음성 켜짐') : (locale === 'en' ? 'Voice off' : '음성 꺼짐')}
                className={`inline-flex items-center gap-1.5 px-3 h-9 rounded-full text-xs font-extrabold transition active:scale-95 ${
                  voiceOn
                    ? 'bg-emerald-500 text-white'
                    : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
                }`}
              >
                {voiceOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
                {voiceOn
                  ? (locale === 'en' ? 'Voice cue' : '음성 안내')
                  : (locale === 'en' ? 'Voice off' : '음성 꺼짐')}
              </button>
              {voiceOn && (
                <div className="inline-flex items-center rounded-full bg-[var(--card)] border border-[var(--card-border)] overflow-hidden">
                  <button
                    onClick={() => changeInterval(1000)}
                    className={`h-9 px-3 text-xs font-extrabold transition ${voiceInterval === 1000 ? 'bg-emerald-500 text-white' : 'text-[var(--muted)]'}`}
                  >1km</button>
                  <button
                    onClick={() => changeInterval(500)}
                    className={`h-9 px-3 text-xs font-extrabold transition ${voiceInterval === 500 ? 'bg-emerald-500 text-white' : 'text-[var(--muted)]'}`}
                  >500m</button>
                </div>
              )}
            </div>
            <button onClick={startTracking}
              className="w-full py-4 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-lg active:scale-[0.98] shadow-md shadow-emerald-500/30 inline-flex items-center justify-center gap-2">
              <MapPin size={20} />
              {tt('달리기 시작')}
            </button>
          </div>
        ) : (
          <>
            {/* 시간 hero — 6xl. build 210 #1: 항상 HH:MM:SS (Apple Fitness 패턴). */}
            <div className="text-center mb-4">
              <p className="text-[11px] font-extrabold text-[var(--muted)] tracking-[0.25em] uppercase mb-1">
                {locale === 'en' ? 'TIME' : '시간'}
              </p>
              <p className="text-5xl font-extrabold tracking-tight text-[var(--foreground)] tabular-nums leading-none">
                {formatStopwatch(state!.elapsedSeconds)}
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

      {/* build 220 #1: 카운트다운 리디자인 — 더 귀엽고 세련되게.
          (1) 풀스크린 어두운 backdrop + 듀얼 radial glow (emerald + teal)
          (2) 숫자 뒤로 풀스 ring 두 겹 (각자 다른 페이즈로 호흡)
          (3) 숫자는 gradient text + bounce overshoot
          (4) GO! 는 letter-spacing expansion 으로 임팩트
          build 222 #5: 전체화면 backdrop → 화면 중앙 sheet (max-h 60vh) 로 축소.
          상하 1/4 정도 지도가 비쳐 위치 컨텍스트 유지. 콜아웃 효과 강조. */}
      {countdown !== null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none animate-[fadeIn_0.2s_ease-out]">
          {/* 살짝 어두운 풀스크린 dim (지도 가시성 유지) */}
          <div className="absolute inset-0 bg-black/35 backdrop-blur-[2px] pointer-events-auto" />
          {/* 중앙 sheet — 화면 절반 정도만 차지 */}
          <div className="relative pointer-events-auto bg-black/85 backdrop-blur-md rounded-[32px] px-10 py-12 shadow-2xl border border-emerald-400/30 overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_40%,rgba(16,185,129,0.45),transparent_55%),radial-gradient(circle_at_70%_60%,rgba(20,184,166,0.3),transparent_55%)]" />
            <div className="relative text-center">
              {countdown > 0 ? (
                <div className="relative flex items-center justify-center">
                  {/* 펄스 ring 2겹 — 숫자 뒤로 호흡 */}
                  <span
                    key={`r1-${countdown}`}
                    className="absolute w-48 h-48 rounded-full border-2 border-emerald-300/60 animate-[countdownRingPulse_0.85s_ease-out]"
                    aria-hidden
                  />
                  <span
                    key={`r2-${countdown}`}
                    className="absolute w-60 h-60 rounded-full border border-emerald-300/30 animate-[countdownRingPulse_0.85s_ease-out_0.15s]"
                    aria-hidden
                  />
                  {/* 숫자 컨테이너 — gradient bg + emoji 같은 동그라미 */}
                  <div
                    key={`n-${countdown}`}
                    className="relative w-40 h-40 rounded-full bg-gradient-to-br from-emerald-400 via-emerald-500 to-teal-600 shadow-[0_0_80px_rgba(16,185,129,0.55)] flex items-center justify-center animate-[countdownPulse_0.6s_cubic-bezier(0.34,1.56,0.64,1)]"
                  >
                    <span className="text-[96px] font-extrabold text-white leading-none tabular-nums drop-shadow-[0_4px_20px_rgba(0,0,0,0.4)]">
                      {countdown}
                    </span>
                  </div>
                  <p className="absolute -bottom-12 left-1/2 -translate-x-1/2 text-xs font-extrabold text-emerald-200 tracking-[0.35em] uppercase whitespace-nowrap">
                    {locale === 'en' ? 'Get Ready' : '준비'}
                  </p>
                </div>
              ) : (
                <div className="relative animate-[goBounce_0.55s_cubic-bezier(0.34,1.56,0.64,1)]">
                  {/* GO! — 그라데이션 텍스트 + sparkle */}
                  <p className="text-[112px] font-extrabold leading-none bg-gradient-to-br from-emerald-200 via-emerald-400 to-teal-500 bg-clip-text text-transparent drop-shadow-[0_0_60px_rgba(16,185,129,0.9)]">
                    GO!
                  </p>
                  <p className="mt-2 text-xs font-extrabold text-white/80 tracking-[0.4em] uppercase">
                    {locale === 'en' ? 'Start running' : '달리기 시작'}
                  </p>
                  {/* 양옆 ✨ */}
                  <span className="absolute -top-4 -left-6 text-3xl animate-pulse" aria-hidden>✨</span>
                  <span className="absolute -top-4 -right-6 text-3xl animate-pulse" aria-hidden>✨</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
