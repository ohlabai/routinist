'use client';

// 심박 통계 2종 (2026-08-02 hans: "내 기록 통계에서 심박·심박영역 분석")
// ① 평균 심박 추이 — heart_rate_avg 있는 러닝의 월별 평균 (최근 12개월)
// ② 심박 영역 분석 — hr_zones 캐시 집계 (최근 90일) + 미캐시 활동 lazy 계산 (iOS 네이티브)
// 심박 빨강은 의미색 (톤 룰 예외), 존 색은 워치·활동 상세와 동일.

import { useEffect, useMemo, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { HeartPulse, Heart } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/components/UserDataProvider';
import { useI18n } from '@/lib/i18n';
import { chartStyle } from '@/lib/chart-theme';
import { toLocalDateStr } from '@/lib/kst';
import { ensureHrZones, ZONE_COLORS, type HrZonesData } from '@/lib/hr-zones';

const ZONE_DESC_KO = ['워밍업', '가볍게', '유산소', '고강도', '전력'];
const ZONE_DESC_EN = ['Warm up', 'Easy', 'Aerobic', 'Hard', 'Max'];

function fmtMin(sec: number, en: boolean): string {
  if (sec <= 0) return '-';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h > 0) return en ? `${h}h ${m}m` : `${h}시간 ${m}분`;
  return en ? `${m}m` : `${m}분`;
}

