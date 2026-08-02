'use client';

// 코호트 리더보드 (build 100) — /ranking 의 내 랭킹 카드 클릭 시 진입.
// scope: nation / region / decade / starter / gender × axis: today / month / year
// fetch_cohort_leaderboard RPC 사용. 내 위치 자동 highlight + auto scroll.

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, Globe, MapPin, Cake, Sparkles, Users, Trophy, UserCircle2 } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import AppLogo from '@/components/AppLogo';

type Scope = 'nation' | 'region' | 'decade' | 'starter' | 'gender';
type TimeAxis = 'today' | 'month' | 'year';

interface Row {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  region_gu: string | null;
  km: number;
  rank_position: number;
  is_me: boolean;
}

const SCOPE_LABELS: Record<Scope, { Icon: typeof Globe; title: string; sub: string }> = {
  nation: { Icon: Globe, title: '전국 전체', sub: '모든 러너 대상' },
  region: { Icon: MapPin, title: '내 지역', sub: '같은 구 러너끼리' },
  decade: { Icon: Cake, title: '내 또래·성별', sub: '같은 연령대·성별 전국' },
  starter: { Icon: Sparkles, title: '함께 시작한 러너', sub: '비슷한 시기에 가입한 러너' },
  gender: { Icon: Users, title: '같은 성별 전국', sub: '성별 기준 전국' },
};

function CohortInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, profile } = useAuth();

  const scope = (searchParams.get('scope') as Scope) ?? 'nation';
  const axis = (searchParams.get('axis') as TimeAxis) ?? 'month';
  const validScope: Scope = ['nation', 'region', 'decade', 'starter', 'gender'].includes(scope) ? scope : 'nation';
  const validAxis: TimeAxis = ['today', 'month', 'year'].includes(axis) ? axis : 'month';

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const meRowRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase.rpc('fetch_cohort_leaderboard', {
          caller_user_id: user.id,
          scope_type: validScope,
          time_axis: validAxis,
          result_limit: 100,
        });
        if (cancelled) return;
        if (error) {
          console.warn('[Cohort] RPC 실패', error);
          setRows([]);
        } else {
          setRows((data ?? []) as Row[]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, validScope, validAxis]);

  // 내 위치로 자동 스크롤 (TOP 10 밖이면)
  useEffect(() => {
    if (loading || rows.length === 0) return;
    const me = rows.find(r => r.is_me);
    if (me && me.rank_position > 10 && meRowRef.current) {
      meRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [loading, rows]);

  const meta = SCOPE_LABELS[validScope];
  const axisLabel = validAxis === 'today' ? '오늘' : validAxis === 'month' ? '이달' : '올해';
  const myRow = rows.find(r => r.is_me);

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/85 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="px-3 py-3 flex items-center gap-2">
          <button
            onClick={() => router.back()}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--card-border)]/30 active:scale-90 transition"
            aria-label="뒤로"
          >
            <ArrowLeft size={18} />
          </button>
          <AppLogo size={24} />
          <h1 className="text-base font-extrabold tracking-tight">코호트 랭킹</h1>
        </div>
      </header>

      {/* scope/axis 헤더 */}
      <div className="px-4 pt-4 pb-3">
        <div className="rounded-3xl bg-gradient-to-br from-emerald-50 via-white to-emerald-50/30 dark:from-emerald-950/30 dark:via-zinc-900 dark:to-emerald-950/10 border border-emerald-200/40 dark:border-emerald-900/30 p-5">
          <div className="flex items-center gap-2 mb-1">
            <meta.Icon size={16} className="text-emerald-600" />
            <p className="text-[12px] font-bold text-[var(--muted)] uppercase tracking-wide">{axisLabel}</p>
          </div>
          <h2 className="text-2xl font-extrabold text-[var(--foreground)]">{meta.title}</h2>
          <p className="text-xs text-[var(--muted)] mt-1">{meta.sub}</p>

          {myRow && (
            <div className="mt-4 flex items-center gap-3 px-3 py-2.5 rounded-2xl bg-white/80 dark:bg-zinc-900/60 backdrop-blur-sm">
              <span className="w-9 h-9 inline-flex items-center justify-center text-base font-extrabold rounded-full bg-emerald-500 text-white shadow-sm tabular-nums">
                {myRow.rank_position}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-extrabold text-emerald-700 dark:text-emerald-400">
                  내 순위
                </p>
                <p className="text-[13px] text-[var(--muted)]">
                  {profile?.display_name ?? '나'} · {Number(myRow.km).toFixed(1)}km
                </p>
              </div>
              <Trophy size={18} className="text-emerald-500 flex-shrink-0" />
            </div>
          )}
        </div>

        {/* axis 토글 */}
        <div className="flex gap-2 mt-3">
          {(['today', 'month', 'year'] as TimeAxis[]).map(a => (
            <Link
              key={a}
              href={`/ranking/cohort?scope=${validScope}&axis=${a}`}
              replace
              className={`flex-1 py-2 rounded-xl text-center text-xs font-bold transition ${
                validAxis === a
                  ? 'bg-emerald-500 text-white'
                  : 'bg-[var(--card)] text-[var(--muted)] border border-[var(--card-border)]'
              }`}
            >
              {a === 'today' ? '🔥 오늘' : a === 'month' ? '📅 이달' : '🏆 올해'}
            </Link>
          ))}
        </div>

        {/* scope 토글 — 가로 스크롤 */}
        <div className="flex gap-1.5 mt-3 overflow-x-auto scrollbar-hide pb-1">
          {(Object.keys(SCOPE_LABELS) as Scope[]).map(s => (
            <Link
              key={s}
              href={`/ranking/cohort?scope=${s}&axis=${validAxis}`}
              replace
              className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition ${
                validScope === s
                  ? 'bg-emerald-500 text-white shadow-sm'
                  : 'bg-[var(--card)] text-[var(--muted)] border border-[var(--card-border)]'
              }`}
            >
              {SCOPE_LABELS[s].title}
            </Link>
          ))}
        </div>
      </div>

      {/* 리스트 */}
      <div className="px-4">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="card p-6 text-center">
            <Trophy size={28} className="mx-auto text-[var(--muted)] opacity-40 mb-2" />
            <p className="text-sm font-semibold text-[var(--foreground)]">{axisLabel} 기록이 있는 러너가 없어요</p>
            <p className="text-xs text-[var(--muted)] mt-1">한 번 달리고 1위가 되어보세요!</p>
          </div>
        ) : (
          <ol className="space-y-1.5">
            {rows.map(r => {
              const isPodium = r.rank_position <= 3;
              const podiumBg =
                r.rank_position === 1 ? 'bg-gradient-to-br from-amber-300 to-yellow-500 text-white shadow-sm' :
                r.rank_position === 2 ? 'bg-gradient-to-br from-slate-300 to-slate-500 text-white shadow-sm' :
                r.rank_position === 3 ? 'bg-gradient-to-br from-orange-300 to-amber-600 text-white shadow-sm' :
                'bg-[var(--card-border)]/40 text-[var(--muted)]';
              return (
                <li key={r.user_id + ':' + r.rank_position} ref={r.is_me ? meRowRef : null}>
                  <Link
                    href={r.is_me ? '/profile' : `/social/user?id=${r.user_id}`}
                    className={`flex items-center gap-3 p-3 rounded-2xl border transition active:scale-[0.99] ${
                      r.is_me
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 shadow-sm'
                        : 'bg-[var(--card)] border-[var(--card-border)]'
                    }`}
                  >
                    <span className={`w-9 h-9 inline-flex items-center justify-center text-sm font-extrabold rounded-full flex-shrink-0 tabular-nums ${podiumBg}`}>
                      {r.rank_position}
                    </span>
                    <div className="w-10 h-10 rounded-full bg-[var(--card-border)] overflow-hidden flex-shrink-0">
                      {r.avatar_url ? (
                        <Image src={r.avatar_url} alt="" width={40} height={40} className="w-full h-full object-cover" />
                      ) : (
                        <UserCircle2 size={40} className="text-[var(--muted)]" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm truncate ${r.is_me ? 'font-extrabold text-emerald-700 dark:text-emerald-400' : 'font-semibold text-[var(--foreground)]'}`}>
                        {r.display_name}{r.is_me && <span className="ml-1">(나)</span>}
                      </p>
                      {r.region_gu && (
                        <p className="text-[13px] text-[var(--muted)] flex items-center gap-0.5">
                          <MapPin size={10} /> {r.region_gu}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className={`text-base font-extrabold tabular-nums ${isPodium ? 'text-emerald-600' : 'text-[var(--foreground)]'}`}>
                        {Number(r.km).toFixed(1)}
                      </p>
                      <p className="text-[12px] text-[var(--muted)]">km</p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

export default function CohortPage() {
  return (
    <Suspense fallback={<div className="p-8 flex justify-center"><div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" /></div>}>
      <CohortInner />
    </Suspense>
  );
}
