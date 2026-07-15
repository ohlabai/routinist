'use client';

// 트래킹 완료 후 요약 sheet (build 194).
// 트래킹 중에는 의도적으로 숨겼던 평균 페이스 / km splits 를 여기서 풍부하게 표시.
// 저장 시 activities INSERT (source='gps', activity_type='running').
// 마일리지 적립은 award_run_mileage RPC 트리거 또는 호출 (기존 마일리지 시스템 활용).

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle, Trash2, MapPin, Activity, Clock, X } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import {
  type TrackingState, formatDuration, formatDistanceKm,
  averagePaceSecondsPerKm, formatPace, haversineMeters,
  smoothCoords,
} from '@/lib/gps-tracking';
import RouteMap from '@/components/map/RouteMap';
import type { GeoJSONLineString } from '@/types';
import { syncPBsFromActivity } from '@/lib/best-splits';
import { correctDistanceWithHealthKit, isLiveDistanceAvailable } from '@/lib/live-distance';
import { useI18n } from '@/lib/i18n';
import { logClientInfo, logClientWarn } from '@/lib/error-logger';

interface Props {
  finalState: TrackingState;
  userId: string;
  onClose: () => void;
}

// km 별 split 계산 — coords 시간 누적이 km 경계를 넘는 지점마다 페이스 산출.
// build 222 #2: 한 segment 가 여러 km 경계를 가로지를 때 (백그라운드 GPS 복귀 등으로 단일 좌표가
// 다중 km 점프) 모든 후속 split 시간이 0 으로 찍히던 회귀 fix. timestamp 를 비례 보간해서 분배.
// (이전: 첫 split 만 거대값, 나머지 0'00")
function computeKmSplits(coords: TrackingState['coords']): Array<{ km: number; seconds: number; pace: string }> {
  if (coords.length < 2) return [];
  const splits: Array<{ km: number; seconds: number; pace: string }> = [];
  let cumMeters = 0;
  let kmMarker = 1;
  let kmStartTs = coords[0][3];
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const cur = coords[i];
    const segMeters = haversineMeters({ lat: prev[1], lng: prev[0] }, { lat: cur[1], lng: cur[0] });
    if (segMeters <= 0) continue;
    const segStart = cumMeters;
    const segEnd = cumMeters + segMeters;
    const segDtMs = cur[3] - prev[3];
    while (segEnd >= kmMarker * 1000) {
      // km 경계가 이 segment 안 어디 (fraction) 에 위치하는지 → 해당 시점 timestamp 보간
      const fraction = (kmMarker * 1000 - segStart) / segMeters;
      const tsAtMarker = prev[3] + segDtMs * fraction;
      const seconds = Math.max(0, (tsAtMarker - kmStartTs) / 1000);
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      splits.push({ km: kmMarker, seconds, pace: `${m}'${s.toString().padStart(2, '0')}"` });
      kmMarker++;
      kmStartTs = tsAtMarker;
    }
    cumMeters = segEnd;
  }
  return splits;
}

