'use client';

// 심박존 Zone1~5 카드 (회원 요청, 2026-08-01) — 활동 상세.
// 저장된 hr_zones 우선, 없으면 본인+iOS 에서 HealthKit 샘플로 1회 계산·캐시 (hr-zones.ts).
// 존 색은 워치와 동일한 Apple 문법 (Z1 파랑 → Z5 빨강), 라벨·시간을 항상 병기 (색 단독 식별 금지).

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { ensureHrZones, ZONE_COLORS, type HrZonesData } from '@/lib/hr-zones';
import { useI18n } from '@/lib/i18n';
import { HeartPulse } from 'lucide-react';
import type { Activity } from '@/types';

const ZONE_DESC_KO = ['워밍업', '가볍게', '유산소', '고강도', '전력'];
const ZONE_DESC_EN = ['Warm up', 'Easy', 'Aerobic', 'Hard', 'Max'];

function fmtMin(sec: number, en: boolean): string {
  if (sec <= 0) return '-';
  const m = Math.round(sec / 60);
  if (m < 1) return en ? '<1m' : '1분 미만';
  return en ? `${m}m` : `${m}분`;
}

export default function HrZonesCard({ activity }: { activity: Activity }) {
  const { user, profile } = useAuth();
  const { tt, locale } = useI18n();
  const [zones, setZones] = useState<HrZonesData | null>(
    activity.hr_zones?.z?.length === 5 ? (activity.hr_zones as HrZonesData) : null
  );

  useEffect(() => {
    if (zones) return;
    let cancelled = false;
    const maxHr = profile?.max_hr && profile.max_hr > 100 ? profile.max_hr : 190;
    ensureHrZones(activity, user?.id ?? null, maxHr)
      .then(z => { if (!cancelled && z) setZones(z); })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity.id]);

  if (!zones) return null;
  const total = zones.z.reduce((s, v) => s + v, 0);
  if (total < 60) return null;
  const en = locale === 'en';
  const maxZoneIdx = zones.z.indexOf(Math.max(...zones.z));

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <HeartPulse size={18} className="text-red-500" />
          <h3 className="text-base font-bold text-[var(--foreground)]">{tt('심박 영역')}</h3>
        </div>
        <span className="text-sm text-[var(--muted)]">{en ? `Max HR ${zones.max_hr}` : `최대심박 ${zones.max_hr} 기준`}</span>
      </div>
      <p className="text-sm text-[var(--muted)] mb-4">
        {en
          ? <>Mostly in <span className="font-bold text-[var(--foreground)]">Zone {maxZoneIdx + 1} · {ZONE_DESC_EN[maxZoneIdx]}</span></>
          : <>주로 <span className="font-bold text-[var(--foreground)]">영역 {maxZoneIdx + 1} · {ZONE_DESC_KO[maxZoneIdx]}</span> 강도로 달렸어요</>}
      </p>
      <div className="space-y-2.5">
        {zones.z.map((sec, i) => {
          const pct = total > 0 ? (sec / total) * 100 : 0;
          return (
            <div key={i} className="flex items-center gap-2.5">
              <span className="w-16 shrink-0 text-sm font-bold text-[var(--foreground)] leading-tight">
                {en ? `Zone ${i + 1}` : `영역 ${i + 1}`}
                <span className="block text-[11px] font-medium text-[var(--muted)]">
                  {en ? ZONE_DESC_EN[i] : ZONE_DESC_KO[i]}
                </span>
              </span>
              <div className="flex-1 h-4 bg-[var(--card-border)]/50 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-[width] duration-700 ease-out"
                  style={{ width: sec > 0 ? `${Math.max(pct, 2)}%` : 0, backgroundColor: ZONE_COLORS[i] }}
                />
              </div>
              <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums text-[var(--foreground)]">
                {fmtMin(sec, en)}
              </span>
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-[var(--muted)]">
                {sec > 0 ? `${Math.round(pct)}%` : ''}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
