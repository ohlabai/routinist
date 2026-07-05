'use client';

// Achievement 배지 카드 (build 129).

import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { fetchUserAchievements, ACHIEVEMENTS, type UserAchievement } from '@/lib/achievements-data';

interface Props {
  userId: string;
}

export default function AchievementsCard({ userId }: Props) {
  const { tt } = useI18n();
  const [list, setList] = useState<UserAchievement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUserAchievements(userId).then(setList).catch(() => setList([])).finally(() => setLoading(false));
  }, [userId]);

  if (loading) return <div className="card p-4 h-24 animate-pulse" />;
  if (list.length === 0) return null;

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <Trophy size={14} className="text-amber-500" />
          <h3 className="text-sm font-extrabold">{tt('달성한 배지')}</h3>
        </div>
        <span className="text-xs font-bold text-amber-600 tabular-nums">{list.length} / {Object.keys(ACHIEVEMENTS).length}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {list.map(a => {
          const def = ACHIEVEMENTS[a.code];
          if (!def) return null;
          return (
            <div key={a.code} className="rounded-xl bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-950/30 dark:to-yellow-950/20 border border-amber-200/60 dark:border-amber-800/40 p-2.5 text-center">
              <div className="text-2xl">{def.emoji}</div>
              <p className="text-[10px] font-extrabold mt-1 text-amber-900 dark:text-amber-200 leading-tight">{tt(def.name)}</p>
              <p className="text-[9px] text-amber-700/80 dark:text-amber-300/80 mt-0.5 line-clamp-1">{tt(def.description)}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