// 사용자 timezone 기준 YYYY-MM-DD (KST 룰 — reference_timezone_handling)
// 2026-07-15 리뷰 fix: 저장 시각이 아닌 "시작 시각" 기준 — 23:50 출발 00:20 저장 런이
// 다음 날짜로 찍히고, 이후 Apple Health 동기화 (startDate 기준) 와 어긋나던 문제.
function todayLocal(atMs?: number): string {
  const base = atMs ? new Date(atMs) : new Date();
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

export default function TrackSummarySheet({ finalState, userId, onClose }: Props) {
  const router = useRouter();
  const { tt } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const distanceMeters = finalState.distanceMeters;
  const elapsedSeconds = Math.floor(finalState.elapsedSeconds);
  const avgPaceSec = averagePaceSecondsPerKm(elapsedSeconds, distanceMeters);
  const splits = useMemo(() => computeKmSplits(finalState.coords), [finalState.coords]);

  // build 151 호환 — [lng, lat, alt, ts(unix sec)] 4-tuple. MP4 공유 시 timestamp 로 실제 페이스 라인 속도.
  // build 257: GPS jitter 제거를 위해 좌표를 5-point moving-average 로 smoothing.
  // distance / pace 는 원본 GPS 누적 보존 (HealthKit 보정이 별도 처리). 폴리라인 시각화만 부드럽게.
  const smoothed = smoothCoords(finalState.coords);
  const routeData: GeoJSONLineString = {
    type: 'LineString',
    coordinates: smoothed.map(([lng, lat, alt, ts]) => [lng, lat, alt, Math.round(ts / 1000)]) as [number, number, number?, number?][],
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    // build 214 #2: 저장 시도 자체를 관측 가능하게 — 이전엔 attempt/fail/abort 어느 것도 client_error_logs 에 안 남음.
    logClientInfo('track-save', 'attempt', {
      distance_m: Math.round(distanceMeters),
      elapsed_s: elapsedSeconds,
      coords_n: finalState.coords.length,
    });
    try {
      const supabase = getSupabase();
      const startedAt = new Date(finalState.startedAt).toISOString();
      const endedAt = new Date().toISOString();
      const estCal = Math.round((distanceMeters / 1000) * 60);

      const { data, error: insertErr } = await supabase
        .from('activities')
        .insert({
          user_id: userId,
          activity_date: todayLocal(finalState.startedAt),
          distance_km: Number((distanceMeters / 1000).toFixed(3)),
          duration_seconds: elapsedSeconds,
          pace_avg_sec_per_km: avgPaceSec,
          calories: estCal,
          active_energy_kcal: estCal,
          source: 'gps',
          activity_type: 'running',
          route_data: routeData,
          started_at: startedAt,
          ended_at: endedAt,
          visibility: 'public',
        })
        .select('id')
        .single();

      if (insertErr) throw insertErr;
      const activityId = data?.id as string | undefined;
      if (!activityId) throw new Error(tt('저장 후 id 없음'));

      // build 254: HealthKit distanceWalkingRunning 자동 보정. fire-and-forget.
      // 운동 종료 후 15~45초 사이에 HealthKit sample 이 적재되면 Apple 의 sensor-fusion
      // 결과로 distance/pace 를 UPDATE 한다. GPS 자체 누적은 jitter / multipath 로 부풀려질 수
      // 있는데, Apple Watch / iPhone 자이로+보폭 보정값이 신뢰도 더 높음. 5% 이상 차이날 때만.
      // 사용자는 activity 페이지로 즉시 이동, 보정은 백그라운드에서 진행됨.
      if (isLiveDistanceAvailable() && distanceMeters > 0) {
        void (async () => {
          try {
            const result = await correctDistanceWithHealthKit({
              gpsMeters: distanceMeters,
              startMs: finalState.startedAt,
              endMs: new Date(endedAt).getTime(),
            });
            if (result.source !== 'healthkit') return;
            const correctedKm = Number((result.corrected / 1000).toFixed(3));
            const correctedPace = result.corrected > 50
              ? Math.round(elapsedSeconds / (result.corrected / 1000))
              : null;
            // source 는 'gps' 유지 — route_data 는 우리 GPS 좌표 그대로이고, dedup 로직 (build 246)
            // 도 source='gps' 행을 health_kit 으로 upgrade 가능하게 설계됨. 이중 처리 안 됨.
            await supabase.from('activities')
              .update({ distance_km: correctedKm, pace_avg_sec_per_km: correctedPace })
              .eq('id', activityId);
            logClientInfo('live-distance', 'db-updated', {
              activity_id: activityId,
              gps_km: Number((distanceMeters / 1000).toFixed(2)),
              hk_km: correctedKm,
              delta_m: Math.round(result.delta),
              sample_count: result.sampleCount,
            });
          } catch (e) {
            logClientWarn('live-distance', 'correction-fail', {
              activity_id: activityId,
              message: e instanceof Error ? e.message : String(e),
            });
          }
        })();
      }

      // build 298: 첫 기록 저장 = push 권한을 물을 최적 순간 ("친구 응원·리포트 받기").
      // 이미 허용/거부한 유저는 no-op. fire-and-forget — 네비게이션 안 막음.
      import('@/lib/push-notifications').then(m => m.promptPushPermission()).catch(() => {});

      // build 299: 완주 직후 보상 순간 — PB·신규 배지·적립을 홈 복귀까지 미루지 않고
      // 활동 페이지에서 바로 축하. query param 으로 전달 (기존 new_pb 패턴 확장).
      const params = new URLSearchParams({ id: activityId, just_saved: '1' });

      // build 197: PB 갱신 확인. 실패해도 저장은 성공으로 처리.
      try {
        const newPBs = await syncPBsFromActivity(activityId, routeData.coordinates, endedAt);
        if (newPBs.length > 0) {
          // 신규 PB 가 있으면 활동 상세에 query string 으로 전달 → 거기서 축하 toast 표시.
          params.set('new_pb', JSON.stringify(newPBs.map(p => p.distanceMeters)));
        }
      } catch (e) {
        console.warn('[track/summary] PB sync 실패 (저장은 정상)', e);
      }

      // build 299: 배지 체크를 저장 직후 즉석 호출 — 이전엔 dashboard mount 에서만 체크해서
      // 축하 모달이 홈에 돌아와야 떴음. RPC 는 newly_awarded 를 1회만 true 로 반환하므로
      // 여기서 소비하면 dashboard 재진입 시 이중 축하 없음. localStorage `badge_celebrated:{code}`
      // 계약 (dashboard 와 동일) 은 활동 페이지의 모달 close 에서 기록.
      try {
        const m = await import('@/lib/achievements-data');
        const results = await Promise.race([
          m.checkAndAwardAchievements(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('achievements check timeout 5s')), 5000)
          ),
        ]);
        const fresh = results
          .filter(r => r.newly_awarded && m.ACHIEVEMENTS[r.code])
          .map(r => r.code)
          .filter(code => !localStorage.getItem(`badge_celebrated:${code}`));
        if (fresh.length > 0) params.set('new_badges', fresh.join(','));
      } catch (e) {
        console.warn('[track/summary] 배지 체크 실패 (저장은 정상)', e);
      }

      logClientInfo('track-save', 'success', { activity_id: activityId, distance_m: Math.round(distanceMeters) });
      // 활동 상세로 이동 (sheet 닫고 navigate)
      onClose();
      router.push(`/activity?${params.toString()}`);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.warn('[track/summary] save fail', e);
      logClientWarn('track-save', 'fail', {
        reason,
        distance_m: Math.round(distanceMeters),
        elapsed_s: elapsedSeconds,
        coords_n: finalState.coords.length,
      });
      setError(e instanceof Error ? e.message : tt('저장 실패'));
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (!window.confirm(tt('이번 기록을 저장하지 않고 버릴까요?'))) return;
    logClientWarn('track-discard', 'sheet-discard', {
      distance_m: Math.round(distanceMeters),
      elapsed_s: elapsedSeconds,
      coords_n: finalState.coords.length,
    });
    onClose();
    router.replace('/dashboard');
  };

  return (
    <div className="fixed inset-0 z-[95] bg-black/60 backdrop-blur-sm flex items-end justify-center">
      <div className="bg-[var(--background)] w-full max-w-lg max-h-[92vh] rounded-t-3xl shadow-2xl overflow-y-auto">
        {/* 헤더 */}
        <div className="sticky top-0 bg-[var(--background)]/95 backdrop-blur-lg border-b border-[var(--card-border)]/30 px-4 py-3 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <CheckCircle size={18} className="text-emerald-500" />
            <h2 className="text-base font-extrabold">{tt('달리기 완료!')}</h2>
          </div>
          <button onClick={onClose} aria-label={tt('닫기')}
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[var(--card-border)]/40 active:scale-90">
            <X size={18} />
          </button>
        </div>

        {/* hero 거리·시간·페이스 */}
        <div className="px-5 pt-5 pb-3">
          <div className="card p-5 bg-gradient-to-br from-emerald-50/60 to-transparent dark:from-emerald-950/20">
            <div className="text-center mb-4">
              <p className="text-5xl font-extrabold tracking-tight text-emerald-600 tabular-nums">
                {formatDistanceKm(distanceMeters)}
                <span className="text-xl text-[var(--muted)] ml-1.5">km</span>
              </p>
              <p className="text-xs font-bold text-[var(--muted)] uppercase tracking-widest mt-1">Total Distance</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="text-center">
                <div className="inline-flex items-center gap-1 text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-1">
                  <Clock size={11} /> {tt('시간')}
                </div>
                <p className="text-2xl font-extrabold tabular-nums">{formatDuration(elapsedSeconds)}</p>
              </div>
              <div className="text-center">
                <div className="inline-flex items-center gap-1 text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-1">
                  <Activity size={11} /> {tt('평균 페이스')}
                </div>
                <p className="text-2xl font-extrabold tabular-nums">{formatPace(avgPaceSec)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* 지도 */}
        <div className="px-5 pb-3">
          <div className="flex items-center gap-1.5 mb-2">
            <MapPin size={14} className="text-emerald-500" />
            <h3 className="text-xs font-extrabold uppercase tracking-widest text-[var(--muted)]">{tt('경로')}</h3>
          </div>
          <RouteMap routeData={routeData} height="220px" />
        </div>

        {/* km splits */}
        {splits.length > 0 && (
          <div className="px-5 pb-3">
            <h3 className="text-xs font-extrabold uppercase tracking-widest text-[var(--muted)] mb-2">{tt('구간별 페이스')}</h3>
            <div className="card divide-y divide-[var(--card-border)]/40">
              {splits.map(s => (
                <div key={s.km} className="px-4 py-2.5 flex items-center justify-between">
                  <span className="text-sm font-bold">{s.km} km</span>
                  <span className="text-sm font-extrabold tabular-nums text-emerald-600">{s.pace}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="px-5 pb-2">
            <p className="text-xs text-rose-500 font-semibold text-center">{error}</p>
          </div>
        )}

        {/* CTA */}
        <div className="px-5 pt-2 pb-7 grid grid-cols-[auto_1fr] gap-2.5">
          <button onClick={handleDiscard} disabled={saving} aria-label={tt('버리기')}
            className="w-14 py-4 rounded-2xl border-2 border-[var(--card-border)] text-[var(--muted)] active:scale-95 disabled:opacity-50 inline-flex items-center justify-center">
            <Trash2 size={18} />
          </button>
          <button onClick={handleSave} disabled={saving}
            className="py-4 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-base active:scale-[0.98] disabled:opacity-50 shadow-md shadow-emerald-500/30 inline-flex items-center justify-center gap-2">
            {saving ? (
              <>
                <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                {tt('저장 중…')}
              </>
            ) : (
              <>
                <CheckCircle size={18} />
                {tt('저장하기')}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
