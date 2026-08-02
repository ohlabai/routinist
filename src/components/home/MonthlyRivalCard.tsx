'use client';

// build 280: 이달의 라이벌 카드. 홈 dashboard hero 영역.
// 모르는 사용자 1:1 매칭 — Duolingo Leagues 식 motivation.
// 클릭 시 라이벌 프로필 (/social/user?id=X)

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Swords, Calendar } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { fetchMyMonthlyRival, type MonthlyRival } from '@/lib/rival-data';
import { getFriendshipStatus } from '@/lib/friend-requests-data';
import FollowButton from '@/components/social/FollowButton';
import AppLogo from '@/components/AppLogo';

export default function MonthlyRivalCard() {
  const { user } = useAuth();
  const { locale } = useI18n();
  const [rival, setRival] = useState<MonthlyRival | null>(null);
  const [loading, setLoading] = useState(true);
  // build 327 (2026-07-28 hans): 매칭된 페이스메이커(비친구)와 바로 친구가 될 수 있게.
  // 이미 친구면 버튼 숨김 — 카드 본연의 대결 레이아웃 유지.
  const [friendStatus, setFriendStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    let mounted = true;
    fetchMyMonthlyRival().then(r => {
      if (mounted) { setRival(r); setLoading(false); }
      if (mounted && r) {
        getFriendshipStatus(r.rivalUserId)
          .then(s => { if (mounted) setFriendStatus(s.status); })
          .catch(() => {});
      }
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

  const monthNum = rival.month.split('-')[1].replace(/^0/, '');
  const monthLabel = locale === 'en' ? new Date(2000, parseInt(monthNum, 10) - 1, 1).toLocaleString('en-US', { month: 'short' }) : monthNum + '월';

  return (
    <div className="mx-4">
      <div className="card p-4 bg-gradient-to-br from-emerald-50 to-emerald-50/40 dark:from-emerald-950/30 dark:to-emerald-950/10 border-emerald-200/60 dark:border-emerald-800/40">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-3">
          <div className="inline-flex items-center gap-1.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-sm">
              <Swords size={14} className="text-white" strokeWidth={2.5} />
            </div>
            <h3 className="text-sm font-extrabold text-[var(--foreground)]">{locale === 'en' ? 'Monthly Pacemaker' : '이달의 페이스메이커'}</h3>
          </div>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100/80 dark:bg-emerald-900/30">
            <Calendar size={11} className="text-emerald-700 dark:text-emerald-300" />
            <span className="text-[12px] font-extrabold text-emerald-700 dark:text-emerald-300">
              {monthLabel} · D-{rival.daysLeft}
            </span>
          </span>
        </div>

        {/* 비교 — 나 vs 라이벌 */}
        <div className="grid grid-cols-2 gap-3 tabular-nums">
          {/* 나 */}
          <div className={`p-3 rounded-2xl text-center ${winning ? 'bg-emerald-100/60 dark:bg-emerald-900/30 border-2 border-emerald-300/60 dark:border-emerald-700/40' : 'bg-[var(--card)]'}`}>
            <p className="text-[12px] font-bold text-[var(--muted)] uppercase tracking-wider">{locale === 'en' ? 'YOU' : '나'}</p>
            <p className={`text-2xl font-extrabold mt-0.5 ${winning ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--foreground)]'}`}>
              {myKm.toFixed(1)}
            </p>
            <p className="text-[12px] text-[var(--muted)]">km</p>
          </div>
          {/* 라이벌 */}
          <Link href={`/social/user?id=${rival.rivalUserId}`}
            className={`p-3 rounded-2xl text-center active:scale-[0.98] transition bg-[var(--card)]`}
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
              <p className="text-[12px] font-bold text-[var(--muted)] uppercase tracking-wider truncate max-w-[80px]">
                {rival.rivalDisplayName ?? (locale === 'en' ? 'Pacemaker' : '페이스메이커')}
              </p>
            </div>
            <p className={`text-2xl font-extrabold text-[var(--foreground)]`}>
              {rivalKm.toFixed(1)}
            </p>
            <p className="text-[12px] text-[var(--muted)]">km</p>
          </Link>
        </div>

        {/* 진행 바 — 양쪽 비율 */}
        <div className="mt-3 h-2 rounded-full bg-[var(--card-border)]/30 overflow-hidden flex">
          <div className="bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all"
               style={{ width: `${myPct}%` }} />
          <div className="bg-gradient-to-r from-slate-300 to-slate-400 dark:from-slate-600 dark:to-slate-500 transition-all"
               style={{ width: `${100 - myPct}%` }} />
        </div>

        {/* 콜아웃 */}
        <p className="mt-2.5 text-[13px] text-center font-bold text-[var(--muted)] break-keep">
          {locale === 'en' ? (
            winning ? (
              diff > 5
                ? `🔥 You're ${diff.toFixed(1)}km ahead!`
                : `One more run and you'll widen the gap`
            ) : myKm < rivalKm ? (
              diff > 5
                ? `Your pacemaker is ${diff.toFixed(1)}km ahead. Time to catch up!`
                : `${diff.toFixed(1)}km gap. One run could flip it!`
            ) : (
              `It's close — start the next run?`
            )
          ) : (
            winning ? (
              diff > 5
                ? `🔥 ${diff.toFixed(1)}km 앞서고 있어요!`
                : `한 번 더 뛰면 격차를 더 벌릴 수 있어요`
            ) : myKm < rivalKm ? (
              diff > 5
                ? `페이스메이커가 ${diff.toFixed(1)}km 앞섰어요. 따라잡기 시작!`
                : `${diff.toFixed(1)}km 차이. 한 번만 뛰면 역전!`
            ) : (
              '아직 비슷해요. 먼저 출발해볼까요?'
            )
          )}
        </p>

        {/* 친구 신청 — 한 달을 함께 달리는 사이, 친구로 이어지게 (비친구일 때만) */}
        {friendStatus && friendStatus !== 'friend' && friendStatus !== 'request_received' && (
          <div className="mt-2.5 flex justify-center">
            <FollowButton userId={rival.rivalUserId} initialFollowing={false} size="sm" />
          </div>
        )}
      </div>
    </div>
  );
}
