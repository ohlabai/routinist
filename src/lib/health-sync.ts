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
async function syncFromHealthKit(userId: string, options?: SyncOptions): Promise<SyncResult> {
  const progress = options?.onProgress;
  progress?.({ stage: 'auth', percent: 5, label: '권한 확인 중...' });
  const t0 = Date.now();
  try {
    // 자동 sync 진입부에서도 권한을 보장 — connect 페이지를 거치지 않은 사용자도 정상 동작.
    const auth = await ensureAuthorization();
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

    // 러닝 + 걷기 병렬 fetch
    const workoutTypes = ['running', 'walking'] as const;
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

    // 배치 중복 체크 — started_at ±5초 윈도우 매칭 (1순위) + 거리 폴백 (옛 데이터에 started_at 없을 때).
    // ±5초 윈도우 = Apple Health 가 sub-second 차이로 timestamp 를 줄 수 있음 + 옛 동기화는 ms 잘려 들어갔을 수도.
    //
    // 핵심 회복 (build 56): supabase 호출에 명시적 10s timeout. SDK 큐 락 / stale token 으로 인해
    // 영영 응답 안 오던 케이스 (build 53/54/55 의 "50% 멈춤") 차단.
    const supabase = getSupabase();
    const existingResult = await withTimeout(
      supabase
        .from('activities')
        .select('started_at, activity_date, distance_km')
        .eq('user_id', userId)
        .eq('source', 'health_kit')
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

    const existingStartedAtMs: number[] = [];
    const existingByDate = new Map<string, number[]>();
    (existingAll ?? []).forEach(row => {
      if (row.started_at) {
        existingStartedAtMs.push(new Date(row.started_at).getTime());
      }
      const arr = existingByDate.get(row.activity_date) ?? [];
      arr.push(Number(row.distance_km));
      existingByDate.set(row.activity_date, arr);
    });
    existingStartedAtMs.sort((a, b) => a - b);

    const TOLERANCE_MS = 5000;
    const isDuplicateByTime = (workoutMs: number): boolean => {
      // 정렬된 배열에서 binary search 로 ±5초 안에 있는지 검사 (활동 수 많아질수록 효과 큼)
      let lo = 0, hi = existingStartedAtMs.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (existingStartedAtMs[mid] < workoutMs - TOLERANCE_MS) lo = mid + 1;
        else hi = mid;
      }
      return lo < existingStartedAtMs.length && existingStartedAtMs[lo] <= workoutMs + TOLERANCE_MS;
    };

    let syncedCount = 0;
    let dupCount = 0;
    let walkingFiltered = 0;
    let tooShortFiltered = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toInsert: Record<string, any>[] = [];

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

      // 1순위: started_at ±5초 매칭
      const workoutMs = new Date(workout.startDate).getTime();
      if (isDuplicateByTime(workoutMs)) { dupCount++; continue; }

      // 2순위 (옛 데이터 호환): 같은 날짜 + 거리 ±0.1km
      const sameDateDistances = existingByDate.get(activityDate) ?? [];
      if (sameDateDistances.some(d => Math.abs(d - distanceKm) < 0.1)) { dupCount++; continue; }

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
      if (activityType === 'walking') insertData.activity_type = 'walking';

      toInsert.push(insertData);
      // 중복 검출용 캐시 업데이트
      existingStartedAtMs.push(workoutMs);
      // (정렬 비용 아끼려고 매번 sort 안 함 — 한 sync 안에서 두 번 같은 timestamp 거의 없음)
      sameDateDistances.push(distanceKm);
      existingByDate.set(activityDate, sameDateDistances);
    }

    let insertErrors = 0;
    const failedSamples: string[] = [];
    if (toInsert.length > 0) {
      progress?.({ stage: 'insert', percent: 60, label: `새 기록 ${toInsert.length}건 저장 중...` });
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
      walking_filtered: walkingFiltered,
      too_short: tooShortFiltered,
      candidates: toInsert.length,
      inserted: syncedCount,
      insert_errors: insertErrors,
      elapsed_ms: elapsedMs,
    });

    // 누락 detection — 받아온 워크아웃 N건 중 새로 저장된 건 + 중복 건 합이 N 보다 작으면 어딘가에서 빠짐
    const accounted = syncedCount + dupCount + walkingFiltered + tooShortFiltered;
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
    } else if (syncedCount > 0) {
      message = `러닝 ${syncedCount}건 새로 도착! 🎉`;
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
      synced: syncedCount,
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

// GPS 경로 동기화 — started_at 매칭 (1순위) + 거리/날짜 폴백.
// audit 페이지에서 명시적 trigger 가능하도록 export.
// daysBack: 동기화 범위 (기본 90일, audit 페이지/맵 fallback 은 1095일=3년 까지 확장 가능)
export async function syncRouteData(
  userId: string,
  daysBackOrOptions: number | { startDate: Date; endDate: Date } = 90,
): Promise<{ fetched: number; matched: number; updated: number; reason?: string }> {
  const t0 = Date.now();
  try {
    const { WorkoutRoute } = await import('./workout-route');
    const supabase = getSupabase();

    try {
      await withTimeout(WorkoutRoute.requestAuthorization(), 20000, 'WorkoutRoute.requestAuthorization');
    } catch (e) {
      logClientWarn('health-sync-route', 'requestAuthorization 실패 (계속 진행)', { err: String(e) });
    }

    // build 59: 시그니처 확장 — 호출자가 정확한 startDate/endDate 지정 가능. audit 의 chunk 분할이
    // 의미 있게 작동하도록 (이전엔 daysBack 한 인자라 chunk 마다 0~N일 으로 중복 호출되던 버그).
    let startDate: Date;
    let endDate: Date;
    if (typeof daysBackOrOptions === 'number') {
      endDate = new Date();
      startDate = new Date();
      startDate.setDate(startDate.getDate() - daysBackOrOptions);
    } else {
      startDate = daysBackOrOptions.startDate;
      endDate = daysBackOrOptions.endDate;
    }

    const { routes } = await withTimeout(
      WorkoutRoute.getRoutes({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        limit: 500,
      }),
      45000,
      'WorkoutRoute.getRoutes',
    );

    const fetched = routes?.length ?? 0;
    logClientInfo('health-sync-route', `WorkoutRoute.getRoutes → ${fetched}건`, { fetched });

    if (fetched === 0) {
      return { fetched: 0, matched: 0, updated: 0, reason: 'no_routes_from_plugin' };
    }

    let matchedCount = 0;
    let updatedCount = 0;

    for (const route of routes) {
      const routeStartMs = new Date(route.startDate).getTime();
      const startedAtKey = new Date(route.startDate).toISOString().slice(0, 19);

      // 1순위: started_at ±60초 윈도우에서 정확 매칭
      const { data: byTime } = await supabase
        .from('activities')
        .select('id, started_at, route_data')
        .eq('user_id', userId)
        .gte('started_at', new Date(routeStartMs - 60_000).toISOString())
        .lte('started_at', new Date(routeStartMs + 60_000).toISOString())
        .is('route_data', null);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let match: any = (byTime ?? []).find(r =>
        r.started_at && new Date(r.started_at).toISOString().slice(0, 19) === startedAtKey
      );

      // 2순위: 같은 날짜 + 거리 ±0.5km — started_at 있는 행도 OK 로 확장
      // (이전엔 started_at NULL 만 매칭해서 health_kit 행은 1순위에서 빠지면 영영 매칭 안 됨)
      if (!match) {
        const activityDate = toKstDate(route.startDate);
        const distanceKm = route.distance / 1000;
        const { data: byDate } = await supabase
          .from('activities')
          .select('id, distance_km, started_at, route_data')
          .eq('user_id', userId)
          .eq('activity_date', activityDate)
          .is('route_data', null);

        match = (byDate ?? []).find(
          (e) => Math.abs(Number(e.distance_km) - distanceKm) < 0.5
        );
      }

      if (match) {
        matchedCount++;
        const { error } = await supabase
          .from('activities')
          .update({
            route_data: {
              type: 'LineString',
              coordinates: route.coordinates,
            },
          })
          .eq('id', match.id);

        if (!error) updatedCount++;
        else logClientWarn('health-sync-route', 'route update 실패', { activity_id: match.id, err: error.message });
      }
    }

    const elapsedMs = Date.now() - t0;
    logClientInfo('health-sync-route', 'route sync complete', { fetched, matched: matchedCount, updated: updatedCount, elapsed_ms: elapsedMs });
    return { fetched, matched: matchedCount, updated: updatedCount };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logClientError('health-sync-route', 'syncRouteData 예외', { err: msg });
    return { fetched: 0, matched: 0, updated: 0, reason: msg };
  }
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
      void syncRouteData(userId).catch((e) => console.warn('[health-sync] syncRouteData 백그라운드 실패', e));
    }

    options?.onProgress?.({ stage: 'done', percent: 100, label: '완료' });
    return result;
  })();

  // mutex timeout 단축 (build 56): 60s → 25s. 60s 동안 사용자 화면이 멈춘 채 기다리는 UX 가 너무 안 좋고,
  // 모든 supabase call 에 자체 timeout (8~15s) 이 걸려 있어 25s 안에 끝나야 정상.
  // 25s 초과시 자동으로 supabase client 재생성 — stale 상태 누적 방지.
  const safetyTimeout = new Promise<SyncResult>((resolve) =>
    setTimeout(() => {
      logClientWarn('health-sync', 'mutex 25s timeout — 강제 해제 + client 재생성', {});
      // SDK 락 가능성 있는 client 폐기 — 다음 호출 시 fresh client 로 복구.
      void import('./supabase').then(({ resetSupabaseClient }) => resetSupabaseClient()).catch(() => {});
      resolve({ success: false, message: '동기화가 너무 오래 걸리네요\n잠시 후 다시 시도해주세요', synced: 0 });
    }, 25000)
  );

  const guarded = Promise.race([inner, safetyTimeout]);
  inFlightSyncs.set(userId, guarded);
  try {
    return await guarded;
  } finally {
    inFlightSyncs.delete(userId);
  }
}
