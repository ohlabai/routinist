// 워치 완주 러닝 드레인 — 갤럭시(Wear OS) + 애플워치 공용.
//
// Wear OS: 워치가 Wearable Data Layer 로 보낸 러닝을 폰의 WatchRunReceiverService(Kotlin)가
// Capacitor Preferences 큐(watch_pending_runs)에 쌓아둔다.
// Apple Watch (2026-08-03 hans "동기화 오래 걸림"): HK 미러 대기 없이 워치가 종료 즉시
// WCSession transferUserInfo 로 직송 → WatchBridge 가 같은 큐에 쌓는다. 앱 열면 바로 기록 도착.
// 나중에 도는 health-sync 는 started_at ±60s 겹침으로 dedup skip (is_native=true 라 덮어쓰기도 금지).
// 앱 포그라운드 시 이 함수가 큐를 읽어 기존 activities insert 플로우로 저장한다.
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
  device?: string;   // 'Apple Watch' | undefined(Galaxy)
  zoneSeconds?: number[]; // 존1~5 체류 초 (갤럭시워치 v5 — hr_zones 저장용)
  maxHr?: number;
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

      // 애플워치 경로 가드: health-sync 가 먼저 돌아 같은 러닝의 health_kit 행이 이미
      // 있으면 skip (upsert 의 onConflict 는 source 가 달라 못 잡음). ±60s = HK dedup 과 동일 창.
      const { data: dupRows } = await supabase
        .from('activities')
        .select('id')
        .eq('user_id', userId)
        .gte('started_at', new Date(run.startMs - 60_000).toISOString())
        .lte('started_at', new Date(run.startMs + 60_000).toISOString())
        .limit(1);
      if (dupRows && dupRows.length > 0) {
        done.add(run.clientRecordId); // 이미 저장돼 있음 — 큐에서 제거
        continue;
      }
      const distanceMeters = Math.max(0, run.distanceMeters || 0);
      const durationSeconds = Math.max(0, Math.floor(run.durationSec || 0));
      const km = distanceMeters / 1000;
      const paceAvgSec = km > 0 && durationSeconds > 0 ? Math.round(durationSeconds / km) : null;
      const cal = run.calories > 0 ? Math.round(run.calories) : Math.round(km * 60);

      // 심박존 (갤럭시워치 v5): 워치가 적산한 존1~5 를 hr_zones 캐시 형식으로.
      // iOS computeHrZones 와 동일 계약 ({z, max_hr, src}) — 활동 상세 심박존 카드가 그대로 읽음.
      const zs = run.zoneSeconds;
      const hrZones = zs && zs.length === 5 && zs.reduce((s, v) => s + v, 0) >= 60 && (run.maxHr ?? 0) > 0
        ? { z: zs.map(v => Math.round(v)), max_hr: Math.round(run.maxHr!), src: 'watch', computed_at: new Date().toISOString() }
        : null;

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
            hr_zones: hrZones,
            started_at: startedAt,
            ended_at: endedAt,
            visibility: 'public',
            memo: run.device === 'Apple Watch' ? 'Apple Watch' : 'Galaxy Watch',
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
