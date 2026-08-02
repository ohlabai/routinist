'use client';

// 예상 레이스 기록 (2026-08-02 hans: "코치 내용 빈약 — 다양한 분석")
// Riegel 공식 t2 = t1 × (d2/d1)^1.06 — 최근 90일 베스트 러닝(3km+)을 기준으로
// 5K / 10K / 하프 / 풀 예상 완주 시간을 추정. 러너들이 가장 좋아하는 "전문가" 지표.

import { useMemo } from 'react';
import { Timer } from 'lucide-react';
import { useUserData } from '@/components/UserDataProvider';
import { useI18n } from '@/lib/i18n';
import { toLocalDateStr } from '@/lib/kst';

const TARGETS = [
  { km: 5, label: '5K' },
  { km: 10, label: '10K' },
  { km: 21.0975, label: 'Half' },
  { km: 42.195, label: 'Full' },
];

function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export default function RacePredictionCard() {
  const { activities } = useUserData();
  const { tt, locale } = useI18n();
  const en = locale === 'en';

  // 기준 러닝: 최근 90일, 3km 이상 중 "페이스 최속" (짧은 스퍼트 왜곡 방지)
  const base = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutStr = toLocalDateStr(cutoff);
    let best: { km: number; sec: number } | null = null;
    for (const a of activities) {
      if (a.activity_type === 'walking') continue;
      if (a.activity_date < cutStr) continue;
      const km = Number(a.distance_km);
      const sec = a.duration_seconds ?? 0;
      if (km < 3 || sec <= 0) continue;
      const pace = sec / km;
      if (pace < 150 || pace > 720) continue; // 비현실 기록 제외
      if (!best || pace < best.sec / best.km) best = { km, sec };
    }
    return best;
  }, [activities]);

  if (!base) return null;

  const predict = (targetKm: number) => base.sec * Math.pow(targetKm / base.km, 1.06);

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-1">
        <Timer size={18} className="text-emerald-500" />
        <h3 className="text-lg font-extrabold text-[var(--foreground)]">{tt('예상 레이스 기록')}</h3>
      </div>
      <p className="text-sm text-[var(--muted)] mb-4">
        {en
          ? <>Based on your best recent run — <span className="font-bold text-[var(--foreground)]">{base.km.toFixed(1)}km in {fmtTime(base.sec)}</span></>
          : <>최근 90일 베스트 <span className="font-bold text-[var(--foreground)]">{base.km.toFixed(1)}km · {fmtTime(base.sec)}</span> 기준 (Riegel 공식)</>}
      </p>
      <div className="grid grid-cols-2 gap-3">
        {TARGETS.map(t => (
          <div key={t.label} className="rounded-2xl bg-[var(--card-border)]/25 p-3.5 text-center">
            <p className="text-sm font-extrabold tracking-widest uppercase text-emerald-600 dark:text-emerald-400">{t.label}</p>
            <p className="text-2xl font-extrabold tracking-tight tabular-nums text-[var(--foreground)] mt-0.5">
              {fmtTime(predict(t.km))}
            </p>
            <p className="text-xs text-[var(--muted)] mt-0.5 tabular-nums">
              {(() => { const p = predict(t.km) / t.km; return `${Math.floor(p / 60)}'${String(Math.round(p % 60)).padStart(2, '0')}"/km`; })()}
            </p>
          </div>
        ))}
      </div>
      <p className="text-xs text-[var(--muted)] mt-3 leading-relaxed">
        {en
          ? 'Estimates assume proper training for the distance — treat the full as a stretch goal.'
          : '해당 거리 훈련이 됐다는 가정의 추정치예요 — 풀코스는 도전 목표로 봐주세요.'}
      </p>
    </div>
  );
}
