'use client';

// build 229: 월드런 챌린지 마일스톤 보드 — Conqueror 의 마일 마커 unlock 패턴.
// 코스 detail sheet 안에 노출. 카드 탭 → MilestoneDialog (Street View + 폴라로이드 엽서).

import { useState } from 'react';
import { Lock, Map as MapIcon } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { VirtualCourse } from '@/lib/world-data';
import { buildMilestones, type Milestone } from '@/lib/world-milestones';
import MilestoneDialog from './MilestoneDialog';

interface Props {
  course: VirtualCourse;
  myProgressKm: number;
  userName?: string;
}

export default function MilestoneBoard({ course, myProgressKm, userName }: Props) {
  const { tt, locale } = useI18n();
  const milestones = buildMilestones(course, myProgressKm);
  const [selected, setSelected] = useState<Milestone | null>(null);
  const [showAllLocked, setShowAllLocked] = useState(false);
  const unlockedCount = milestones.filter(m => m.unlocked).length;

  if (milestones.length === 0) return null;

  // 2026-07-15: 장거리 코스 (마일스톤 40+개) 가 sheet 를 끝없이 늘리던 문제 —
  // 잠긴 카드는 다음 3개까지만 보여주고 나머지는 "더 보기" 로 접기.
  const firstLockedIdx = milestones.findIndex(m => !m.unlocked);
  const visibleLimit = firstLockedIdx < 0 ? milestones.length : firstLockedIdx + 3;
  const visible = showAllLocked ? milestones : milestones.slice(0, visibleLimit);
  const hiddenCount = milestones.length - visible.length;

  return (
    <div className="rounded-2xl bg-[var(--card)] border border-[var(--card-border)] p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-extrabold inline-flex items-center gap-1.5">
          <MapIcon size={14} className="text-emerald-600" /> {tt('마일스톤 보드')}
        </p>
        <span className="text-xs font-extrabold text-emerald-600 tabular-nums">
          {unlockedCount}/{milestones.length}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {visible.map(m => {
          const isLandmark = m.kind === 'landmark';
          const isFinish = m.kind === 'finish';
          const isHalf = m.kind === 'half';
          return (
            <button
              key={m.id}
              onClick={() => m.unlocked && setSelected(m)}
              disabled={!m.unlocked}
              className={`text-left p-3 rounded-xl border transition active:scale-[0.98] disabled:active:scale-100 ${
                !m.unlocked
                  ? 'bg-[var(--card-border)]/15 border-[var(--card-border)]/30 opacity-60 cursor-not-allowed'
                  : isFinish
                  ? 'bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-amber-950/15 border-amber-300/60 dark:border-amber-800/40'
                  : isHalf
                  ? 'bg-gradient-to-br from-sky-50 to-sky-50/40 dark:from-sky-950/30 dark:to-sky-950/15 border-sky-300/60 dark:border-sky-800/40'
                  : isLandmark
                  ? 'bg-gradient-to-br from-emerald-50 to-emerald-50/40 dark:from-emerald-950/30 dark:to-emerald-950/15 border-emerald-300/60 dark:border-emerald-800/40'
                  : 'bg-[var(--card)] border-[var(--card-border)]'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-base leading-none">{m.unlocked ? m.emoji : '🔒'}</span>
                <span className="text-[12px] font-extrabold text-[var(--muted)] tabular-nums">
                  {m.km.toFixed(m.km % 1 === 0 ? 0 : 1)} km
                </span>
              </div>
              <p className={`text-sm font-extrabold truncate ${m.unlocked ? 'text-[var(--foreground)]' : 'text-[var(--muted)]'}`}>
                {tt(m.name)}
              </p>
              {!m.unlocked && (
                <p className="text-[12px] text-[var(--muted)] mt-0.5 inline-flex items-center gap-0.5">
                  <Lock size={9} /> {(m.km - myProgressKm).toFixed(1)}km {tt('남음')}
                </p>
              )}
            </button>
          );
        })}
      </div>

      {hiddenCount > 0 && (
        <button
          onClick={() => setShowAllLocked(true)}
          className="mt-2 w-full py-2 rounded-xl bg-[var(--card-border)]/15 text-xs font-bold text-[var(--muted)] active:scale-[0.99]"
        >
          {locale === 'en' ? `Show ${hiddenCount} more milestones` : `잠긴 마일스톤 ${hiddenCount}개 더 보기`}
        </button>
      )}

      {selected && (
        <MilestoneDialog
          milestone={selected}
          course={course}
          userName={userName}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
