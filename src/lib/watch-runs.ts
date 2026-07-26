// 갤럭시 워치(:wear) 완주 러닝 드레인.
//
// Wear OS 에는 Health Connect 가 없어(폰에 WRITE 권한 재추가는 Play 헬스 재심사 리스크),
// 워치가 Wearable Data Layer 로 보낸 러닝을 폰의 WatchRunReceiverService(Kotlin)가
// Capacitor Preferences 큐(watch_pending_runs)에 쌓아둔다. 앱 포그라운드 시 이 함수가
// 큐를 읽어 기존 activities insert 플로우로 저장한다 (나이키·스트라바식 자체 저장소 직행).
//
// 저장 규약: source='gps' + is_native=true + memo='Galaxy Watch'
//  - activities_source_check CHECK 제약이 'watch' 를 막으므로 'gps' 사용 (마이그 불필요)
//  - is_native=true → health-sync 의 gps→health 덮어쓰기/route 거리보정 제외 (네이티브 측정 신뢰)
//  - INSERT 시 award_activity_milestones 트리거가 마일리지·스트릭·월간목표 자동 처리

import { Preferences } from '@capacitor/preferences';
import { getSupabase } from '@/lib/supabase';
import { logClientInfo, logClientWarn } from '@/lib/error-logger';

const QUEUE_KEY = 'watch_pending_runs';

interface PendingWatchRun {
  clientRecordId: string;
  startMs: number;
  endMs: number;
  distanceMeters: number;
  durationSec: number;
  calories: number;
  avgHr: number;
  route: number[][]; // [[lat, lng, alt, epochMs], ...]
}

// 사용자 timezone 기준 YYYY-MM-DD (KST 룰 — reference_timezone_handling).
// 시작 시각 기준 (23:50 출발 00:20 저장이 다음날로 안 찍히게). TrackSummarySheet 와 동일.
function todayLocal(atMs: number): string {
  const base = new Date(atMs);
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(base);
  } catch {
    const kst = new Date(base.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
  }
}

async function readQueue(): Promise<PendingWatchRun[]> {
  try {
    const { value } = await Preferences.get({ key: QUEUE_KEY });
    if (!value) return [];
    const arr = JSON.parse(value);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function removeFromQueue(processedIds: Set<string>): Promise<void> {
  // 드레인 중 워치가 새 러닝을 넣었을 수 있으므로, 저장 성공한 id 만 제거하고 나머지는 보존.
  const current = await readQueue();
  const remaining = current.filter((r) => !processedIds.has(r.clientRecordId));
  if (remaining.length === current.length) return;
  await Preferences.set({ key: QUEUE_KEY, value: JSON.stringify(remaining) });
}

/**
 * pending 워치 러닝을 activities 로 저장. 앱 포그라운드/로그인 시 호출.
 * @returns 저장(또는 이미 존재로 스킵)한 건수
 */
export async function drainWatchRuns(userId: string): Promise<number> {
  if (!userId) return 0;
  const queue = await readQueue();
  if (queue.length === 0) return 0;

  logClientInfo('watch-run', 'drain-start', { pending: queue.length });
  const supabase = getSupabase();
  const done = new Set<string>();

  for (const run of queue) {
    try {
      const startedAt = new Date(run.startMs).toISOString();
      const endedAt = new Date(run.endMs).toISOString();
      const distanceMeters = Math.max(0, run.distanceMeters || 0);
      const durationSeconds = Math.max(0, Math.floor(run.durationSec || 0));
      const km = distanceMeters / 1000;
      const paceAvgSec = km > 0 && durationSeconds > 0 ? Math.round(durationSeconds / km) : null;
      const cal = run.calories > 0 ? Math.round(run.calories) : Math.round(km * 60);

      // 워치 route [lat,lng,alt,ms] → GeoJSON LineString [lng,lat,alt,tsSec]
      const coords = (run.route || [])
        .filter((p) => Array.isArray(p) && p.length >= 2)
        .map((p) => [p[1], p[0], p[2] ?? 0, Math.round((p[3] ?? 0) / 1000)]);
      const routeData = coords.length >= 2 ? { type: 'LineString', coordinates: coords } : null;

      const { error } = await supabase
        .from('activities')
        .upsert(
          {
            user_id: userId,
            activity_date: todayLocal(run.startMs),
            distance_km: Number(km.toFixed(3)),
            duration_seconds: durationSeconds,
            pace_avg_sec_per_km: paceAvgSec,
            calories: cal,
            active_energy_kcal: cal,
            source: 'gps',
            is_native: true,
            activity_type: 'running',
            route_data: routeData,
            started_at: startedAt,
            ended_at: endedAt,
            visibility: 'public',
            memo: 'Galaxy Watch',
          },
          { onConflict: 'user_id,source,started_at', ignoreDuplicates: true },
        );

      if (error) throw error;
      done.add(run.clientRecordId);
    } catch (e) {
      logClientWarn('watch-run', 'save-failed', {
        clientRecordId: run.clientRecordId,
        message: e instanceof Error ? e.message : String(e),
      });
      // 실패 건은 큐에 남겨 다음 포그라운드에 재시도
    }
  }

  if (done.size > 0) {
    await removeFromQueue(done);
    logClientInfo('watch-run', 'drain-done', { saved: done.size });
  }
  return done.size;
}
