'use client';

// 미니멀 트래킹 화면 (build 194).
// 디자인 원칙 (안 3): 트래킹 중에는 시간 + 누적 거리 + 지도만 표시.
// 페이스(min/km), 음성 안내, km splits, Live Activity 는 의도적으로 없음.
// 완료 후 요약 sheet 에서 풍부한 데이터 (평균 페이스, splits 포함) 제공.

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { PluginListenerHandle } from '@capacitor/core';
import { ArrowLeft, Pause, Play, Check, MapPin, AlertCircle, Volume2, VolumeX } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { loadGoogleMaps, API_KEY as MAPS_KEY } from '@/lib/google-maps';
import { logClientInfo, logClientWarn } from '@/lib/error-logger';
import { getSupabase } from '@/lib/supabase';
import {
  speakMilestone, getVoiceCueIntervalMeters,
  isVoiceCueEnabled, setVoiceCueEnabled,
  setVoiceCueIntervalMeters, speakSample,
  getVoiceGender, setVoiceGender, speakGreetingSample, hasEnhancedKoreanVoice,
  hasKoreanMaleVoice,
  type VoiceGender, type VoiceCourseContext,
} from '@/lib/voice-cue';
import {
  type TrackingState, type Coord,
  createInitialState, loadState, saveState, clearState,
  requestLocationPermission, checkLocationPermission, getCurrentLocation,
  startWatcher, type WatcherHandle,
  appendCoord, tickElapsed, formatDistanceKm,
  detectAutoPause, detectAutoResume,
  writeFinishArchive, readPendingFinishArchive,
} from '@/lib/gps-tracking';
// build 292 Phase 1: 네이티브 RunSession 엔진. 두뇌 (거리/자동정지/음성) 를 native 로 이관,
// JS 는 'update' 이벤트 렌더러. 플러그인 미탑재 빌드는 위 레거시 JS 엔진 폴백 (동작 무변경).
import {
  isRunSessionAvailable, requestRunPermissions, prepareRunAudio, speakNative, startRunSession,
  pauseRunSession, resumeRunSession, stopRunSession, getRunSnapshot,
  attachRunSessionListeners,
  type RunGpsSignal, type RunSessionSnapshot,
} from '@/lib/run-session';

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

// 단순화 B (2026-07-11): build 285 임시 비활성 게이트 (TRACKING_ENABLED)·dev 게이트 (?dev=1 / 7-tap)·
// TrackComingSoon 화면 삭제 — build 292 부터 전원 공개라 전부 도달 불가 죽은 코드였음.
export default function TrackPage() {
  return <TrackPageImpl />;
}

