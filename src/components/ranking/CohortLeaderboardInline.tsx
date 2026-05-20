'use client';

// 코호트 인라인 리더보드 (build 104) — TOP 10 / 내 위치 토글.
// region / decade / gender / starter 4축 공용.
// fetch_cohort_leaderboard 로 한 번에 최대 50건 fetch → 클라사이드 슬라이스.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { ChevronRight, UserCircle2, type LucideIcon } from 'lucide-react';

type CohortScope = 'region' | 'decade' | 'gender' | 'starter';
type TimeAxis = 'today' | 'week' | 'month' | 'year';

interface CohortRow {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  region_gu: string | null;
  km: number;
  rank_position: number;
  is_me: boolean;
}

interface Props {
  scope: CohortScope;
  axis: TimeAxis;
  title: string;
  subtitle: string;
  Icon: LucideIcon;
}

const FETCH_LIMIT = 50;          // RPC fetch 한도
const TOP_VIEW_COUNT = 10;        // TOP 뷰에서 보여줄 수
const ME_WINDOW_BEFORE = 9;       // 내 위치 위로 9명
const ME_WINDOW_AFTER = 10;       // 내 위치 아래로 10명

export default function CohortLeaderboardInline({ scope, axis, title, subtitle, Icon }: Props) {
  const { user } = useAuth();
  const [allRows, setAllRows] = useState<CohortRow[] | null>(null);
  const [view, setView] = useState<'top' | 'me'>('top');

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setAllRows(null);
    (async () => {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase.rpc('fetch_cohort_leaderboard', {
          caller_user_id: user.id,
          scope_type: scope,
          time_axis: axis,
          result_limit: FETCH_LIMIT,
        });
        if (cancelled) return;
        if (error) { setAllRows([]); return; }
        setAllRows((data ?? []) as CohortRow[]);
      } catch { if (!cancelled) setAllRows([]); }
    })();
    return () => { cancelled = true; };
  }, [user, scope, axis]);

  if (allRows === null) {
    return <div className="h-44 rounded-2xl bg-[var(--card-border)]/30 animate-pulse" />;
  }
  if (allRows.length === 0) return null;

  const myRow = allRows.find(r => r.is_me);
  const hasMyView = !!myRow;

  // 내 위치 보기 — 내 인덱스 기준 ±윈도우. 내가 TOP 안이면 그래도 TOP 보여줌(중복 회피).
  let displayRows: CohortRow[];
  if (view === 'top' || !myRow) {
    displayRows = allRows.slice(0, TOP_VIEW_COUNT);
  } else {
    const myIdx = allRows.findIndex(r => r.is_me);
    const start = Math.max(0, myIdx - ME_WINDOW_BEFORE);
    const end = Math.min(allRows.length, myIdx + ME_WINDOW_AFTER + 1);
    displayRows = allRows.slice(start, end);
  }

  return (
    <div className="rounded-2xl bg-gradient-to-br from-emerald-100/60 via-white to-emerald-50/30 dark:from-emerald-950/20 dark:via-zinc-900 dark:to-emerald-950/10 border border-emerald-300/40 dark:border-emerald-800/30 p-4 shadow-sm">
      <Link
        href={`/ranking/cohort?scope=${scope}&axis=${axis}`}
        className="flex items-center justify-between mb-3 active:scale-[0.99] transition"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
            <Icon size={15} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-extrabold text-[var(--foreground)] truncate">{title}</p>
            <p className="text-[10px] text-[var(--muted)] truncate">{subtitle}</p>
          </div>
        </div>
        <span className="inline-flex items-center text-[11px] font-bold text-emerald-700 dark:text-emerald-400 flex-shrink-0">
          전체 <ChevronRight size={11} />
        </span>
      </Link>

      {hasMyView && (
        <div className="flex p-0.5 mb-2 rounded-lg bg-white/70 dark:bg-zinc-900/40 border border-[var(--card-border)]/30">
          <button
            type="button"
            onClick={() => setView('top')}
            className={`flex-1 py-1 rounded-md text-[11px] font-bold transition ${
              view === 'top'
                ? 'bg-emerald-500 text-white shadow-sm'
                : 'text-[var(--muted)]'
            }`}
          >
            TOP {TOP_VIEW_COUNT}
          </button>
          <button
            type="button"
            onClick={() => setView('me')}
            className={`flex-1 py-1 rounded-md text-[11px] font-bold transition ${
              view === 'me'
                ? 'bg-emerald-500 text-white shadow-sm'
                : 'text-[var(--muted)]'
            }`}
          >
            내 위치 {myRow && myRow.rank_position <= TOP_VIEW_COUNT ? '' : `(${myRow!.rank_position}위)`}
          </button>
        </div>
      )}

      <ol className="space-y-1.5">
        {displayRows.map(r => {
          const podiumBg =
            r.rank_position === 1 ? 'bg-gradient-to-br from-amber-300 to-yellow-500 text-white' :
            r.rank_position === 2 ? 'bg-gradient-to-br from-slate-300 to-slate-500 text-white' :
            r.rank_position === 3 ? 'bg-gradient-to-br from-orange-300 to-amber-600 text-white' :
            'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400';
          return (
            <li key={`${r.user_id}:${r.rank_position}`}>
              <Link
                href={r.is_me ? '/profile' : `/social/user?id=${r.user_id}`}
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition active:scale-[0.99] ${
                  r.is_me
                    ? 'bg-emerald-100/70 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700'
                    : 'hover:bg-white/60 dark:hover:bg-zinc-900/40'
                }`}
              >
                <span className={`w-7 h-7 inline-flex items-center justify-center text-xs font-extrabold rounded-full flex-shrink-0 tabular-nums ${podiumBg}`}>
                  {r.rank_position}
                </span>
                <div className="w-7 h-7 rounded-full bg-[var(--card-border)] overflow-hidden flex-shrink-0">
                  {r.avatar_url ? (
                    <Image src={r.avatar_url} alt="" width={28} height={28} className="w-full h-full object-cover" />
                  ) : (
                    <UserCircle2 size={28} className="text-[var(--muted)]" />
                  )}
                </div>
                <p className={`flex-1 min-w-0 text-sm truncate ${r.is_me ? 'font-extrabold text-emerald-700 dark:text-emerald-400' : 'font-semibold text-[var(--foreground)]'}`}>
                  {r.display_name}{r.is_me && <span className="ml-0.5">(나)</span>}
                </p>
                <span className="text-sm font-extrabold tabular-nums text-[var(--foreground)]">
                  {Number(r.km).toFixed(1)}<span className="text-[10px] font-bold text-[var(--muted)] ml-0.5">km</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
