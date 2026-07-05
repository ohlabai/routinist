import { getSupabase } from './supabase';
import type { HealthDataType } from '@capgo/capacitor-health';
import { logClientError, logClientWarn, logClientInfo } from './error-logger';

// capgo 가 UTC ISO 로 주는 timestamp 를 사용자 폰의 timezone 기준 YYYY-MM-DD 로 변환.
// 이전: `.split('T')[0]` UTC 자르기 → 한국 새벽 러닝이 전날로. 그 후 KST 하드코딩 → 해외 사용자 같은 버그.
// 지금: Intl.DateTimeFormat().resolvedOptions().timeZone 으로 폰 timezone 자동 감지.
// 사용자가 출장으로 중국에 있으면 'Asia/Shanghai' 가 자동 반영. 한국에 돌아오면 'Asia/Seoul' 로.
function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';
  } catch {
    return 'Asia/Seoul';
  }
}

// 네이티브 플러그인 호출이 응답을 안 주는 경우 (권한 다이얼로그 미응답, 시스템 hang 등)
// 자동 sync 가 영원히 멈추지 않도록 individual call 마다 timeout 적용.
// PromiseLike 받아서 표준 Promise 결과로 race. Supabase PostgrestFilterBuilder 는 thenable 이라
// Promise<T> 타입 직접 매개로는 안 됨. 명시적으로 then 호출해서 표준 Promise 로 변환.
function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    Promise.resolve(p),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`[health-sync] ${label} ${ms / 1000}s timeout`)), ms)
    ),
  ]);
}

function toLocalDate(utcIso: string): string {
  try {
    const tz = getUserTimezone();
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    return fmt.format(new Date(utcIso));
  } catch {
    // Intl 미지원 폴백 — UTC + 9 시간 (한국 사용자 다수 가정)
    const d = new Date(utcIso);
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
  }
}

// 호환성 별칭 — 기존 코드는 toKstDate 호출
const toKstDate = toLocalDate;

export interface SyncResult {
  success: boolean;
  message: string;
  synced: number;
  // 권한이 거부됐을 때만 true. UI 가 "설정에서 허용해주세요" 안내를 띄울 수 있도록.
  authDenied?: boolean;
  // 누락 detection / UI 토스트용 메타. Apple Health 에서 받은 총 건수, 중복으로 스킵된 건수 등.
  meta?: {
    totalFromHealth: number;
    duplicates: number;
    candidates: number;
  };
}

// 진행률 시각화 — connect 페이지가 progress bar 표시할 수 있도록 단계별 callback 제공.
// 자동 sync (layout) 는 onProgress 전달 안 함 → 그쪽 동작은 변하지 않음.
export interface SyncProgress {
  stage: 'auth' | 'query' | 'fetch_existing' | 'insert' | 'route' | 'done';
  percent: number;     // 0~100
  label: string;       // 사용자에게 보여줄 짧은 한글 라벨
}
export interface SyncOptions {
  onProgress?: (p: SyncProgress) => void;
}

const HEALTH_READ_TYPES: HealthDataType[] = ['workouts', 'distance', 'heartRate', 'calories', 'exerciseTime'];

// 걷기 동기화 opt-in — 달리기 앱 취지에 맞게 기본은 러닝만 가져온다.
// 걷기로 유지/관리하는 사용자만 연동 페이지에서 켤 수 있음 (기기별 설정).
const WALKING_SYNC_KEY = 'health_sync_include_walking';
export function isWalkingSyncEnabled(): boolean {
  try {
    return localStorage.getItem(WALKING_SYNC_KEY) === 'true';
  } catch {
    return false;
  }
}
export function setWalkingSyncEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(WALKING_SYNC_KEY, enabled ? 'true' : 'false');
  } catch {
    // localStorage 불가 환경 (SSR 등) — 무시
  }
}

export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).Capacitor?.isNativePlatform?.() ?? false;
}

export function getPlatform(): 'android' | 'ios' | 'web' {
  if (typeof window === 'undefined') return 'web';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((window as any).Capacitor?.getPlatform?.() ?? 'web') as 'android' | 'ios' | 'web';
}

// 권한 요청 + 상태 확인을 한 번에. capgo Health 와 커스텀 WorkoutRoute 권한을 함께 요청해
// 다이얼로그가 두 번 분산되는 UX 를 막음. iOS 는 한 번 결정된 권한은 다이얼로그를 다시 안 띄우므로
// 자동 sync 진입부에서 매번 호출해도 안전.
async function ensureAuthorization(): Promise<{ authorized: boolean; denied: HealthDataType[] }> {
  const { Health } = await import('@capgo/capacitor-health');
  // 권한 요청은 한 번 결정되면 즉시 resolve, 미결정 상태면 다이얼로그 후 응답.
  // 사용자가 다이얼로그를 dismiss 하지 않고 멍하니 두는 경우 hang → 20s timeout.
  try {
    await withTimeout(
      Health.requestAuthorization({ read: HEALTH_READ_TYPES, write: [] }),
      20000,
      'Health.requestAuthorization',
    );
  } catch (e) {
    logClientWarn('health-sync', 'requestAuthorization timeout/실패 (계속 진행)', { err: String(e) });
  }

  // GPS 경로 권한 — capgo 가 workoutRoute 타입을 모르므로 별도 호출.
  try {
    const { WorkoutRoute } = await import('./workout-route');
    await withTimeout(WorkoutRoute.requestAuthorization(), 20000, 'WorkoutRoute.requestAuthorization');
  } catch (e) {
    // 커스텀 플러그인 미빌드 또는 옛 버전이면 무시 — 코어 동기화는 계속 진행.
    console.warn('[health-sync] WorkoutRoute auth 실패 (플러그인 미빌드 가능):', e);
  }

  // iOS 는 보안상 readDenied 도 readAuthorized 처럼 보고하지 않을 수 있어 (앱이 미허용을 알 수 없게)
  // 완벽한 detection 은 불가능. 다만 plugin 의 checkAuthorization 가 가능한 정보를 뽑아줌.
  try {
    const status = await withTimeout(
      Health.checkAuthorization({ read: HEALTH_READ_TYPES, write: [] }),
      5000,
      'Health.checkAuthorization',
    );
    const authorized = (status.readAuthorized?.length ?? 0) > 0;
    return { authorized, denied: status.readDenied ?? [] };
  } catch {
    // checkAuthorization 자체가 실패하면 권한이 있다고 가정 (다음 query 가 실제로 검증).
    return { authorized: true, denied: [] };
  }
}

