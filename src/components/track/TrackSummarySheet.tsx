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
} from '@/lib/gps-tracking';
import RouteMap from '@/components/map/RouteMap';
import type { GeoJSONLineString } from '@/types';
import { syncPBsFromActivity } from '@/lib/best-splits';

interface Props {
  finalState: TrackingState;
  userId: string;
  onClose: () => void;
}

// km 별 split 계산 — coords 시간 누적이 km 경계를 넘는 지점마다 페이스 산출.
function computeKmSplits(coords: TrackingState['coords']): Array<{ km: number; seconds: number; pace: string }> {
  if (coords.length < 2) return [];
  const splits: Array<{ km: number; seconds: number; pace: string }> = [];
  let cumMeters = 0;
  let kmMarker = 1;
  let kmStartTs = coords[0][3];
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const cur = coords[i];
    const d = haversineMeters({ lat: prev[1], lng: prev[0] }, { lat: cur[1], lng: cur[0] });
    cumMeters += d;
    while (cumMeters >= kmMarker * 1000) {
      const seconds = (cur[3] - kmStartTs) / 1000;
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      splits.push({ km: kmMarker, seconds, pace: `${m}'${s.toString().padStart(2, '0')}"` });
      kmMarker++;
      kmStartTs = cur[3];
    }
  }
  return splits;
}

// 사용자 timezone 기준 YYYY-MM-DD (KST 룰 — reference_timezone_handling)
function todayLocal(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  } catch {
    const d = new Date();
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
  }
}

export default function TrackSummarySheet({ finalState, userId, onClose }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const distanceMeters = finalState.distanceMeters;
  const elapsedSeconds = Math.floor(finalState.elapsedSeconds);
  const avgPaceSec = averagePaceSecondsPerKm(elapsedSeconds, distanceMeters);
  const splits = useMemo(() => computeKmSplits(finalState.coords), [finalState.coords]);

  // build 151 호환 — [lng, lat, alt, ts(unix sec)] 4-tuple. MP4 공유 시 timestamp 로 실제 페이스 라인 속도.
  const routeData: GeoJSONLineString = {
    type: 'LineString',
    coordinates: finalState.coords.map(([lng, lat, alt, ts]) => [lng, lat, alt, Math.round(ts / 1000)]) as [number, number, number?, number?][],
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const supabase = getSupabase();
      const startedAt = new Date(finalState.startedAt).toISOString();
      const endedAt = new Date().toISOString();
      // 칼로리 추정: 약 60kcal/km (러닝 평균). 체중·심박 데이터 있을 때 정교화 가능.
      const estCal = Math.round((distanceMeters / 1000) * 60);

      const { data, error: insertErr } = await supabase
        .from('activities')
        .insert({
          user_id: userId,
          activity_date: todayLocal(),
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
      if (!activityId) throw new Error('저장 후 id 없음');

      // build 197: PB 갱신 확인. 실패해도 저장은 성공으로 처리.
      try {
        const newPBs = await syncPBsFromActivity(activityId, routeData.coordinates, endedAt);
        if (newPBs.length > 0) {
          // 신규 PB 가 있으면 활동 상세에 query string 으로 전달 → 거기서 축하 toast 표시.
          const pbParam = encodeURIComponent(JSON.stringify(newPBs.map(p => p.distanceMeters)));
          onClose();
          router.push(`/activity?id=${activityId}&new_pb=${pbParam}`);
          return;
        }
      } catch (e) {
        console.warn('[track/summary] PB sync 실패 (저장은 정상)', e);
      }

      // 활동 상세로 이동 (sheet 닫고 navigate)
      onClose();
      router.push(`/activity?id=${activityId}`);
    } catch (e) {
      console.warn('[track/summary] save fail', e);
      setError(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (!window.confirm('이번 기록을 저장하지 않고 버릴까요?')) return;
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
            <h2 className="text-base font-extrabold">달리기 완료!</h2>
          </div>
          <button onClick={onClose} aria-label="닫기"
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
                  <Clock size={11} /> 시간
                </div>
                <p className="text-2xl font-extrabold tabular-nums">{formatDuration(elapsedSeconds)}</p>
              </div>
              <div className="text-center">
                <div className="inline-flex items-center gap-1 text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-1">
                  <Activity size={11} /> 평균 페이스
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
            <h3 className="text-xs font-extrabold uppercase tracking-widest text-[var(--muted)]">경로</h3>
          </div>
          <RouteMap routeData={routeData} height="220px" />
        </div>

        {/* km splits */}
        {splits.length > 0 && (
          <div className="px-5 pb-3">
            <h3 className="text-xs font-extrabold uppercase tracking-widest text-[var(--muted)] mb-2">구간별 페이스</h3>
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
          <button onClick={handleDiscard} disabled={saving} aria-label="버리기"
            className="w-14 py-4 rounded-2xl border-2 border-[var(--card-border)] text-[var(--muted)] active:scale-95 disabled:opacity-50 inline-flex items-center justify-center">
            <Trash2 size={18} />
          </button>
          <button onClick={handleSave} disabled={saving}
            className="py-4 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-base active:scale-[0.98] disabled:opacity-50 shadow-md shadow-emerald-500/30 inline-flex items-center justify-center gap-2">
            {saving ? (
              <>
                <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                저장 중…
              </>
            ) : (
              <>
                <CheckCircle size={18} />
                저장하기
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
