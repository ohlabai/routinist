'use client';

// build 290 (할일 #22): 거리 단위 km ↔ mi 토글.
// self-contained — profile 페이지에서 <UnitToggle /> 로만 붙이면 됨.
// 표시 단위만 바꾸며 저장·계산 (DB/랭킹/목표/마일리지) 은 항상 km 유지.

import { Ruler } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { setDistanceUnit, useDistanceUnit, type DistanceUnit } from '@/lib/units';

const OPTIONS: { value: DistanceUnit; label: string }[] = [
  { value: 'km', label: 'km' },
  { value: 'mi', label: 'mi' },
];

export default function UnitToggle() {
  const { tt } = useI18n();
  const unit = useDistanceUnit();

  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
          <Ruler size={16} className="text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-extrabold text-[var(--foreground)]">{tt('거리 단위')}</h3>
          <p className="text-[13px] text-[var(--muted)] mt-0.5">{tt('킬로미터 또는 마일로 표시해요')}</p>
        </div>
        <div className="flex p-0.5 rounded-lg bg-white/70 dark:bg-zinc-900/40 border border-[var(--card-border)]/30 flex-shrink-0">
          {OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setDistanceUnit(opt.value)}
              className={`px-3.5 py-1 rounded-md text-[12px] font-bold transition ${
                unit === opt.value
                  ? 'bg-emerald-500 text-white shadow-sm'
                  : 'text-[var(--muted)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