// Apple Health 권한 요청만 수행 (사용자가 "연결하기" 버튼 누를 때).
export async function connectHealthKit(): Promise<SyncResult> {
  if (getPlatform() !== 'ios') {
    return { success: false, message: 'iOS가 아닙니다', synced: 0 };
  }

  try {
    const { Health } = await import('@capgo/capacitor-health');

    const { available } = await Health.isAvailable();
    if (!available) {
      return { success: false, message: '이 기기에서 Apple Health를 사용할 수 없습니다.', synced: 0 };
    }

    const { authorized, denied } = await ensureAuthorization();
    if (!authorized) {
      return {
        success: false,
        message: '설정 > 개인정보 보호 > 건강 > Routinist 에서 권한을 허용해주세요.',
        synced: 0,
        authDenied: true,
      };
    }

    const message = denied.length > 0
      ? `Apple Health 연결됨. 일부 항목 미허용 (${denied.join(', ')}) — 정확도가 떨어질 수 있어요.`
      : 'Apple Health 연결 완료! 러닝 기록을 가져오는 중...';
    return { success: true, message, synced: 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return { success: false, message: `연결 실패: ${message}`, synced: 0 };
  }
}

// 데이터 동기화 — activities 테이블에 저장.
// 성능 최적화: 90일 범위, workout 자체 집계값만 사용 (심박/칼로리 별도 루프 없음).
// build 255: mutex 25s timeout 의 원인을 식별하기 위한 stage tracker.
// inner sync 가 어느 단계에서 시간을 쓰는지 mutex timeout 발사 시 함께 로그.
// hans 2026-06-07 19:44 사례에서 5번 연속 timeout — 어떤 stage 가 25s 안에 못 끝나는지 알아야 fix 가능.
const syncStageState = new Map<string, { stage: string; enteredAt: number; allStarted: number }>();

async function syncFromHealthKit(userId: string, options?: SyncOptions): Promise<SyncResult> {
  const progress = options?.onProgress;
  progress?.({ stage: 'auth', percent: 5, label: '권한 확인 중...' });
  const t0 = Date.now();
  syncStageState.set(userId, { stage: 'auth', enteredAt: t0, allStarted: t0 });
  const setStage = (s: string) => {
    const st = syncStageState.get(userId);
    if (st) { st.stage = s; st.enteredAt = Date.now(); }
  };
  try {
    // 자동 sync 진입부에서도 권한을 보장 — connect 페이지를 거치지 않은 사용자도 정상 동작.
    const auth = await ensureAuthorization();
    setStage('after-auth');
    if (!auth.authorized) {
      logClientWarn('health-sync', 'authorization denied', { denied: auth.denied });
      return {
        success: false,
        message: '설정 > 개인정보 보호 > 건강 > Routinist 에서 권한을 허용해주세요.',
        synced: 0,
        authDenied: true,
      };
    }
    if (auth.denied.length > 0) {
      logClientWarn('health-sync', 'partial authorization', { denied: auth.denied });
    }

    const { Health } = await import('@capgo/capacitor-health');

    const startDt = new Date();
    startDt.setDate(startDt.getDate() - 90);
    const startDate = startDt.toISOString();
    const endDate = new Date().toISOString();

    progress?.({ stage: 'query', percent: 15, label: 'Apple Health 러닝 기록 조회 중...' });
    setStage('query-workouts');

    // 기본은 러닝만. 걷기는 연동 페이지 토글을 켠 사용자만 병렬 fetch (기본 OFF).
    const workoutTypes: ReadonlyArray<'running' | 'walking'> =
      isWalkingSyncEnabled() ? ['running', 'walking'] : ['running'];
    const queryErrors: string[] = [];
    const queryResults = await Promise.all(workoutTypes.map(async (wType) => {
      try {
        const { workouts } = await withTimeout(
          Health.queryWorkouts({
            workoutType: wType,
            startDate,
            endDate,
            limit: 500,
            ascending: false,
          }),
          15000,
          `queryWorkouts(${wType})`,
        );
        const count = workouts?.length ?? 0;
        logClientInfo('health-sync', `queryWorkouts(${wType}) → ${count}건`, { count, range_days: 90 });
        return count > 0 ? workouts.map(w => ({ ...w, _type: wType })) : [];
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logClientError('health-sync', `queryWorkouts(${wType}) 실패`, { wType, err: msg });
        queryErrors.push(`${wType}: ${msg}`);
        return [];
      }
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allWorkouts: any[] = queryResults.flat();

    if (allWorkouts.length === 0) {
      logClientWarn('health-sync', 'no workouts in 90d, distance fallback', { queryErrors });
      const fallback = await syncViaDistance(userId, startDate, endDate);
      if (!fallback.success && queryErrors.length === workoutTypes.length) {
        return { success: false, message: `Apple Health 조회 실패: ${queryErrors[0]}`, synced: 0 };
      }
      return fallback;
    }

    progress?.({ stage: 'fetch_existing', percent: 50, label: '중복 검사 중...' });
    setStage('fetch-existing');

    // 배치 중복 체크 — started_at ±60초 윈도우 매칭 (1순위) + 거리 폴백 (옛 데이터에 started_at 없을 때).
    // build 222 #1: 모든 source 비교 (이전엔 .eq('source','health_kit') 로 같은 워크아웃이 source='gps'
    // 로 이미 저장돼 있어도 Apple Health 가 다시 INSERT 해서 중복 적립되던 버그).
    // 윈도우: ±5s → ±60s (Routinist GPS 저장 시점과 Apple Health 기록 시점 간 clock skew 흡수).
    // 핵심 회복 (build 56): supabase 호출에 명시적 10s timeout. SDK 큐 락 / stale token 으로 인해
    // 영영 응답 안 오던 케이스 (build 53/54/55 의 "50% 멈춤") 차단.
    const supabase = getSupabase();
    const existingResult = await withTimeout(
      supabase
        .from('activities')
        .select('id, started_at, activity_date, distance_km, source')
        .eq('user_id', userId)
        .gte('activity_date', startDate.slice(0, 10)),
      10000,
      'fetch_existing select',
    ).catch((e: unknown) => {
      logClientError('health-sync', 'fetch_existing 실패', {
        err: e instanceof Error ? e.message : String(e),
      });
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } } as const;
    });
    const existingAll = existingResult.data;
    if (existingResult.error) {
      // 중복 검사 못 하면 새 INSERT 시 unique 충돌 가능 → 안전하게 실패 처리.
      return {
        success: false,
        message: `중복 검사 실패: ${existingResult.error.message}. 잠시 후 다시 시도해주세요.`,
        synced: 0,
      };
    }

    // build 245 #15: 같은 started_at 윈도우에 source='gps' 행이 있을 때 Apple Health 가 더 정확한
    // 데이터라면 GPS 행을 덮어쓰기. 이전 로직은 GPS 가 먼저 박혀 있으면 Apple Health 를 무조건 dedup 으로
    // 스킵 → broken GPS (0.56km / 0.04km 같은 클립) 가 영원히 회복 안 됨.
    type ExistingRow = { id: string; ms: number; distance_km: number; source: string };
    const existingByTime: ExistingRow[] = [];
    // existingByDate 는 옛 데이터 (started_at NULL) 호환용 fallback. started_at 있는 행을
    // 여기 넣으면 같은 날 같은 거리 두 번 뛴 경우 두 번째가 false-positive 중복으로 스킵됨 (build 204 회귀).
    const existingByDateLegacy = new Map<string, number[]>();
    (existingAll ?? []).forEach((row: { id: string; started_at: string | null; activity_date: string; distance_km: number | string; source: string | null }) => {
      if (row.started_at) {
        existingByTime.push({
          id: row.id,
          ms: new Date(row.started_at).getTime(),
          distance_km: Number(row.distance_km),
          source: row.source ?? '',
        });
      } else {
        const arr = existingByDateLegacy.get(row.activity_date) ?? [];
        arr.push(Number(row.distance_km));
        existingByDateLegacy.set(row.activity_date, arr);
      }
    });
    existingByTime.sort((a, b) => a.ms - b.ms);

    const TOLERANCE_MS = 60_000;
    const findOverlap = (workoutMs: number): ExistingRow | null => {
      let lo = 0, hi = existingByTime.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (existingByTime[mid].ms < workoutMs - TOLERANCE_MS) lo = mid + 1;
        else hi = mid;
      }
      if (lo < existingByTime.length && existingByTime[lo].ms <= workoutMs + TOLERANCE_MS) {
        return existingByTime[lo];
      }
      return null;
    };

    let syncedCount = 0;
    let dupCount = 0;
    let upgradedCount = 0;
    let walkingFiltered = 0;
    let tooShortFiltered = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toInsert: Record<string, any>[] = [];
    // upgrade: 기존 gps 행을 health_kit 데이터로 덮어쓰기 (id 보존 → 사진/메모 유지)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toUpgrade: Array<{ id: string; data: Record<string, any> }> = [];

    for (const workout of allWorkouts) {
      const activityDate = toKstDate(workout.startDate);
      const distanceKm = workout.totalDistance ? workout.totalDistance / 1000 : 0;
      const durationSeconds = workout.duration ? Math.round(workout.duration) : null;
      const paceAvg = durationSeconds && distanceKm > 0
        ? Math.round(durationSeconds / distanceKm)
        : null;
      const activityType = workout._type === 'walking' ? 'walking' : 'running';

      if (distanceKm < 0.1) { tooShortFiltered++; continue; }
      if (activityType === 'walking' && distanceKm < 0.5) { walkingFiltered++; continue; }

      const workoutMs = new Date(workout.startDate).getTime();
      const overlap = findOverlap(workoutMs);
      if (overlap) {
        // upgrade 조건: 기존이 source='gps' 이고 health 와 의미 있는 차이가 있을 때.
        // build 255: 양방향 보정. 이전엔 (gps < health × 0.5 || health > gps + 1km) — GPS underreport
        // 만 회복. hans 2026-06-07 사례 (GPS=72km, Apple≈12km 추정) 같은 GPS overreport 는 dedup skip 됐음.
        // 이제 절대 차이 1km+ 또는 비율 0.5 미만 / 2 초과면 어느 쪽이든 broken 으로 판정.
        // health_kit / external / manual 행은 절대 덮어쓰지 않음 — 사용자가 직접 손댄 데이터 보호.
        const absDiffKm = Math.abs(overlap.distance_km - distanceKm);
        const ratio = distanceKm > 0 ? overlap.distance_km / distanceKm : 0;
        const isBrokenGps =
          overlap.source === 'gps' &&
          distanceKm > 0.5 &&
          (absDiffKm > 1 || ratio < 0.5 || ratio > 2);
        if (isBrokenGps) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const upgradeData: Record<string, any> = {
            distance_km: Math.round(distanceKm * 100) / 100,
            duration_seconds: durationSeconds && durationSeconds > 0 ? durationSeconds : null,
            pace_avg_sec_per_km: paceAvg,
            calories: workout.totalEnergyBurned ? Math.round(workout.totalEnergyBurned) : null,
            source: 'health_kit',
            started_at: workout.startDate,
            ended_at: workout.endDate || null,
            // build 250: broken gps 의 route_data 는 좌표 0개 또는 sparse 한 점들. 이걸 그대로 두면
            // syncRouteData 가 `.is('route_data', null)` 필터 때문에 매칭 못 함 → 영영 지도 안 채워짐.
            // NULL 로 reset 해서 직후 호출되는 syncRouteData 가 HKWorkoutRoute 데이터로 채우게 함.
            route_data: null,
            map_snapshot_url: null,
          };
          if (workout.totalEnergyBurned) upgradeData.active_energy_kcal = Math.round(workout.totalEnergyBurned);
          // memo 는 일부러 업데이트 안 함 — 사용자가 적은 메모 보호.
          toUpgrade.push({ id: overlap.id, data: upgradeData });
          // existingByTime 의 distance 도 갱신 — 다음 워크아웃 비교 정확성.
          overlap.distance_km = distanceKm;
          overlap.source = 'health_kit';
          continue;
        }
        dupCount++;
        continue;
      }

      // 2순위 (옛 데이터 호환): started_at NULL 인 옛 행과만 비교.
      const legacyDistances = existingByDateLegacy.get(activityDate) ?? [];
      if (legacyDistances.some(d => Math.abs(d - distanceKm) < 0.1)) { dupCount++; continue; }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const insertData: Record<string, any> = {
        user_id: userId,
        activity_date: activityDate,
        distance_km: Math.round(distanceKm * 100) / 100,
        duration_seconds: durationSeconds && durationSeconds > 0 ? durationSeconds : null,
        pace_avg_sec_per_km: paceAvg,
        calories: workout.totalEnergyBurned ? Math.round(workout.totalEnergyBurned) : null,
        source: 'health_kit',
        memo: `Apple Health ${activityType === 'walking' ? '걷기' : '러닝'} 동기화`,
        started_at: workout.startDate,
        ended_at: workout.endDate || null,
      };
      if (workout.totalEnergyBurned) insertData.active_energy_kcal = Math.round(workout.totalEnergyBurned);
      if (activityType === 'walking') {
        insertData.activity_type = 'walking';
        // DB 트리거 trg_block_legacy_walking 계약: source='health_kit' 걷기는 구버전 (≤288)
        // 재동기화로 간주해 조용히 drop 됨. opt-in 걷기는 health_kit_walk 로 보내야 저장됨.
        insertData.source = 'health_kit_walk';
      }

      toInsert.push(insertData);
      // binary search invariant — 새 행 추가 후 정렬 유지.
      existingByTime.push({ id: '__pending__', ms: workoutMs, distance_km: distanceKm, source: 'health_kit' });
      existingByTime.sort((a, b) => a.ms - b.ms);
    }

    setStage(`dedup-done(upgrade=${toUpgrade.length},insert=${toInsert.length})`);

    // UPGRADE 먼저 처리 (broken gps → health_kit 덮어쓰기).
    if (toUpgrade.length > 0) {
      setStage(`upgrade(${toUpgrade.length})`);
      for (const { id, data } of toUpgrade) {
        const r = await withTimeout(
          supabase.from('activities').update(data).eq('id', id),
          8000,
          `upgrade row[${id}]`,
        ).catch((e: unknown) => ({ error: { message: e instanceof Error ? e.message : String(e) } } as const));
        if (!r.error) upgradedCount++;
        else logClientWarn('health-sync', 'upgrade 실패', { activity_id: id, err: r.error.message });
      }
      logClientInfo('health-sync', 'gps → health_kit upgrade 완료', { upgraded: upgradedCount, attempted: toUpgrade.length });
    }

    let insertErrors = 0;
    const failedSamples: string[] = [];
    if (toInsert.length > 0) {
      progress?.({ stage: 'insert', percent: 60, label: `새 기록 ${toInsert.length}건 저장 중...` });
      setStage(`insert(${toInsert.length})`);
      // 100건씩 청크로 나눠 insert. 청크 단위 실패 시 row-by-row 폴백으로 정상 row 는 살림.
      // (트리거 1건 버그 때문에 99건이 같이 죽는 회귀 차단 — build 53 회고)
      const totalChunks = Math.ceil(toInsert.length / 100);
      for (let i = 0; i < toInsert.length; i += 100) {
        const chunkIdx = Math.floor(i / 100);
        const chunk = toInsert.slice(i, i + 100);
        const chunkResult = await withTimeout(
          supabase.from('activities').insert(chunk, { count: 'exact' }),
          15000,
          `insert chunk[${chunkIdx}]`,
        ).catch((e: unknown) => ({
          error: { message: e instanceof Error ? e.message : String(e) },
          count: null,
        } as const));
        const { error, count } = chunkResult;
        if (!error) {
          syncedCount += count ?? chunk.length;
        } else {
          logClientWarn('health-sync', 'insert chunk 실패 — row-by-row 폴백 시도', {
            chunk_idx: i, chunk_size: chunk.length, err: error.message,
          });
          for (let j = 0; j < chunk.length; j++) {
            const row = chunk[j];
            const rowResult = await withTimeout(
              supabase.from('activities').insert(row),
              8000,
              `insert row[${i + j}]`,
            ).catch((e: unknown) => ({
              error: { message: e instanceof Error ? e.message : String(e) },
            } as const));
            if (!rowResult.error) {
              syncedCount++;
            } else {
              insertErrors++;
              if (failedSamples.length < 3) failedSamples.push(`${row.activity_date}:${rowResult.error.message}`);
            }
          }
        }
        // chunk 진행률: 60 → 90 사이에 분배
        const chunkProgress = 60 + Math.round((30 * (chunkIdx + 1)) / totalChunks);
        progress?.({ stage: 'insert', percent: chunkProgress, label: `저장 중 ${syncedCount}/${toInsert.length}` });
      }
      if (insertErrors > 0) {
        logClientError('health-sync', 'row insert 실패 누적', {
          insert_errors: insertErrors, samples: failedSamples,
        });
      }
    } else {
      progress?.({ stage: 'insert', percent: 90, label: '새 기록 없음' });
    }

    const elapsedMs = Date.now() - t0;
    logClientInfo('health-sync', 'sync complete', {
      total_workouts: allWorkouts.length,
      duplicates_skipped: dupCount,
      upgraded_from_gps: upgradedCount,
      walking_filtered: walkingFiltered,
      too_short: tooShortFiltered,
      candidates: toInsert.length,
      inserted: syncedCount,
      insert_errors: insertErrors,
      elapsed_ms: elapsedMs,
    });

    // 누락 detection — 받아온 워크아웃 N건 중 새로 저장된 건 + 중복 건 합이 N 보다 작으면 어딘가에서 빠짐
    const accounted = syncedCount + dupCount + upgradedCount + walkingFiltered + tooShortFiltered;
    if (accounted < allWorkouts.length) {
      logClientWarn('health-sync', 'accounting mismatch', {
        total: allWorkouts.length,
        accounted,
        missing: allWorkouts.length - accounted,
      });
    }

    // 메시지 분기: insert 실패가 있으면 "이미 동기화됨" 잘못된 메시지 금지.
    // (build 53 회고: trigger SQL 버그로 candidate=1, inserted=0, errors=1 인데 "이미 동기화됨" 표시됐던 회귀)
    let message: string;
    let success = true;
    if (insertErrors > 0 && syncedCount === 0) {
      success = false;
      message = `${insertErrors}건이 저장되지 못했어요\n잠시 후 다시 시도해주세요`;
    } else if (insertErrors > 0) {
      message = `${syncedCount}건 가져왔어요 (${insertErrors}건은 다음에)`;
    } else if (syncedCount > 0 && upgradedCount > 0) {
      message = `러닝 ${syncedCount}건 도착 · ${upgradedCount}건 거리 보정 ✨`;
    } else if (syncedCount > 0) {
      message = `러닝 ${syncedCount}건 새로 도착! 🎉`;
    } else if (upgradedCount > 0) {
      message = `${upgradedCount}건 GPS 거리를 Apple Watch 기준으로 보정했어요 ✨`;
    } else if (toInsert.length === 0) {
      message = '최신 상태예요. 오늘도 가볍게 한 바퀴? 👟';
    } else {
      // candidates 가 있는데 syncedCount=0 이고 errors=0 인 비정상 경로
      message = '동기화 결과 확인이 안 됐어요\n잠시 후 다시 시도해주세요';
      success = false;
    }

    return {
      success,
      message,
      synced: syncedCount + upgradedCount,
      meta: {
        totalFromHealth: allWorkouts.length,
        duplicates: dupCount,
        candidates: toInsert.length,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    logClientError('health-sync', 'sync 예외', { err: message });
    return { success: false, message: `동기화 중에 문제가 생겼어요\n${message}`, synced: 0 };
  }
}

// 워크아웃이 없을 때만 폴백 — 거리 데이터 일별 합산.
async function syncViaDistance(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<SyncResult> {
  try {
    const { Health } = await import('@capgo/capacitor-health');

    const { samples } = await Health.readSamples({
      dataType: 'distance',
      startDate,
      endDate,
      limit: 10000,
    });

    if (!samples || samples.length === 0) {
      return { success: true, message: 'Apple Health 에 러닝 기록이 아직 없어요 👟', synced: 0 };
    }

    const dailyDistance: Record<string, number> = {};
    for (const sample of samples) {
      const date = toKstDate(sample.startDate);
      const distanceKm = sample.value / 1000;
      dailyDistance[date] = (dailyDistance[date] || 0) + distanceKm;
    }

    const supabase = getSupabase();

    // 배치 dedup — 이전엔 일별로 N+1 쿼리 (90일이면 90번 라운드트립). 한 번에 가져와서 Map 비교.
    const startDateOnly = startDate.slice(0, 10);
    const endDateOnly = endDate.slice(0, 10);
    const { data: existingAll } = await supabase
      .from('activities')
      .select('activity_date, distance_km')
      .eq('user_id', userId)
      .eq('source', 'health_kit')
      .gte('activity_date', startDateOnly)
      .lte('activity_date', endDateOnly);

    const existingByDate = new Map<string, number[]>();
    (existingAll ?? []).forEach(row => {
      const arr = existingByDate.get(row.activity_date) ?? [];
      arr.push(Number(row.distance_km));
      existingByDate.set(row.activity_date, arr);
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toInsert: Record<string, any>[] = [];
    for (const [activityDate, distanceKm] of Object.entries(dailyDistance)) {
      if (distanceKm < 0.5) continue;
      const sameDate = existingByDate.get(activityDate) ?? [];
      const isDuplicate = sameDate.some(d => Math.abs(d - distanceKm) < 0.5);
      if (isDuplicate) continue;
      toInsert.push({
        user_id: userId,
        activity_date: activityDate,
        distance_km: Math.round(distanceKm * 100) / 100,
        source: 'health_kit',
        memo: 'Apple Health 자동 동기화 (일별 합산)',
      });
    }

    let syncedCount = 0;
    if (toInsert.length > 0) {
      // 100건씩 청크로 벌크 insert
      for (let i = 0; i < toInsert.length; i += 100) {
        const chunk = toInsert.slice(i, i + 100);
        const { error, count } = await supabase.from('activities').insert(chunk, { count: 'exact' });
        if (!error) syncedCount += count ?? chunk.length;
      }
    }

    return {
      success: true,
      message: syncedCount > 0
        ? `러닝 ${syncedCount}건 새로 도착! 🎉`
        : '최신 상태예요. 오늘도 가볍게 한 바퀴? 👟',
      synced: syncedCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return { success: false, message: `거리 합산 중에 문제가 생겼어요\n${message}`, synced: 0 };
  }
}

// 프로필 통산 집계 — SQL RPC 로 위임 (이전엔 모든 행 fetch 후 JS 합산).
async function updateProfileTotals(userId: string): Promise<void> {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.rpc('update_profile_totals', { p_user_id: userId });
    if (error) console.warn('[health-sync] update_profile_totals RPC 실패:', error.message);
  } catch (e) {
    console.error('프로필 통산 집계 갱신 실패:', e);
  }
}

export interface RouteSyncResult {
  fetched: number;
  matched: number;
  updated: number;
  partial?: boolean;
  reason?: string;
}

// 단일 시간 범위에 대한 GPS 경로 동기화 (1 chunk).
// 호출자: chunk wrapper (syncRouteData) 또는 audit 페이지의 명시적 range.
async function syncRouteDataRange(
  userId: string,
  startDate: Date,
  endDate: Date,
): Promise<RouteSyncResult> {
  const t0 = Date.now();
  try {
    const { WorkoutRoute } = await import('./workout-route');
    const supabase = getSupabase();

    try {
      await withTimeout(WorkoutRoute.requestAuthorization(), 20000, 'WorkoutRoute.requestAuthorization');
    } catch (e) {
      logClientWarn('health-sync-route', 'requestAuthorization 실패 (계속 진행)', { err: String(e) });
    }

    const pluginResult = await withTimeout(
      WorkoutRoute.getRoutes({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        limit: 500,
      }),
      45000,
      'WorkoutRoute.getRoutes',
    );
    const routes = pluginResult.routes;
    const isPartial = pluginResult.partial === true;
    const partialReason = pluginResult.reason;

    const fetched = routes?.length ?? 0;
    logClientInfo('health-sync-route', `WorkoutRoute.getRoutes → ${fetched}건`, {
      fetched,
      partial: isPartial,
      partial_reason: partialReason,
      range_days: Math.round((endDate.getTime() - startDate.getTime()) / 86400000),
    });

    if (fetched === 0) {
      return {
        fetched: 0,
        matched: 0,
        updated: 0,
        partial: isPartial || undefined,
        reason: isPartial ? `partial:${partialReason ?? 'unknown'}` : 'no_routes_from_plugin',
      };
    }

    let matchedCount = 0;
    let updatedCount = 0;

    for (const route of routes) {
      const routeStartMs = new Date(route.startDate).getTime();

      // 1순위: started_at ±60초 윈도우 매칭.
      // build 245 #15 회귀 fix: 이전 코드는 SQL 로 ±60s 범위 select 한 뒤 JS find 에서
      // .toISOString().slice(0,19) 로 "초 단위 정확히 일치" 비교 → 5초만 어긋나도 매칭 실패.
      // Apple Watch route 의 startDate 와 workout.startDate 가 ms 단위로 다를 수 있어
      // 의도된 ±60s tolerance 가 실질적으로 0초로 줄어들던 버그. ms 차이로 비교하도록 교정.
      // build 250: `.is('route_data', null)` 만 쓰면 빈 LineString ({type:LineString,coordinates:[]})
      // 행이 매칭에서 제외됨. live GPS 트래킹 시작 시 page.tsx 가 빈 LineString 으로 row 를 생성하므로
      // 좌표 0 으로 종료된 broken 운동 (hans 2026-06-05 사례) 이 영영 지도 못 채워짐. JS 측에서
      // null OR coordinates=[] 인 후보를 모두 매칭 가능하게 가져오고, 아래 filter 에서 가린다.
      const isRouteEmpty = (rd: unknown): boolean => {
        if (rd == null) return true;
        if (typeof rd !== 'object') return false;
        const coords = (rd as { coordinates?: unknown[] }).coordinates;
        return Array.isArray(coords) && coords.length === 0;
      };

      const { data: byTime } = await supabase
        .from('activities')
        .select('id, started_at, route_data')
        .eq('user_id', userId)
        .gte('started_at', new Date(routeStartMs - 60_000).toISOString())
        .lte('started_at', new Date(routeStartMs + 60_000).toISOString());

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let match: any = (byTime ?? []).find((r: { started_at: string | null; route_data: unknown }) =>
        r.started_at &&
        Math.abs(new Date(r.started_at).getTime() - routeStartMs) <= 60_000 &&
        isRouteEmpty(r.route_data)
      );

      // 2순위: 같은 날짜 + 거리 ±0.5km — started_at 있는 행도 OK 로 확장
      // (이전엔 started_at NULL 만 매칭해서 health_kit 행은 1순위에서 빠지면 영영 매칭 안 됨)
      // build 245 #15: source='health_kit' 또는 'gps' 행이 단 1건만 있는 날은 거리 무시하고 매칭.
      // (broken GPS 0.56km vs route 7.34km 같은 케이스에서도 route 가 붙도록.)
      if (!match) {
        const activityDate = toKstDate(route.startDate);
        const distanceKm = route.distance / 1000;
        const { data: byDateAll } = await supabase
          .from('activities')
          .select('id, distance_km, started_at, route_data, source')
          .eq('user_id', userId)
          .eq('activity_date', activityDate);

        // build 250: NULL 뿐 아니라 빈 LineString 행도 후보로 포함.
        const byDate = (byDateAll ?? []).filter((e: { route_data: unknown }) => isRouteEmpty(e.route_data));

        match = byDate.find(
          (e: { distance_km: number | string }) => Math.abs(Number(e.distance_km) - distanceKm) < 0.5
        );
        // 거리 매칭 실패 + 같은 날 후보가 단 1건이면 거리 무시하고 매칭 (broken GPS 회복).
        // build 256: ratio 가 명백히 동떨어진 경우 (오늘 사고: 30.61km activity 에 0.83km route 가
        // 36배 차이로 매칭됨) 차단. broken GPS 회복은 0.5~5km vs 5~10km 정도의 차이를 의미한
        // 거지, 0.83km vs 30.61km 같은 다른 운동을 합치라는 게 아님. ratio 0.2~5 (5배 안) 만 허용.
        if (!match && byDate.length === 1) {
          const activityKm = Number(byDate[0].distance_km);
          const ratio = activityKm > 0 ? distanceKm / activityKm : 0;
          if (ratio >= 0.2 && ratio <= 5) {
            match = byDate[0];
            logClientInfo('health-sync-route', 'byDate single-candidate fallback', {
              activity_id: match.id, route_km: distanceKm, activity_km: activityKm, ratio,
            });
          } else {
            logClientWarn('health-sync-route', 'byDate single skipped — distance mismatch', {
              activity_id: byDate[0].id, route_km: distanceKm, activity_km: activityKm,
              ratio: Math.round(ratio * 1000) / 1000,
            });
          }
        }
      }

      if (match) {
        matchedCount++;
        // build 217: route.distance 가 매칭 활동의 distance_km 보다 의미있게 크면 함께 보정.
        // Apple Watch 부분 sync 시 workout.totalDistance 가 GPS route 실측보다 작은 경우 (윤현수 5/29 사례).
        // build 225: 임계값 0.3km/15% → 0.2km/8% 완화. Routinist iPhone GPS 가 Apple Watch 대비
        // 평균 km 당 ~150~200m underreport (hans 5/31 사례 19.12 vs 23.03 = 17%). 8% 임계값이면
        // 도심 빌딩가의 의미있는 차이를 모두 잡음. log 에 from/to 누적해 사후 분석 가능.
        const routeDistKm = (route.distance ?? 0) / 1000;
        const matchDistKm = Number(match.distance_km) || 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updates: Record<string, any> = {
          route_data: {
            type: 'LineString',
            coordinates: route.coordinates,
          },
        };
        const shouldFixDistance =
          routeDistKm > 0.5 &&
          (routeDistKm - matchDistKm > 0.2 || routeDistKm > matchDistKm * 1.08);
        if (shouldFixDistance) {
          updates.distance_km = Math.round(routeDistKm * 100) / 100;
          // pace 재계산 — duration 이 있으면.
          const { data: rich } = await supabase
            .from('activities')
            .select('duration_seconds')
            .eq('id', match.id)
            .single();
          const dur = rich?.duration_seconds;
          if (dur && dur > 0) {
            updates.pace_avg_sec_per_km = Math.round(dur / routeDistKm);
          }
          logClientInfo('health-sync-route', 'distance 보정', {
            activity_id: match.id,
            from_km: matchDistKm,
            to_km: routeDistKm,
          });
        }
        const { error } = await supabase
          .from('activities')
          .update(updates)
          .eq('id', match.id);

        if (!error) updatedCount++;
        else logClientWarn('health-sync-route', 'route update 실패', { activity_id: match.id, err: error.message });
      }
    }

    const elapsedMs = Date.now() - t0;
    logClientInfo('health-sync-route', 'route sync complete', {
      fetched, matched: matchedCount, updated: updatedCount, elapsed_ms: elapsedMs, partial: isPartial,
    });
    return {
      fetched,
      matched: matchedCount,
      updated: updatedCount,
      partial: isPartial || undefined,
      reason: isPartial ? `partial:${partialReason ?? 'unknown'}` : undefined,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logClientError('health-sync-route', 'syncRouteData 예외', { err: msg });
    return { fetched: 0, matched: 0, updated: 0, reason: msg };
  }
}

// 공개 entry point — daysBack 숫자면 자동 30일 chunk 분할 (native plugin 50s timeout 회피).
// 명시적 range 전달 시엔 그 범위 그대로 단일 호출 (audit 페이지의 6개월 chunk 호출 호환).
//
// 배경: 90일 한방 호출 시 마라톤급(20~38km, 좌표 수만 점) 활동이 다수면 native plugin 50s
// safety timeout 으로 partial 결과만 반환 → 최근 routes 가 누락되는 회귀 (hans 2026-06 해외 13건 중 12건 누락).
// 30일 chunk 면 한국 routes(이미 매칭됨)와 해외 routes 가 분리되어 각 chunk 50s 안에 마무리됨.
//
// partial 결과 받으면 그 chunk 를 절반으로 나눠 1회 재시도. 그래도 partial 면 그냥 종료 (다음 자동 sync 가 또 시도).
export async function syncRouteData(
  userId: string,
  daysBackOrOptions: number | { startDate: Date; endDate: Date } = 90,
): Promise<RouteSyncResult> {
  // 명시적 range — 호출자가 chunk 분할 책임 (audit 페이지). 단일 호출.
  if (typeof daysBackOrOptions === 'object') {
    return syncRouteDataRange(userId, daysBackOrOptions.startDate, daysBackOrOptions.endDate);
  }

  const daysBack = daysBackOrOptions;
  const CHUNK_DAYS = 30;
  const now = new Date();
  let totalFetched = 0;
  let totalMatched = 0;
  let totalUpdated = 0;
  let anyPartial = false;
  const reasons: string[] = [];
  // 연속 fetched=0 chunk 가 2번이면 옛 데이터 끝났다고 보고 조기 종료 (불필요한 plugin 호출 절감).
  let zeroStreak = 0;

  for (let offset = 0; offset < daysBack; offset += CHUNK_DAYS) {
    const days = Math.min(CHUNK_DAYS, daysBack - offset);
    const chunkEnd = new Date(now);
    chunkEnd.setDate(chunkEnd.getDate() - offset);
    const chunkStart = new Date(now);
    chunkStart.setDate(chunkStart.getDate() - (offset + days));

    try {
      let r = await syncRouteDataRange(userId, chunkStart, chunkEnd);

      // partial 이면 chunk 를 반으로 나눠 1회 재시도 — 좌표 점이 많은 마라톤 chunk 가 50s 넘기는 경우.
      if (r.partial && days > 7) {
        const midMs = chunkStart.getTime() + (chunkEnd.getTime() - chunkStart.getTime()) / 2;
        const mid = new Date(midMs);
        logClientWarn('health-sync-route', 'partial → split retry', {
          offset, days, mid: mid.toISOString(),
        });
        // 신선한 쪽 (mid~end) 부터 — 보통 부족한 매칭이 최근 활동.
        const r1 = await syncRouteDataRange(userId, mid, chunkEnd);
        const r2 = await syncRouteDataRange(userId, chunkStart, mid);
        r = {
          fetched: r1.fetched + r2.fetched,
          matched: r1.matched + r2.matched,
          updated: r1.updated + r2.updated,
          partial: r1.partial || r2.partial,
          reason: [r1.reason, r2.reason].filter(Boolean).join('; ') || undefined,
        };
      }

      totalFetched += r.fetched;
      totalMatched += r.matched;
      totalUpdated += r.updated;
      if (r.partial) anyPartial = true;
      if (r.reason) reasons.push(`${offset}-${offset + days}d: ${r.reason}`);

      if (r.fetched === 0) {
        zeroStreak++;
        if (zeroStreak >= 2) break;
      } else {
        zeroStreak = 0;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      reasons.push(`${offset}-${offset + days}d: ${msg}`);
    }
  }

  logClientInfo('health-sync-route', 'chunked route sync complete', {
    days_back: daysBack,
    chunk_days: CHUNK_DAYS,
    total_fetched: totalFetched,
    total_matched: totalMatched,
    total_updated: totalUpdated,
    any_partial: anyPartial,
  });

  return {
    fetched: totalFetched,
    matched: totalMatched,
    updated: totalUpdated,
    partial: anyPartial || undefined,
    reason: reasons.length > 0 ? reasons.slice(0, 3).join('; ') : undefined,
  };
}

// 메인 동기화 함수 — userId(auth.users id)를 받음
// 사용자가 보는 spinner 는 핵심 워크아웃 동기화만 기다림.
// 통산 집계 갱신과 GPS 경로 매칭은 백그라운드로 분리해 즉각 응답.
//
// Mutex (2026-05-07): layout / dashboard PullToRefresh / map mount 가 동시에 호출하면
// 같은 워크아웃이 중복 insert 될 위험 (in-memory dedup cache 가 unsorted 인 상태에서 binary search miss)
// → 같은 userId 의 in-flight promise 가 있으면 그 promise 를 그대로 반환해 단일 실행 보장.
const inFlightSyncs = new Map<string, Promise<SyncResult>>();

export async function syncHealthData(userId: string, options?: SyncOptions): Promise<SyncResult> {
  if (!isNativeApp()) {
    return {
      success: false,
      message: '건강 데이터 동기화는 Routinist 앱에서만 사용할 수 있습니다.',
      synced: 0,
    };
  }

  if (getPlatform() !== 'ios') {
    return { success: false, message: '지원하지 않는 플랫폼입니다.', synced: 0 };
  }

  const existing = inFlightSyncs.get(userId);
  if (existing) {
    logClientInfo('health-sync', 'mutex hit — 동시 호출 합치기', {});
    return existing;
  }

  // Mutex 안전망: 내부 sync 가 어떤 이유로 hang 해도 60s 후 강제로 mutex 해제 + timeout 결과 반환.
  // 이전엔 hang 한 promise 가 Map 에 영구 보관되어 후속 모든 sync 가 차단되는 버그.
  const inner = (async () => {
    const result = await syncFromHealthKit(userId, options);

    // 권한 거부 케이스에선 후처리 의미 없음.
    if (!result.authDenied) {
      options?.onProgress?.({ stage: 'route', percent: 95, label: 'GPS 경로 백그라운드 동기화...' });
      void updateProfileTotals(userId).catch((e) => console.warn('[health-sync] updateProfileTotals 백그라운드 실패', e));
      // syncRouteData 가 끝난 후에 region 자동 등록 — route_data 가 채워진 활동이 필요.
      void syncRouteData(userId)
        .then(() => import('./profile-region-auto').then(m => m.autoDetectAndSetRegion(userId)).catch(() => null))
        .catch((e) => console.warn('[health-sync] syncRouteData / region 백그라운드 실패', e));
    }

    options?.onProgress?.({ stage: 'done', percent: 100, label: '완료' });
    return result;
  })();

  // build 56: mutex timeout 60s → 25s (UX).
  // build 255: 25s → 35s. hans 2026-06-07 5번 연속 timeout — 90일치 워크아웃 1000건+ 의
  // queryWorkouts + fetch_existing + dedup 합산이 25s 빠듯할 수 있음. 35s 로 여유.
  // 또 timeout 발사 시 syncStageState 의 현재 stage 도 함께 로그 — 어느 단계에서 막혔는지 식별.
  // build 256: inner 가 정상 완료해도 setTimeout 이 살아 있어 35s 후 timeout 로그 noise.
  //   clearTimeout 으로 해제. stage:unknown ms_total:0 같은 false-positive 차단.
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const safetyTimeout = new Promise<SyncResult>((resolve) => {
    timeoutHandle = setTimeout(() => {
      const st = syncStageState.get(userId);
      const stageInfo = st
        ? { stage: st.stage, ms_in_stage: Date.now() - st.enteredAt, ms_total: Date.now() - st.allStarted }
        : { stage: 'unknown', ms_in_stage: 0, ms_total: 0 };
      logClientWarn('health-sync', 'mutex 35s timeout — 강제 해제 + client 재생성', stageInfo);
      // SDK 락 가능성 있는 client 폐기 — 다음 호출 시 fresh client 로 복구.
      void import('./supabase').then(({ resetSupabaseClient }) => resetSupabaseClient()).catch(() => {});
      resolve({ success: false, message: '동기화가 너무 오래 걸리네요\n잠시 후 다시 시도해주세요', synced: 0 });
    }, 35000);
  });

  const guarded = Promise.race([inner, safetyTimeout]);
  inFlightSyncs.set(userId, guarded);
  try {
    return await guarded;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    inFlightSyncs.delete(userId);
    syncStageState.delete(userId);
  }
}