export default function HrStatsCards() {
  const { user, profile } = useAuth();
  const { activities } = useUserData();
  const { tt, locale } = useI18n();
  const en = locale === 'en';

  // ① 월별 평균 심박 (최근 12개월, heart_rate_avg 있는 러닝만)
  const hrTrend = useMemo(() => {
    const agg = new Map<string, { sum: number; n: number; max: number }>();
    activities.forEach(a => {
      if (a.activity_type === 'walking') return;
      if (!a.heart_rate_avg || a.heart_rate_avg < 60) return;
      const ym = a.activity_date.slice(0, 7);
      const cur = agg.get(ym) ?? { sum: 0, n: 0, max: 0 };
      cur.sum += a.heart_rate_avg;
      cur.n += 1;
      cur.max = Math.max(cur.max, a.heart_rate_max ?? 0);
      agg.set(ym, cur);
    });
    const months = [...agg.keys()].sort().slice(-12);
    return months.map(ym => {
      const { sum, n, max } = agg.get(ym)!;
      return { month: en ? ym.slice(2) : `${Number(ym.slice(5))}월`, avg: Math.round(sum / n), max: max || undefined };
    });
  }, [activities, en]);

  // ② 존 집계 (최근 90일) — 저장분 + 이 세션에서 lazy 계산분
  const [extraZones, setExtraZones] = useState<Map<string, HrZonesData>>(new Map());
  const recent = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutStr = toLocalDateStr(cutoff);
    return activities.filter(a => a.activity_type !== 'walking' && a.activity_date >= cutStr);
  }, [activities]);

  // 미캐시 활동 최대 8건 lazy 계산 (본인 + iOS 네이티브에서만 동작 — 내부에서 가드)
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const targets = recent
      .filter(a => !(a.hr_zones?.z?.length === 5) && a.started_at && a.duration_seconds)
      .slice(0, 8);
    if (targets.length === 0) return;
    const maxHr = profile?.max_hr && profile.max_hr > 100 ? profile.max_hr : 190;
    (async () => {
      for (const a of targets) {
        if (cancelled) return;
        try {
          const z = await ensureHrZones(a, user.id, maxHr);
          if (z && !cancelled) {
            setExtraZones(prev => new Map(prev).set(a.id, z));
          }
        } catch { /* 개별 실패 무시 */ }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, recent.length]);

  const zoneAgg = useMemo(() => {
    const z = [0, 0, 0, 0, 0];
    let runs = 0;
    recent.forEach(a => {
      const data = (a.hr_zones?.z?.length === 5 ? a.hr_zones : extraZones.get(a.id)) as HrZonesData | undefined;
      if (!data) return;
      data.z.forEach((sec, i) => { z[i] += sec; });
      runs += 1;
    });
    return { z, total: z.reduce((s, v) => s + v, 0), runs };
  }, [recent, extraZones]);

  const showTrend = hrTrend.length >= 2;
  const showZones = zoneAgg.total >= 600; // 10분 이상 측정치가 있을 때만
  if (!showTrend && !showZones) return null;

  const maxZoneIdx = zoneAgg.z.indexOf(Math.max(...zoneAgg.z));
  const tooltipStyle = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 14, fontSize: 15 };

  return (
    <>
      {/* ① 평균 심박 추이 */}
      {showTrend && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Heart size={18} className="text-red-500" />
              <h3 className="text-xl font-extrabold text-[var(--foreground)]">{tt('심박 추이')}</h3>
            </div>
            <span className="text-base text-[var(--muted)]">{en ? 'monthly avg' : '월별 평균'}</span>
          </div>
          <p className="text-base text-[var(--muted)] mb-2">
            {en ? 'Lower at the same pace = better fitness' : '같은 페이스에서 낮아질수록 심폐가 좋아진 거예요'}
          </p>
          <ResponsiveContainer width="100%" height={170}>
            <AreaChart data={hrTrend} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="hrTrendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#EF4444" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#EF4444" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray={chartStyle.gridDash} stroke="var(--card-border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 13, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
              <YAxis domain={['dataMin - 8', 'dataMax + 8']} tick={{ fontSize: 13, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={38} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} bpm`, tt('평균 심박')]} />
              <Area type="monotone" dataKey="avg" stroke="#EF4444" strokeWidth={2.5} fill="url(#hrTrendGrad)" dot={{ r: 4, fill: '#EF4444' }} animationDuration={chartStyle.animationDuration} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ② 심박 영역 분석 (최근 90일 집계) */}
      {showZones && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <HeartPulse size={18} className="text-red-500" />
              <h3 className="text-xl font-extrabold text-[var(--foreground)]">{tt('심박 영역 분석')}</h3>
            </div>
            <span className="text-base text-[var(--muted)]">
              {en ? `${zoneAgg.runs} runs · 90d` : `최근 90일 · ${zoneAgg.runs}회`}
            </span>
          </div>
          <p className="text-base text-[var(--muted)] mb-4">
            {en
              ? <>Mostly <span className="font-bold text-[var(--foreground)]">Zone {maxZoneIdx + 1} · {ZONE_DESC_EN[maxZoneIdx]}</span> — elite runners keep ~80% easy</>
              : <>주로 <span className="font-bold text-[var(--foreground)]">영역 {maxZoneIdx + 1} · {ZONE_DESC_KO[maxZoneIdx]}</span> 강도 — 고수는 80%를 쉬운 페이스로 달려요</>}
          </p>
          <div className="space-y-2.5">
            {zoneAgg.z.map((sec, i) => {
              const pct = zoneAgg.total > 0 ? (sec / zoneAgg.total) * 100 : 0;
              return (
                <div key={i} className="flex items-center gap-2.5">
                  <span className="w-20 shrink-0 text-base font-bold text-[var(--foreground)] leading-tight">
                    {en ? `Zone ${i + 1}` : `영역 ${i + 1}`}
                    <span className="block text-[13px] font-medium text-[var(--muted)]">
                      {en ? ZONE_DESC_EN[i] : ZONE_DESC_KO[i]}
                    </span>
                  </span>
                  <div className="flex-1 h-5 bg-[var(--card-border)]/50 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-[width] duration-700 ease-out"
                      style={{ width: sec > 0 ? `${Math.max(pct, 2)}%` : 0, backgroundColor: ZONE_COLORS[i] }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right text-base font-bold tabular-nums text-[var(--foreground)]">
                    {fmtMin(sec, en)}
                  </span>
                  <span className="w-11 shrink-0 text-right text-sm tabular-nums text-[var(--muted)]">
                    {sec > 0 ? `${Math.round(pct)}%` : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
