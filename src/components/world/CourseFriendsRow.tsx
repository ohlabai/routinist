'use client';

// build 252: 같은 월드런 코스 진행중인 친구들. 상위 5명 아바타 + 진행률 막대.
// ProgressCard 안에 inline 으로 렌더링. 친구 0명이면 null 반환.

import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { fetchCourseFriends, type CourseFriend } from '@/lib/world-data';
import { useI18n } from '@/lib/i18n';

interface Props {
  courseId: string;
  courseDistanceKm: number;
  myProgressKm: number;
}

export default function CourseFriendsRow({ courseId, courseDistanceKm, myProgressKm }: Props) {
  const { tt, locale } = useI18n();
  const [friends, setFriends] = useState<CourseFriend[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await fetchCourseFriends(courseId);
      if (!cancelled) setFriends(list);
    })();
    return () => { cancelled = true; };
  }, [courseId]);

  if (!friends || friends.length === 0) return null;
  const myRatio = Math.min(1, Math.max(0, myProgressKm / courseDistanceKm));
  const top = friends.slice(0, 5);

  // 나보다 앞선 친구 수 (추월 동기 카피)
  const ahead = friends.filter(f => f.progress_km > myProgressKm).length;

  return (
    <div className="mt-3 pt-3 border-t border-[var(--card-border)]/40">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-[var(--text-muted)] inline-flex items-center gap-1">
          <Users size={12} className="text-emerald-500" />
          {tt('같이 달리는 친구')} {friends.length}
        </span>
        {ahead > 0 && (
          <span className="text-[10px] font-bold text-orange-600 dark:text-orange-400">
            {locale === 'en' ? `${ahead} ahead of you` : `${ahead}명이 앞서고 있어요`}
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        {top.map((f) => {
          const pct = Math.min(100, Math.max(0, f.ratio * 100));
          const completed = !!f.completed_at;
          return (
            <div key={f.user_id} className="flex items-center gap-2">
              {f.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center text-[9px] font-bold text-emerald-700 dark:text-emerald-400 flex-shrink-0">
                  {(f.display_name?.[0] ?? '?').toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between mb-0.5">
                  <span className="text-[11px] font-semibold truncate">{f.display_name}</span>
                  <span className={`text-[10px] tabular-nums font-bold ml-1 ${completed ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--text-muted)]'}`}>
                    {completed ? `🏆 ${tt('완주')}` : `${f.progress_km.toFixed(1)}km`}
                  </span>
                </div>
                <div className="h-1 rounded-full bg-[var(--card-border)]/30 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${completed ? 'bg-gradient-to-r from-amber-400 to-orange-500' : 'bg-gradient-to-r from-emerald-300 to-emerald-500'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 내 위치 표시 (mini) */}
      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[var(--card-border)]/30">
        <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
          <span className="text-[9px] font-extrabold text-white">{locale === 'en' ? 'Me' : '나'}</span>
        </div>
        <div className="flex-1">
          <div className="h-1 rounded-full bg-[var(--card-border)]/30 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-700"
              style={{ width: `${myRatio * 100}%` }}
            />
          </div>
        </div>
        <span className="text-[10px] tabular-nums font-bold text-emerald-600 dark:text-emerald-400">
          {myProgressKm.toFixed(1)}km
        </span>
      </div>
    </div>
  );
}