function TrackPageImpl() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { tt, locale } = useI18n();

  // build 292: 엔진 선택. true=네이티브 RunSession (update 이벤트 렌더), false=레거시 JS 엔진.
  // 네이티브 start 실패 시 setUseNative(false) 로 세션 단위 폴백 가능하도록 state 로 보관.
  const [useNative, setUseNative] = useState<boolean>(() => isRunSessionAvailable());
  const [gpsSignal, setGpsSignal] = useState<RunGpsSignal | null>(null);
  // update 이벤트 사이 경과시간 로컬 보간 baseline (native 경로 전용).
  const activeBaseRef = useRef<{ activeSec: number; at: number; running: boolean } | null>(null);

  const [perm, setPerm] = useState<PermState>('unknown');
  // lazy initializer 로 진행 중인 트래킹 복원 — useEffect 안 setState 보다 cleaner.
  // 네이티브 경로에선 localStorage 대신 getSnapshot() 재부착 (아래 effect) — stale 레거시 상태 무시.
  const [state, setState] = useState<TrackingState | null>(() => (isRunSessionAvailable() ? null : loadState()));
  const [finished, setFinished] = useState<TrackingState | null>(null);
  // build 210 #1: 시작 카운트다운 (3 → 2 → 1 → GO!) — Apple Fitness 패턴 + 차별화 효과
  const [countdown, setCountdown] = useState<number | null>(null);
  // build 299: 짧은 거리 완료 시 3버튼 시트 (시스템 confirm 의 Cancel/Ok 가 모호하다는 피드백)
  const [shortFinishSheet, setShortFinishSheet] = useState(false);
  // build 219 #10: 시작 화면에 음성 cue 토글 + 간격 선택 (1km / 500m). build 214 백엔드 존재했으나 UI 미노출.
  // build 223: 음성 성별 선택 추가 (여/남) + 변경 시 짧은 인사 미리듣기.
  const [voiceOn, setVoiceOn] = useState<boolean>(() => isVoiceCueEnabled());
  const [voiceInterval, setVoiceInterval] = useState<500 | 1000>(() => (getVoiceCueIntervalMeters() === 500 ? 500 : 1000));
  const [voiceGender, setVoiceGenderState] = useState<VoiceGender>(() => getVoiceGender());
  // build 234: ko 남성 voice 가 OS 에 없으면 picker 자체 hide (사용자: "남성 안 되면 옵션에서 빼자").
  // build 237: voiceGender 를 effect dep 에 넣으면 force-female set 후 재발화로 사용자 의도 swap 위험.
  // ref 로 latest 값 추적 + effect dep 에서 제외 (locale 만 의존).
  const [malePickerVisible, setMalePickerVisible] = useState<boolean>(false);
  // 2026-07-15 Android 리뷰 P0-2: Android WebView 엔 speechSynthesis 자체가 없음 —
  // UI 는 켜지는데 무음인 상태를 막기 위해 음성 블록 전체를 숨긴다 (카운트다운 beep 은 유지).
  // SSR 프리렌더와의 hydration mismatch 를 피하려고 effect 에서 판정.
  const [speechAvailable, setSpeechAvailable] = useState(true);
  const [isAndroid, setIsAndroid] = useState(false);
  useEffect(() => {
    setSpeechAvailable('speechSynthesis' in window);
    const platform = (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.();
    setIsAndroid(platform === 'android');
  }, []);
  // 리뷰 P2: Android 네이티브 TTS 는 init 이 비동기 — 미리 예열하지 않으면 첫 음성
  // 미리듣기가 무음. Android 에서만 (iOS 의 prepareAudio 는 오디오 세션 duck 을 걸어
  // build 241 launch 활성화 금지 계약에 저촉 — 거기선 시작 제스처 때만 호출).
  useEffect(() => {
    if (!speechAvailable && useNative) void prepareRunAudio();
  }, [speechAvailable, useNative]);
  // 2026-07-13: Enhanced/Premium 한국어 voice 미설치면 다운로드 힌트 노출 (자연스러움 최대 레버).
  const [showVoiceQualityHint, setShowVoiceQualityHint] = useState<boolean>(false);
  const voiceGenderRef = useRef(voiceGender);
  useEffect(() => { voiceGenderRef.current = voiceGender; }, [voiceGender]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const recheck = () => {
      // 2026-07-15 리뷰 fix: WKWebView 의 getVoices() 는 초기에 [] 를 자주 반환 —
      // 그 상태로 판단하면 사용자의 male 설정을 파괴하고 프리미엄 힌트를 오노출.
      // voices 가 비어 있으면 판단 보류 (voiceschanged 가 다시 부름).
      const voices = window.speechSynthesis?.getVoices?.() ?? [];
      if (locale === 'ko' && voices.length === 0) return;
      const available = locale !== 'ko' || hasKoreanMaleVoice();
      setMalePickerVisible(available);
      // 프리미엄 보이스 힌트는 iOS 전용 안내 (Android 는 경로가 다름 — 오안내 방지)
      const platform = (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.();
      setShowVoiceQualityHint(locale === 'ko' && platform === 'ios' && !hasEnhancedKoreanVoice());
      // 남성 voice 없는데 male 선택 상태였다면 female 로 강제 (ref 로 latest 읽기).
      if (!available && voiceGenderRef.current === 'male') {
        setVoiceGenderState('female');
        setVoiceGender('female');
      }
    };
    recheck();
    const t = setTimeout(recheck, 500);
    try { window.speechSynthesis?.addEventListener?.('voiceschanged', recheck); } catch {}
    return () => {
      clearTimeout(t);
      try { window.speechSynthesis?.removeEventListener?.('voiceschanged', recheck); } catch {}
    };
  }, [locale]);
  const toggleVoice = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    setVoiceCueEnabled(next);
    if (next) {
      // Android WebView 는 speechSynthesis 가 없어 speakSample 이 무음 — 네이티브 TTS 로 미리듣기.
      // iOS 는 기존 Web Speech 미리듣기 유지 (성별 선택 프리뷰와 일관).
      if (!speechAvailable && useNative) {
        void speakNative(locale === 'en'
          ? '1 kilometer. Average pace 5 minutes 30 seconds. Looking strong.'
          : '1킬로미터 통과. 평균 페이스 5분 30초. 잘하고 있어요.', locale);
      } else {
        speakSample(locale);
      }
    }
  };
  const changeInterval = (m: 500 | 1000) => {
    setVoiceInterval(m);
    setVoiceCueIntervalMeters(m);
  };
  const changeGender = (g: VoiceGender) => {
    setVoiceGenderState(g);
    setVoiceGender(g);
    if (voiceOn) speakGreetingSample(locale);
    // build 234: ko 남성 voice 없으면 picker 자체 hide. 옛 alert 안내 제거.
  };

  // build 229.B: 활성 월드런 챌린지 코스 — 트래킹 중 음성 안내에 코스명 + 다음 랜드마크 카운트다운 추가.
  // 트래킹 시작 시점의 코스 progress 를 startProgressKm 으로 잡고, 트래킹 중 distance 누적과 합산.
  // build 237: state + ref 이중 보관. watcher closure 가 activeCourse stale 참조하던 회귀 차단.
  type ActiveCourse = {
    name: string;
    totalKm: number;
    startProgressKm: number;
    landmarks: { km: number; name: string }[];
  };
  const [activeCourse, setActiveCourse] = useState<ActiveCourse | null>(null);
  const activeCourseRef = useRef<ActiveCourse | null>(null);
  useEffect(() => { activeCourseRef.current = activeCourse; }, [activeCourse]);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ fetchMyCourses, fetchCourseById }] = await Promise.all([
          import('@/lib/world-data'),
        ]);
        const my = await fetchMyCourses().catch(() => []);
        const active = my.find(m => !m.completed_at);
        if (!active) return;
        const full = await fetchCourseById(active.course_id).catch(() => null);
        if (cancelled || !full) return;
        setActiveCourse({
          name: full.name,
          totalKm: full.distance_km,
          startProgressKm: active.progress_km ?? 0,
          landmarks: (full.landmarks ?? []).map(l => ({ km: l.km, name: l.name })).sort((a, b) => a.km - b.km),
        });
      } catch (e) {
        console.warn('[track] activeCourse fetch fail', e);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

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
      // build 292: 네이티브 경로에선 localStorage 상태를 쓰지 않음 — getSnapshot 재부착
      // effect 가 polyline 을 복원 (stale 레거시 좌표가 되살아나는 사고 방지).
      const s = isRunSessionAvailable() ? null : loadState();
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
  // build 292: 네이티브 세션 스냅샷 → 렌더용 TrackingState 매핑 (마운트 재부착 + already-active 회수 공용).
  // 계약상 snapshot 에 startedAtMs 가 명시돼 있지 않아 없으면 근사 (첫 좌표 ts → now-activeSec).
  const applyRunSnapshot = useCallback((snap: RunSessionSnapshot) => {
    const coords: Coord[] = (snap.routeSoFar ?? []).map(([lng, lat, ts]) => [lng, lat, 0, ts] as Coord);
    const startedAt = snap.startedAtMs ?? (coords[0]?.[3] ?? Date.now() - snap.activeSec * 1000);
    activeBaseRef.current = { activeSec: snap.activeSec, at: Date.now(), running: snap.state === 'running' };
    setGpsSignal(snap.gpsSignal);
    setState(prev => {
      if (prev) return prev;   // 이미 진행 중 화면이면 덮어쓰지 않음
      return {
        startedAt,
        elapsedSeconds: snap.activeSec,
        distanceMeters: snap.distanceM,
        coords,
        status: snap.state === 'running' ? 'active' : 'paused',
        autoPaused: snap.state === 'autoPaused',
        lastTickAt: Date.now(),
        lastResumeAt: Date.now(),
      };
    });
  }, []);

  // 2026-07-14: 친구 라이브 러닝 push — "지금 달리는 중 🏃". 서버 RPC 가 노이즈 가드
  // (러너당 하루 1회 KST · 수신자 설정 · 비공개 프로필 제외) 전부 처리. fire-and-forget.
  // 2026-07-15 리뷰: 세션 시작이 "확정" 된 뒤에만 발사 — 이전엔 native start 가
  // session-already-active 로 거절돼 재부착만 한 경우에도 하루 1회 쿼터를 소모했음.
  const fireLiveRunPush = useCallback(() => {
    void getSupabase().rpc('notify_friends_run_started').then(
      ({ data, error }) => {
        // 에러를 삼키지 않고 기록 — push_devices 오타 (42P01) 무음 사망 재발 방지 (진단 페어링 룰)
        if (error) { void logClientWarn('track-start', 'live-run push RPC fail', { message: error.message, code: error.code }); return; }
        if (typeof data === 'number' && data > 0) logClientInfo('track-start', 'live-run push', { recipients: data });
      },
      (e) => { void logClientWarn('track-start', 'live-run push reject', { message: e instanceof Error ? e.message : String(e) }); }
    );
  }, []);

  const beginTrackingAfterCountdown = useCallback(() => {
    if (useNative) {
      // 네이티브 엔진: start 가 세션 소유. JS state 는 렌더 미러만.
      void (async () => {
        try {
          const res = await startRunSession({
            locale,
            voiceEnabled: isVoiceCueEnabled(),
            milestoneEveryKm: getVoiceCueIntervalMeters() === 500 ? 0.5 : 1,
            voiceGender: getVoiceGender(),
          });
          const fresh = createInitialState();
          fresh.startedAt = res.startedAtMs;
          activeBaseRef.current = { activeSec: 0, at: Date.now(), running: true };
          setState(fresh);
          fireLiveRunPush();
          logClientInfo('track-start', 'native-begin', { startedAt: res.startedAtMs });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          void logClientWarn('run-session', 'start-fail', { message: msg });
          if (msg.includes('session-already-active')) {
            // 이전 세션이 native 에 살아있음 — 재부착으로 회수.
            try {
              const snap = await getRunSnapshot();
              if (snap.active) { applyRunSnapshot(snap); return; }
            } catch { /* fallthrough */ }
          }
          // 최후 폴백: 이 세션만 레거시 JS 엔진으로 시작 (사용자 관점 무중단).
          setUseNative(false);
          const fresh = createInitialState();
          setState(fresh);
          saveState(fresh);
          fireLiveRunPush();
          logClientInfo('track-start', 'begin (native-fail fallback)', { startedAt: fresh.startedAt });
        }
      })();
      return;
    }
    const fresh = createInitialState();
    setState(fresh);
    saveState(fresh);
    fireLiveRunPush();
    logClientInfo('track-start', 'begin', { startedAt: fresh.startedAt });
  }, [useNative, locale, applyRunSnapshot, fireLiveRunPush]);
  // build 213 #1: countdown 진행 중이거나 이미 active 면 더블탭 무시 (race condition guard).
  const startingRef = useRef(false);
  const startTracking = useCallback(async () => {
    if (startingRef.current || countdown !== null || state !== null) return;
    startingRef.current = true;
    // build 299: 카운트다운 beep 무음 fix — 시작 제스처 직후 오디오 세션 선점 (fire-and-forget)
    void prepareRunAudio();
    try {
      // build 292: 네이티브 경로는 RunSession.requestPermissions (위치 Always 승격 + motion).
      // motion 거부여도 진행 (pedometer 융합만 빠짐) — location 만 gate.
      if (useNative) {
        try {
          const p = await requestRunPermissions();
          const mapped: PermState = p.location === 'granted' ? 'granted' : (p.location === 'denied' ? 'denied' : 'prompt');
          setPerm(mapped);
          if (mapped !== 'granted') {
            // 리뷰 P2 (Android): 한 번 거부하면 'prompt-with-rationale' → 조용한 무반응 탭이
            // 됐었음. denied 는 아래 전용 화면이 뜨지만 prompt 는 안내가 없어 명시.
            if (mapped === 'prompt') {
              window.alert(locale === 'en'
                ? 'Location permission is required to record your run. Tap Start again to allow.'
                : '달리기를 기록하려면 위치 권한이 필요해요. 시작을 다시 누르고 허용해 주세요.');
            }
            return;
          }
        } catch (err) {
          // 플러그인 미탑재/오류 — 레거시 엔진으로 폴백 후 기존 권한 흐름.
          void logClientWarn('run-session', 'permission-fail → legacy fallback', {
            message: err instanceof Error ? err.message : String(err),
          });
          setUseNative(false);
          const r = await requestLocationPermission();
          setPerm(r);
          if (r !== 'granted') return;
        }
      } else {
        const r = await requestLocationPermission();
        setPerm(r);
        if (r !== 'granted') return;
      }
      const here = await getCurrentLocation();
      if (here && mapRef.current) {
        mapRef.current.panTo(here);
        youMarkerRef.current?.setPosition(here);
      }
      setCountdown(3);
    } finally {
      startingRef.current = false;
    }
  }, [countdown, state, useNative, locale]);

  // build 292: 마운트 시 native 진행 중 세션 재부착 (앱 재시작 / 화면 이탈 복귀).
  useEffect(() => {
    if (!useNative) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getRunSnapshot();
        if (cancelled || !snap.active) return;
        void logClientInfo('run-session', 'snapshot-reattach', {
          state: snap.state,
          distance_m: Math.round(snap.distanceM),
          active_s: Math.round(snap.activeSec),
          coords_n: snap.routeSoFar?.length ?? 0,
        });
        applyRunSnapshot(snap);
      } catch { /* 플러그인 미탑재 빌드 등 — 무시 (시작 시점에 폴백 처리) */ }
    })();
    return () => { cancelled = true; };
  }, [useNative, applyRunSnapshot]);

  // build 292: 재부착 직후 지도 폴리라인 전체 복원 (map 은 async 로드라 준비될 때까지 재시도).
  const nativeRouteRestoredRef = useRef(false);
  useEffect(() => {
    if (!useNative || nativeRouteRestoredRef.current) return;
    if (!state || state.coords.length === 0) return;
    if (!mapRef.current || !polylineRef.current || !youMarkerRef.current) return;
    const path = state.coords.map(([lng, lat]) => ({ lat, lng }));
    polylineRef.current.setPath(path);
    const last = path[path.length - 1];
    youMarkerRef.current.setPosition(last);
    mapRef.current.setCenter(last);
    nativeRouteRestoredRef.current = true;
  }, [useNative, state]);

  // 카운트다운 tick (3 → 2 → 1 → GO!)
  // build 220 #1: 각 tick 마다 짧은 beep (3,2,1: 660Hz, GO: 880Hz 길게).
  // build 300 후속: 네이티브면 TTS 카운트다운 ("셋/둘/하나/출발") — WebAudio 비프가 iOS
  // 실기기에서 무음 (hans 실측, prepareAudio 이후에도). 웹/레거시만 비프 유지.
  useEffect(() => {
    if (countdown === null) return;
    const sayOrBeep = (n: number) => {
      const ko = ['출발!', '하나', '둘', '셋'];
      const en = ['Go!', 'one', 'two', 'three'];
      const text = (locale === 'en' ? en : ko)[n] ?? String(n);
      void speakNative(text, locale).then(ok => {
        if (!ok) playCountdownBeep(n === 0 ? 'go' : 'tick');
      });
    };
    if (countdown <= 0) {
      // "출발!" 은 native start() 가 세션 셋업 후 발화 (JS 발화는 오디오 재구성에 잘림).
      // 레거시/웹 경로만 beep.
      if (!isRunSessionAvailable()) playCountdownBeep('go');
      const t = setTimeout(() => {
        setCountdown(null);
        beginTrackingAfterCountdown();
      }, GO_HOLD_MS);
      return () => clearTimeout(t);
    }
    sayOrBeep(countdown);
    const t = setTimeout(() => setCountdown(c => (c !== null ? c - 1 : null)), COUNTDOWN_TICK_MS);
    return () => clearTimeout(t);
  }, [countdown, beginTrackingAfterCountdown, locale]);

  // build 283 (hans 2026-06-11 회귀 fix):
  // 이전 deps 가 `[state?.status]` 라서 active ↔ paused 전환마다 watcher cleanup + re-create.
  // 자동 일시정지 시 watcher clear → 좌표 수신 불가 → 자동 resume 영원히 불가 + bg-native-start
  // 8번 재호출 사고. deps 를 운동 시작 (idle → active) 과 종료 (status='idle') 만 트리거하도록 변경.
  // paused 상태에서도 watcher 살려두고 좌표 수신 → callback 안의 detectAutoResume 으로 정상 resume.
  const isTrackingActive = state !== null && state.status !== 'idle';

  // 2026-07-15 Android 리뷰 P0-1: 레거시 JS 엔진은 두뇌가 WebView 라 화면 잠금 = 측정 정지.
  // 트래킹 동안 navigator.wakeLock 으로 화면 꺼짐 방지 (WebView 지원, 플러그인 의존성 0).
  // 다른 앱 전환 후 복귀 시 OS 가 sentinel 을 회수하므로 visibilitychange 에서 재획득.
  // 미지원/저전력 모드 등 실패는 조용히 — 근본 해결은 Android FGS RunSession Phase 2.
  useEffect(() => {
    if (useNative || !isTrackingActive) return;
    type WakeLockNav = Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } };
    let sentinel: { release: () => Promise<void> } | null = null;
    let released = false;
    const acquire = async () => {
      try {
        const wl = (navigator as WakeLockNav).wakeLock;
        if (!wl) return;
        const s = await wl.request('screen');
        if (released) { void s.release().catch(() => {}); return; }
        sentinel = s;
      } catch { /* 조용히 실패 */ }
    };
    void acquire();
    const onVis = () => { if (!document.hidden) void acquire(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVis);
      try { void sentinel?.release().catch(() => {}); } catch {}
    };
  }, [useNative, isTrackingActive]);

  useEffect(() => {
    // build 292: 네이티브 경로에선 레거시 watcher / 100ms tick / JS 자동정지 / JS 음성 전부 비활성
    // (전부 native RunSession 이 담당). 아래 별도 effect 가 update 이벤트 렌더 + 1s 보간 수행.
    if (useNative) return;
    if (!isTrackingActive) {
      watcherRef.current?.clear().catch(() => {});
      watcherRef.current = null;
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      return;
    }

    let mounted = true;
    startWatcher((c) => {
      if (!mounted) return;
      setState(prev => {
        if (!prev) return prev;
        // build 257: 자동 일시정지 상태였으면 새 좌표가 들어왔으므로 재개.
        // 사용자가 직접 paused 한 경우 (autoPaused=false) 는 무시 — 명시적 재개 버튼만 트리거.
        if (prev.status === 'paused' && prev.autoPaused) {
          const resumed: TrackingState = { ...prev, coords: [...prev.coords] };
          detectAutoResume(resumed, Date.now());
          const lastBefore = prev.coords[prev.coords.length - 1];
          const lastTs = lastBefore ? lastBefore[3] : 0;
          void logClientInfo('gps-tracking', 'auto-resumed', {
            ms_paused: lastTs ? Date.now() - lastTs : null,
          });
          appendCoord(resumed, c);
          if (mapRef.current && polylineRef.current && youMarkerRef.current) {
            const ll = { lat: c.lat, lng: c.lng };
            youMarkerRef.current.setPosition(ll);
            polylineRef.current.setPath(resumed.coords.map(([lng, lat]) => ({ lat, lng })));
            mapRef.current.panTo(ll);
          }
          saveState(resumed);
          return resumed;
        }
        if (prev.status !== 'active') return prev;
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
            // build 229.B: 활성 코스가 있으면 coursecontext 채워서 음성 안내 강화.
            // build 237: state 대신 ref 로 읽어 closure stale 차단. 트래킹 시작 후 코스 fetch 완료 시
            // 늦게 활성화돼도 즉시 음성에 반영됨.
            let courseContext: VoiceCourseContext | null = null;
            const ac = activeCourseRef.current;
            if (ac) {
              const courseCurrentKm = ac.startProgressKm + (next.distanceMeters / 1000);
              if (courseCurrentKm < ac.totalKm + 1) {
                const nextLm = ac.landmarks.find(l => l.km > courseCurrentKm + 0.05) ?? null;
                courseContext = {
                  courseName: ac.name,
                  courseCurrentKm,
                  courseTotalKm: ac.totalKm,
                  nextLandmark: nextLm,
                };
              }
            }
            speakMilestone({
              totalKm,
              elapsedSeconds: Math.floor(next.elapsedSeconds),
              avgPaceSecPerKm: avgPace,
              locale,
              courseContext,
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
        if (!prev) return prev;
        if (prev.status === 'idle') return prev;
        const next: TrackingState = { ...prev };
        // build 257: active 일 때만 자동 일시정지 검출. 좌표가 30초 이상 안 들어오면 (build 283 갱신)
        // 신호 대기 / 카페 입장 등으로 판단하고 paused 로 전환 → 시간 누적 중단.
        if (next.status === 'active') {
          const justPaused = detectAutoPause(next, Date.now());
          if (justPaused) {
            const last = next.coords[next.coords.length - 1];
            const lastTs = last ? last[3] : 0;
            void logClientInfo('gps-tracking', 'auto-paused', {
              ms_since_last_coord: lastTs ? Date.now() - lastTs : null,
              coords_n: next.coords.length,
            });
          }
        }
        // tickElapsed 는 status !== 'active' 면 자체적으로 시간 누적 안 함.
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
  }, [isTrackingActive, useNative]);

  // build 292: 네이티브 경로 — 'update' 이벤트 렌더러.
  // native 가 필터/적산/자동정지/음성을 전부 처리하므로 JS 는:
  //   (1) newCoords 를 폴리라인에 append (전체 setPath 아님 — 좌표 수천 개여도 가벼움)
  //   (2) distance/activeSec/state 를 렌더 state 로 미러
  //   (3) update 이벤트 사이 경과시간 1s 로컬 보간 (running 일 때만)
  useEffect(() => {
    if (!useNative || !isTrackingActive) return;
    let mounted = true;
    let detach: (() => void) | null = null;
    attachRunSessionListeners({
      onUpdate: (e) => {
        if (!mounted) return;
        activeBaseRef.current = { activeSec: e.activeSec, at: Date.now(), running: e.state === 'running' };
        setGpsSignal(e.gpsSignal);
        if (e.newCoords.length > 0 && mapRef.current && polylineRef.current && youMarkerRef.current) {
          const path = polylineRef.current.getPath();
          for (const [lng, lat] of e.newCoords) path.push(new google.maps.LatLng(lat, lng));
          const [lng, lat] = e.newCoords[e.newCoords.length - 1];
          youMarkerRef.current.setPosition({ lat, lng });
          mapRef.current.panTo({ lat, lng });
        }
        setState(prev => {
          if (!prev) return prev;
          const appended: Coord[] = e.newCoords.map(([lng, lat, ts]) => [lng, lat, 0, ts] as Coord);
          return {
            ...prev,
            coords: appended.length > 0 ? [...prev.coords, ...appended] : prev.coords,
            distanceMeters: e.distanceM,
            elapsedSeconds: e.activeSec,
            status: e.state === 'running' ? 'active' : 'paused',
            autoPaused: e.state === 'autoPaused',
            lastTickAt: Date.now(),
          };
        });
      },
      onMilestone: (m) => {
        // 음성은 native 가 이미 발화 — JS 는 관측만.
        void logClientInfo('run-session', 'milestone', { km: m.km, avg_pace: m.avgPaceSecPerKm, split_pace: m.splitPaceSecPerKm ?? null });
      },
    }).then(fn => {
      if (!mounted) { fn(); return; }
      detach = fn;
    }).catch(() => {});

    const interval = window.setInterval(() => {
      const base = activeBaseRef.current;
      if (!base || !base.running) return;
      setState(prev => {
        if (!prev || prev.status !== 'active') return prev;
        return { ...prev, elapsedSeconds: base.activeSec + (Date.now() - base.at) / 1000 };
      });
    }, 1000);

    return () => {
      mounted = false;
      if (detach) detach();
      clearInterval(interval);
    };
  }, [useNative, isTrackingActive]);

  const handlePause = () => {
    if (useNative) {
      // native 가 activeSec 적산 정지 소유. JS 는 낙관적 미러 (다음 update 이벤트가 확정).
      void pauseRunSession().catch((e) => {
        void logClientWarn('run-session', 'pause-fail', { message: e instanceof Error ? e.message : String(e) });
      });
      setState(prev => (prev ? { ...prev, status: 'paused', autoPaused: false, lastTickAt: Date.now() } : prev));
      return;
    }
    setState(prev => {
      if (!prev) return prev;
      const next: TrackingState = { ...prev, status: 'paused', lastTickAt: Date.now() };
      saveState(next);
      return next;
    });
  };

  const handleResume = () => {
    if (useNative) {
      // resume 은 autoPaused 상태도 해제 (계약).
      void resumeRunSession().catch((e) => {
        void logClientWarn('run-session', 'resume-fail', { message: e instanceof Error ? e.message : String(e) });
      });
      const now = Date.now();
      if (activeBaseRef.current) activeBaseRef.current = { ...activeBaseRef.current, at: now, running: true };
      setState(prev => (prev ? { ...prev, status: 'active', autoPaused: false, lastTickAt: now, lastResumeAt: now } : prev));
      return;
    }
    setState(prev => {
      if (!prev) return prev;
      // build 284: autoPaused 플래그 명시 해제 + lastResumeAt 갱신.
      // 이전엔 사용자가 "재개" 눌러도 autoPaused 가 true 그대로 남고, 100ms 후 다음 tick 의
      // detectAutoPause 가 stale 좌표 ts 보고 즉시 다시 paused 로 전환 → 재개 무효 회귀.
      const now = Date.now();
      const next: TrackingState = {
        ...prev,
        status: 'active',
        autoPaused: false,
        lastTickAt: now,
        lastResumeAt: now,
      };
      void logClientInfo('gps-tracking', 'manual-resume', {
        was_auto_paused: prev.autoPaused ?? false,
        coords_n: prev.coords.length,
      });
      saveState(next);
      return next;
    });
  };

  // build 214 #2: 모든 종료 흐름 관측 + clearState 직전 archive 키로 백업 (복구 가능)
  // 2026-07-18: 완주 핸드오프는 pendingSave=true — 저장 전에 시트가 사라지면 mount 복구 대상.
  const archiveStateBeforeClear = (s: TrackingState, reason: string) => {
    writeFinishArchive(s, reason, reason.includes('handoff'));
  };

  // 2026-07-18 (hans 창원 런 유실): 완주 후 저장 전에 앱 종료/시트 이탈로 증발한 기록 복구.
  // 활성 세션 (네이티브 snapshot / 레거시 localStorage) 이 없을 때만 — 진행 중 러닝이 우선.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (isRunSessionAvailable()) {
        try {
          const snap = await getRunSnapshot();
          if (snap.active) return;
        } catch { /* 플러그인 미탑재 — 계속 */ }
      } else if (loadState() !== null) {
        return;
      }
      if (cancelled) return;
      const archive = readPendingFinishArchive();
      if (!archive) return;
      setFinished(prev => prev ?? archive.state);
      void logClientInfo('track-recover', 'unsaved-finish restored', {
        distance_m: Math.round(archive.state.distanceMeters),
        age_min: Math.round((Date.now() - archive.archivedAt) / 60000),
        reason: archive.reason,
      });
    })();
    return () => { cancelled = true; };
  }, []);

  const handleFinish = () => {
    if (!state) return;
    // build 253 진단: distinct timestamp 비율 — native plugin 중복 emit 회귀 즉시 감지.
    // hans 2026-06-07 사례 (13428 coords / 6724 distinct ts = 50%) 같은 사고가 또 나면 로그에 박힘.
    const distinctTs = new Set(state.coords.map((c) => c[3])).size;
    const dupRatio = state.coords.length > 0 ? distinctTs / state.coords.length : 1;
    logClientInfo('track-finish', 'click', {
      distance_m: Math.round(state.distanceMeters),
      elapsed_s: Math.floor(state.elapsedSeconds),
      coords_n: state.coords.length,
      distinct_ts: distinctTs,
      distinct_ts_ratio: Math.round(dupRatio * 100) / 100,
    });
    if (state.distanceMeters < 50) {
      // build 299: 시스템 confirm (Cancel/Ok) 대신 저장/삭제/계속 3버튼 시트 — 테스트 러닝을
      // 기록에 안 남기고 버리는 경로가 명확해짐.
      setShortFinishSheet(true);
      return;
    }
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
    proceedFinish();
  };

  // 확인을 통과한 뒤의 실제 종료 — 요약 시트로 핸드오프 (짧은 거리 시트의 "저장" 도 이 경로)
  const proceedFinish = () => {
    if (!state) return;
    if (useNative) {
      // build 292: native stop() 이 최종 진실 (GPS+pedometer 융합 거리, 필터 통과 route).
      // route [lng,lat,tsMs] → 기존 Coord [lng,lat,alt,tsMs] 로 변환해 TrackSummarySheet
      // (GeoJSON 변환 + splits + 저장 파이프라인) 를 무변경 재사용.
      void (async () => {
        let finalState: TrackingState;
        try {
          const summary = await stopRunSession();
          finalState = {
            startedAt: summary.startedAtMs,
            elapsedSeconds: summary.activeSec,
            distanceMeters: summary.distanceM,
            coords: summary.route.map(([lng, lat, ts]) => [lng, lat, 0, ts] as Coord),
            status: 'idle',
            lastTickAt: summary.endedAtMs,
          };
          void logClientInfo('run-session', 'stop-summary', {
            distance_m: Math.round(summary.distanceM),
            gps_m: Math.round(summary.gpsDistanceM),
            pedometer_m: Math.round(summary.pedometerDistanceM),
            active_s: Math.round(summary.activeSec),
            elapsed_s: Math.round(summary.elapsedSec),
            auto_paused_s: Math.round(summary.autoPausedSec),
            coords_n: summary.route.length,
          });
        } catch (e) {
          // stop 실패 (no-active-session 등) — 렌더 미러 state 로라도 저장 기회 보존.
          void logClientWarn('run-session', 'stop-fail → js-mirror fallback', {
            message: e instanceof Error ? e.message : String(e),
          });
          finalState = { ...state, status: 'idle' };
        }
        archiveStateBeforeClear(finalState, 'native-finish-handoff-to-sheet');
        setFinished(finalState);
        setState(null);
        activeBaseRef.current = null;
        clearState();
      })();
      return;
    }
    const finalState: TrackingState = { ...state, status: 'idle' };
    archiveStateBeforeClear(finalState, 'finish-handoff-to-sheet');
    setFinished(finalState);
    setState(null);
    clearState();
  };

  // 저장 없이 폐기 — 뒤로가기 (confirm 경유) 와 짧은 거리 시트의 "삭제" 가 공유
  const discardRun = (reason: string) => {
    if (!state) return;
    logClientWarn('track-abort', reason, {
      distance_m: Math.round(state.distanceMeters),
      elapsed_s: Math.floor(state.elapsedSeconds),
      coords_n: state.coords.length,
    });
    archiveStateBeforeClear(state, 'abort');
    // build 292: native 세션도 반드시 종료 — 안 하면 화면을 떠나도 native 가 계속 적산.
    if (useNative) {
      void stopRunSession().catch(() => {});
      activeBaseRef.current = null;
    }
    setState(null);
    clearState();
    router.back();
  };

  const handleAbort = () => {
    if (!state) return;
    const msg = locale === 'en'
      ? 'Stop tracking? Your run will not be saved.'
      : '트래킹을 종료할까요? 기록은 저장되지 않습니다.';
    if (!window.confirm(msg)) return;
    discardRun('user-cancel');
  };

  // 2026-07-15 Android 리뷰 P1-3: 하드웨어 뒤로가기. Capacitor 기본 동작은 WebView history
  // back — 트래킹 중엔 화면만 떠나고 watcher/tick 은 계속 도는 유령 세션이 됨.
  // 트래킹 중이면 handleAbort (confirm 경유 폐기), 아니면 router.back(). backButton 이벤트는
  // Android 에서만 발화하지만 명시 게이트로 의도를 못박음. 최신 state/핸들러는 ref 로 참조.
  const hasStateRef = useRef(false);
  useEffect(() => { hasStateRef.current = state !== null; }, [state]);
  const handleAbortRef = useRef(handleAbort);
  useEffect(() => { handleAbortRef.current = handleAbort; });
  // 리뷰 P1: 완료 요약 시트가 열린 상태 (state 는 이미 null) 에서 뒤로가기가 router.back()
  // 을 타면 저장 전 기록이 통째로 유실 — 시트 열림 동안 뒤로가기는 소비만 한다.
  // 리뷰 P2: 카운트다운~native start 확정 사이 (state 아직 null) 뒤로가기도 소비 —
  // 화면만 떠나고 native 세션이 유령으로 도는 race 차단.
  const finishedRef = useRef(false);
  useEffect(() => { finishedRef.current = finished !== null; }, [finished]);
  const countdownRef = useRef<number | null>(null);
  useEffect(() => { countdownRef.current = countdown; }, [countdown]);
  useEffect(() => {
    if (!isAndroid) return;
    let mounted = true;
    let handle: PluginListenerHandle | null = null;
    import('@capacitor/app').then(({ App }) => {
      void App.addListener('backButton', () => {
        if (finishedRef.current) return;
        if (countdownRef.current !== null || startingRef.current) return;
        if (hasStateRef.current) handleAbortRef.current();
        else router.back();
      }).then(h => {
        if (!mounted) { void h.remove(); return; }
        handle = h;
      });
    }).catch(() => {});
    return () => {
      mounted = false;
      void handle?.remove();
    };
  }, [isAndroid, router]);

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
  // build 257: 자동 일시정지 시각 구분 — 사용자가 직접 누른 게 아니라 시스템이 멈춘 것.
  const isAutoPaused = isPaused && (state?.autoPaused ?? false);

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
          {hasState ? (
            isPaused ? (isAutoPaused ? tt('자동 일시정지') : tt('일시정지')) : tt('달리는 중')
          ) : tt('달리기 준비')}
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
        {isPaused && !isAutoPaused && (
          <div className="ml-auto inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/40">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            <span className="text-sm font-extrabold text-amber-600 dark:text-amber-400 tracking-wider leading-none">
              {locale === 'en' ? 'PAUSED' : '일시정지'}
            </span>
          </div>
        )}
        {isAutoPaused && (
          <div className="ml-auto inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-sky-500/10 border border-sky-500/40">
            <span className="relative flex w-2.5 h-2.5">
              <span className="absolute inset-0 rounded-full bg-sky-500 opacity-75 animate-pulse" />
              <span className="relative rounded-full w-2.5 h-2.5 bg-sky-500" />
            </span>
            <span className="text-sm font-extrabold text-sky-600 dark:text-sky-400 tracking-wider leading-none">
              {locale === 'en' ? 'AUTO PAUSED' : '자동 일시정지'}
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
        {/* build 292: GPS 신호 배지 (native update 이벤트의 gpsSignal) */}
        {useNative && hasState && gpsSignal && (
          <div className="absolute top-3 left-3 z-[5] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-black/55 backdrop-blur text-[11px] font-extrabold text-white pointer-events-none">
            <span className={`w-2 h-2 rounded-full ${
              gpsSignal === 'good' ? 'bg-emerald-400' : gpsSignal === 'weak' ? 'bg-amber-400' : 'bg-rose-500'
            }`} />
            {gpsSignal === 'good' ? tt('GPS 좋음') : gpsSignal === 'weak' ? tt('GPS 약함') : tt('GPS 끊김')}
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
              {/* 2026-07-15 Android 리뷰 P0-1: 레거시 JS 엔진 (구버전 Android 빌드) 은 백그라운드
                  트래킹이 안 돼 "잠금 화면에서도 측정" 카피가 허위 — 화면 유지 안내로 분기.
                  네이티브 RunSession (Phase 2, FGS) 이 있으면 iOS 와 동일하게 잠금 측정 가능. */}
              {isAndroid && !useNative
                ? (locale === 'en'
                  ? 'Keep the screen on while running — we’ll hold it awake for you. Tracking stops as soon as you finish.'
                  : '달리는 동안 화면을 켠 채로 유지해 주세요. 화면이 저절로 꺼지지 않게 잡아드려요.')
                : (locale === 'en'
                  ? 'GPS keeps measuring while the screen is locked. Tracking stops as soon as you finish.'
                  : '잠금 화면 상태에서도 GPS 가 계속 측정돼요. 트래킹을 종료하면 즉시 중단됩니다.')}
            </p>
            {/* build 219 #10: 음성 안내 토글 + 간격 선택 (1km / 500m)
                build 223: 음성 성별 선택 (여/남) — voiceOn 일 때 노출.
                2026-07-15 Android 리뷰 P0-2: 발화 경로가 하나도 없으면 (native TTS 없음 +
                speechSynthesis 없음 = Android WebView) 블록 전체 숨김 — 켜져 있는데 무음인 UI 방지. */}
            {(useNative || speechAvailable) && (
            <div className="mb-4 flex items-center gap-2 flex-wrap justify-center">
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
                <>
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
                  {/* build 234: ko 남성 voice 없으면 picker 자체 hide.
                      build 292: 네이티브 엔진은 AVSpeechSynthesizer voice 를 locale+quality 로
                      자체 선택 (계약에 gender 없음) — native 경로에선 성별 picker 숨김. */}
                  {malePickerVisible && !useNative && (
                    <div className="inline-flex items-center rounded-full bg-[var(--card)] border border-[var(--card-border)] overflow-hidden">
                      <button
                        onClick={() => changeGender('female')}
                        className={`h-9 px-3 text-xs font-extrabold transition ${voiceGender === 'female' ? 'bg-emerald-500 text-white' : 'text-[var(--muted)]'}`}
                      >{locale === 'en' ? 'Female' : '여성'}</button>
                      <button
                        onClick={() => changeGender('male')}
                        className={`h-9 px-3 text-xs font-extrabold transition ${voiceGender === 'male' ? 'bg-emerald-500 text-white' : 'text-[var(--muted)]'}`}
                      >{locale === 'en' ? 'Male' : '남성'}</button>
                    </div>
                  )}
                </>
              )}
            </div>
            )}
            {voiceOn && showVoiceQualityHint && (
              <p className="mb-4 -mt-2 text-[11px] text-[var(--muted)] text-center leading-relaxed">
                💡 더 자연스러운 목소리를 원하면 아이폰 <span className="font-bold">설정 → 손쉬운 사용 → 음성 콘텐츠 → 음성 → 한국어</span>에서
                프리미엄 보이스를 다운로드하세요. 받는 즉시 자동 적용돼요.
              </p>
            )}
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

            {/* build 226 #2: 완료(왼) / 일시정지·재개(오) — 오른손잡이 엄지로 가장 자주 누르는
                일시정지는 오른쪽, 완료는 안쪽(왼쪽) 으로 배치해 의도치 않은 완료 사고 줄임. */}
            <div className="grid grid-cols-2 gap-2.5">
              <button onClick={handleFinish}
                className="py-4 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-base active:scale-[0.98] inline-flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/30">
                <Check size={18} /> {tt('완료')}
              </button>
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
            </div>
          </>
        )}
      </div>

      {/* 완료 후 요약 sheet */}
      {finished && user && (
        <TrackSummarySheet
          finalState={finished}
          userId={user.id}
          nativeEngine={useNative}
          onClose={() => setFinished(null)}
        />
      )}

      {/* build 299: 짧은 거리 완료 시트 — 저장 / 저장 없이 삭제 / 계속 달리기 */}
      {shortFinishSheet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setShortFinishSheet(false)}>
          <div
            className="w-full max-w-lg bg-[var(--card)] rounded-t-3xl p-5 pb-[max(env(safe-area-inset-bottom),20px)] space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-base font-extrabold text-[var(--foreground)]">
              {locale === 'en' ? 'Distance is very short' : '이동 거리가 아직 거의 없어요'}
            </p>
            <p className="text-sm text-[var(--muted)] -mt-1">
              {locale === 'en' ? 'What would you like to do with this run?' : '이 기록을 어떻게 할까요?'}
            </p>
            <button
              onClick={() => { setShortFinishSheet(false); proceedFinish(); }}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-sm active:scale-[0.98] shadow-md shadow-emerald-500/30"
            >
              {locale === 'en' ? 'Save anyway' : '그래도 저장하기'}
            </button>
            <button
              onClick={() => { setShortFinishSheet(false); discardRun('short-distance-discarded'); }}
              className="w-full py-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 font-extrabold text-sm active:scale-[0.98]"
            >
              {locale === 'en' ? 'Delete (don\u2019t save)' : '저장 없이 삭제'}
            </button>
            <button
              onClick={() => setShortFinishSheet(false)}
              className="w-full py-3.5 rounded-2xl bg-[var(--card-border)]/40 text-[var(--foreground)] font-extrabold text-sm active:scale-[0.98]"
            >
              {locale === 'en' ? 'Keep running' : '계속 달리기'}
            </button>
          </div>
        </div>
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
