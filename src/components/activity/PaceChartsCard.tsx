'use client';

// 페이스 그래프 (2026-08-02 hans: "지도 아래에 페이스추이·페이스거리 — 전문성")
// route_data 의 GPS 타임스탬프로 롤링 페이스(250m 윈도우)를 계산해
// ① 거리 축 (페이스 × 거리) ② 시간 축 (페이스 추이) 토글 차트로 표시.
// 위로 갈수록 빠른 페이스 (reversed Y — /stats 페이스 추이와 동일 문법).

import { useMemo, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { TrendingUp } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { chartStyle } from '@/lib/chart-theme';
import type { GeoJSONLineString } from '@/types';

interface Props {
  routeData: GeoJSONLineString;
}

interface PacePoint {
  km: number;      // 누적 거리 (km)
  min: number;     // 경과 시간 (분)
  paceSec: number; // 롤링 페이스 (sec/km)
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function buildPaceSeries(coords: GeoJSONLineString['coordinates']): PacePoint[] {
  // [lng, lat, alt?, ts(unix sec)?] — 타임스탬프 있는 좌표만
  const pts = coords.filter(c => typeof c[3] === 'number' && Number.isFinite(c[3]));
  if (pts.length < 12) return [];
  const t0 = pts[0][3] as number;
  const out: PacePoint[] = [];
  const win: Array<{ d: number; t: number }> = [{ d: 0, t: t0 }];
  let cum = 0;
  let lastEmit = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = haversineM(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]);
    if (seg <= 0 || seg > 200) continue; // GPS 점프 세그먼트 제외
    cum += seg;
    const t = pts[i][3] as number;
    win.push({ d: cum, t });
    while (win.length > 2 && cum - win[0].d > 250) win.shift();
    if (cum - lastEmit >= 40) {
      const dd = cum - win[0].d;
      const dt = t - win[0].t;
      if (dd > 60 && dt > 5) {
        const pace = dt / (dd / 1000);
        // 비현실 구간 (신호대기 GPS 정지 등 20'/km 초과, 2'/km 미만) 제외
        if (pace >= 120 && pace <= 1200) {
          out.push({ km: Number((cum / 1000).toFixed(2)), min: Number(((t - t0) / 60).toFixed(1)), paceSec: Math.round(pace) });
        }
      }
      lastEmit = cum;
    }
  }
  return out;
}

const fmtPace = (v: number) => `${Math.floor(v / 60)}'${String(Math.round(v % 60)).padStart(2, '0')}"`;

export default function PaceChartsCard({ routeData }: Props) {
  const { tt, locale } = useI18n();
  const [axis, setAxis] = useState<'km' | 'min'>('km');
  const series = useMemo(() => buildPaceSeries(routeData.coordinates), [routeData]);

  if (series.length < 8) return null; // 짧은/타임스탬프 없는 경로 — 카드 생략

  const en = locale === 'en';
  const avg = series.reduce((s, p) => s + p.paceSec, 0) / series.length;
  const best = Math.min(...series.map(p => p.paceSec));

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <TrendingUp size={18} className="text-emerald-500" />
          <h3 className="text-lg font-extrabold text-[var(--foreground)]">{tt('페이스 그래프')}</h3>
        </div>
        {/* 거리/시간 축 토글 */}
        <div className="flex items-center gap-1 bg-[var(--card-border)]/30 rounded-lg p-0.5">
          <button
            onClick={() => setAxis('km')}
            className={`px-2.5 py-1 rounded-md text-sm font-bold transition ${axis === 'km' ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted)]'}`}
          >{tt('거리')}</button>
          <button
            onClick={() => setAxis('min')}
            className={`px-2.5 py-1 rounded-md text-sm font-bold transition ${axis === 'min' ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted)]'}`}
          >{tt('시간')}</button>
        </div>
      </div>
      <p className="text-sm text-[var(--muted)] mb-2">
        {en
          ? <>best <span className="font-bold text-[var(--foreground)]">{fmtPace(best)}</span> · avg <span className="font-bold text-[var(--foreground)]">{fmtPace(avg)}</span> — higher is faster</>
          : <>순간 최고 <span className="font-bold text-[var(--foreground)]">{fmtPace(best)}</span> · 평균 <span className="font-bold text-[var(--foreground)]">{fmtPace(avg)}</span> — 위로 갈수록 빠름</>}
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={series} margin={{ top: 6, right: 8, left: -6, bottom: 0 }}>
          <defs>
            <linearGradient id="actPaceGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10B981" stopOpacity={0.30} />
              <stop offset="100%" stopColor="#10B981" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray={chartStyle.gridDash} stroke="var(--card-border)" vertical={false} />
          <XAxis
            dataKey={axis}
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(v: number) => axis === 'km' ? `${v.toFixed(v < 10 ? 1 : 0)}km` : `${Math.round(v)}${en ? 'm' : '분'}`}
            tick={{ fontSize: 13, fill: 'var(--muted)' }}
            axisLine={false} tickLine={false}
            tickCount={6}
          />
          <YAxis
            reversed
            domain={['dataMin - 15', 'dataMax + 15']}
            tickFormatter={fmtPace}
            tick={{ fontSize: 13, fill: 'var(--muted)' }}
            axisLine={false} tickLine={false}
            width={54}
          />
          <Tooltip
            contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 14, fontSize: 15 }}
            formatter={(value) => [fmtPace(Number(value)), tt('페이스')]}
            labelFormatter={(label: number) => axis === 'km' ? `${label}km` : `${label}${en ? ' min' : '분'}`}
          />
          <Area
            type="monotone"
            dataKey="paceSec"
            stroke="#10B981"
            strokeWidth={2.5}
            fill="url(#actPaceGrad)"
            dot={false}
            animationDuration={chartStyle.animationDuration}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
