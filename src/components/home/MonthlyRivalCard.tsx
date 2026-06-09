'use client';

// build 280: 이달의 라이벌 카드. 홈 dashboard hero 영역.
// 모르는 사용자 1:1 매칭 — Duolingo Leagues 식 motivation.
// 클릭 시 라이벌 프로필 (/social/user?id=X)

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Swords, Calendar } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { fetchMyMonthlyRival, type MonthlyRival } from '@/lib/rival-data';
import AppLogo from '@/components/AppLogo';

export default function MonthlyRivalCard() {
  const { user } = useAuth();
  const [rival, setRival] = useState<MonthlyRival | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    let mounted = true;
    fetchMyMonthlyRival().then(r => {
      if (mounted) { setRival(r); setLoading(false); }
    }).catch(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [user]);

  if (loading || !rival) return null;

  const myKm = rival.myKm;
  const rivalKm = rival.rivalKm;
  const total = Math.max(myKm + rivalKm, 0.1);
  const myPct = (myKm / total) * 100;
  const winning = myKm > rivalKm;
  const diff = Math.abs(myKm - rivalKm);

  const monthLabel = rival.month.split('-')[1].replace(/^0/, '') + '월';

  return (
    <div className="mx-4">
      <div className="card p-4 bg-gradient-to-br from-amber-50 to-orange-50/40 dark:from-amber-950/30 dark:to-orange-950/15 border-amber-200/60 dark:border-amber-800/40">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-3">
          <div className="inline-flex items-center gap-1.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-sm">
              <Swords size={14} className="text-white" strokeWidth={2.5} />
            </div>
            <h3 className="text-sm font-extrabold text-[var(--foreground)]">이달의 라이벌</h3>
          </div>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100/80 dark:bg-amber-900/30">
            <Calendar size={11} className="text-amber-700 dark:text-amber-300" />
            <span className="text-[10px] font-extrabold text-amber-700 dark:text-amber-300">
              {monthLabel} · D-{rival.daysLeft}
            </span>
          </span>
        </div>

        {/* 비교 — 나 vs 라이벌 */}
        <div className="grid grid-cols-2 gap-3 tabular-nums">
          {/* 나 */}
          <div className={`p-3 rounded-2xl text-center ${winning ? 'bg-emerald-100/60 dark:bg-emerald-900/30 border-2 border-emerald-300/60 dark:border-emerald-700/40' : 'bg-[var(--card)]'}`}>
            <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">나</p>
            <p className={`text-2xl font-extrabold mt-0.5 ${winning ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--foreground)]'}`}>
              {myKm.toFixed(1)}
            </p>
            <p className="text-[10px] text-[var(--muted)]">km</p>
          </div>
          {/* 라이벌 */}
          <Link href={`/social/user?id=${rival.rivalUserId}`}
            className={`p-3 rounded-2xl text-center active:scale-[0.98] transition ${!winning && myKm < rivalKm ? 'bg-rose-100/60 dark:bg-rose-900/30 border-2 border-rose-300/60 dark:border-rose-700/40' : 'bg-[var(--card)]'}`}
          >
            <div className="flex items-center justify-center gap-1.5 mb-0.5">
              <div className="w-5 h-5 rounded-full bg-[var(--card-border)] overflow-hidden flex-shrink-0">
                {rival.rivalAvatarUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={rival.rivalAvatarUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center"><AppLogo size={12} /></div>
                )}
              </div>
              <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider truncate max-w-[80px]">
                {rival.rivalDisplayName ?? '라이벌'}
              </p>
            </div>
            <p className={`text-2xl font-extrabold ${!winning && myKm < rivalKm ? 'text-rose-600 dark:text-rose-400' : 'text-[var(--foreground)]'}`}>
              {rivalKm.toFixed(1)}
            </p>
            <p className="text-[10px] text-[var(--muted)]">km</p>
          </Link>
        </div>

        {/* 진행 바 — 양쪽 비율 */}
        <div className="mt-3 h-2 rounded-full bg-[var(--card-border)]/30 overflow-hidden flex">
          <div className="bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all"
               style={{ width: `${myPct}%` }} />
          <div className="bg-gradient-to-r from-rose-400 to-rose-500 transition-all"
               style={{ width: `${100 - myPct}%` }} />
        </div>

        {/* 콜아웃 */}
        <p className="mt-2.5 text-[11px] text-center font-bold text-[var(--muted)] break-keep">
          {winning ? (
            diff > 5
              ? `🔥 ${diff.toFixed(1)}km 앞서고 있어요!`
              : `한 번 더 뛰면 격차를 더 벌릴 수 있어요`
          ) : myKm < rivalKm ? (
            diff > 5
              ? `라이벌이 ${diff.toFixed(1)}km 앞섰어요. 따라잡기 시작!`
              : `${diff.toFixed(1)}km 차이. 한 번만 뛰면 역전!`
          ) : (
            '아직 비슷해요. 먼저 출발해볼까요?'
          )}
        </p>
      </div>
    </div>
  );
}
