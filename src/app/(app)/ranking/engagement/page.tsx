'use client';

// 소셜 활성도 랭킹 (build 100) — 받은 좋아요 + 친구 수 metric.
// engagement_score = likes_received * 5 + followers_count * 10

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import AppLogo from '@/components/AppLogo';
import { ArrowLeft, Heart, Users, Sparkles, UserCircle2, MapPin } from 'lucide-react';

interface Row {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  region_gu: string | null;
  likes_received: number;
  followers_count: number;
  engagement_score: number;
  rank_position: number;
  is_me: boolean;
}

function EngagementInner() {
  const router = useRouter();
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase.rpc('fetch_engagement_leaderboard', { result_limit: 50 });
        if (cancelled) return;
        if (error) {
          console.warn('[Engagement] RPC 실패', error);
        } else {
          setRows((data ?? []) as Row[]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

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
          <h1 className="text-base font-extrabold tracking-tight">활성도 랭킹</h1>
        </div>
      </header>

      <div className="px-4 pt-4">
        <div className="rounded-3xl bg-gradient-to-br from-pink-50 via-white to-rose-50/30 dark:from-pink-950/30 dark:via-zinc-900 dark:to-rose-950/10 border border-pink-200/40 dark:border-pink-900/30 p-5">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={16} className="text-pink-500" />
            <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wide">사진·친구 활동 점수</p>
          </div>
          <h2 className="text-xl font-extrabold text-[var(--foreground)]">소셜 활성도</h2>
          <p className="text-xs text-[var(--muted)] mt-1">받은 좋아요 × 5 + 팔로워 × 10</p>

          {myRow && (
            <div className="mt-4 flex items-center gap-3 px-3 py-2.5 rounded-2xl bg-white/80 dark:bg-zinc-900/60 backdrop-blur-sm">
              <span className="w-9 h-9 inline-flex items-center justify-center text-base font-extrabold rounded-full bg-pink-500 text-white shadow-sm tabular-nums">
                {myRow.rank_position}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-extrabold text-pink-700 dark:text-pink-400">내 순위</p>
                <p className="text-[11px] text-[var(--muted)]">
                  좋아요 {myRow.likes_received} · 친구 {myRow.followers_count} · {myRow.engagement_score}점
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="px-4 mt-3">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin w-6 h-6 border-2 border-pink-500 border-t-transparent rounded-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="card p-6 text-center">
            <Sparkles size={28} className="mx-auto text-[var(--muted)] opacity-40 mb-2" />
            <p className="text-sm font-semibold">아직 활성도 점수가 모인 러너가 없어요</p>
            <p className="text-xs text-[var(--muted)] mt-1">사진을 올리고 친구를 추가하면 점수가 쌓여요</p>
          </div>
        ) : (
          <ol className="space-y-1.5">
            {rows.map(r => {
              const podiumBg =
                r.rank_position === 1 ? 'bg-gradient-to-br from-amber-300 to-yellow-500 text-white shadow-sm' :
                r.rank_position === 2 ? 'bg-gradient-to-br from-slate-300 to-slate-500 text-white shadow-sm' :
                r.rank_position === 3 ? 'bg-gradient-to-br from-orange-300 to-amber-600 text-white shadow-sm' :
                'bg-[var(--card-border)]/40 text-[var(--muted)]';
              return (
                <li key={r.user_id}>
                  <Link
                    href={r.is_me ? '/profile' : `/social/user?id=${r.user_id}`}
                    className={`flex items-center gap-3 p-3 rounded-2xl border transition active:scale-[0.99] ${
                      r.is_me
                        ? 'bg-pink-50 dark:bg-pink-950/40 border-pink-300 dark:border-pink-700 shadow-sm'
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
                      <p className={`text-sm truncate ${r.is_me ? 'font-extrabold text-pink-700 dark:text-pink-400' : 'font-semibold text-[var(--foreground)]'}`}>
                        {r.display_name}{r.is_me && <span className="ml-1">(나)</span>}
                      </p>
                      <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
                        <span className="inline-flex items-center gap-0.5"><Heart size={9} fill="currentColor" /> {r.likes_received}</span>
                        <span className="inline-flex items-center gap-0.5"><Users size={9} /> {r.followers_count}</span>
                        {r.region_gu && <span className="inline-flex items-center gap-0.5"><MapPin size={9} /> {r.region_gu}</span>}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-base font-extrabold text-pink-600 tabular-nums">{r.engagement_score}</p>
                      <p className="text-[10px] text-[var(--muted)]">점</p>
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

export default function EngagementPage() {
  return (
    <Suspense fallback={<div className="p-8 flex justify-center"><div className="animate-spin w-6 h-6 border-2 border-pink-500 border-t-transparent rounded-full" /></div>}>
      <EngagementInner />
    </Suspense>
  );
}
