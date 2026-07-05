'use client';

// 클럽 챌린지 + leaderboard (build 200 / Phase 4).
// club detail 페이지에 삽입. 활성 챌린지 목록 + 첫 챌린지 leaderboard 자동 표시.

import { useEffect, useState } from 'react';
import { Trophy, Flag, Users, Crown, Loader2 } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';

interface Challenge {
  id: string;
  title: string;
  description: string | null;
  target_km: number | null;
  target_run_count: number | null;
  start_date: string;
  end_date: string;
  days_left: number;
}

interface LeaderRow {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  total_km: number;
  total_runs: number;
  rank_position: number;
}

interface Props { clubId: string; }

export default function ClubChallengesCard({ clubId }: Props) {
  const { user } = useAuth();
  const { tt, locale } = useI18n();
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [leaders, setLeaders] = useState<LeaderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lbLoading, setLbLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data } = await supabase.rpc('get_active_club_challenges', { p_club_id: clubId });
        if (cancelled) return;
        const list = (data ?? []) as Challenge[];
        setChallenges(list);
        if (list.length > 0) setActiveId(list[0].id);
      } catch (e) { console.warn('[club-challenges] fetch fail', e); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [clubId]);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    setLbLoading(true);
    (async () => {
      try {
        const supabase = getSupabase();
        const { data } = await supabase.rpc('get_club_challenge_leaderboard', { p_challenge_id: activeId });
        if (cancelled) return;
        setLeaders((data ?? []) as LeaderRow[]);
      } catch (e) { console.warn('[club-leaderboard] fetch fail', e); }
      finally { if (!cancelled) setLbLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [activeId]);

  if (loading) return null;
  if (challenges.length === 0) return null;

  const active = challenges.find(c => c.id === activeId);

  return (
    <div className="card p-5 bg-gradient-to-br from-amber-50/50 via-transparent to-rose-50/40 dark:from-amber-950/15 dark:to-rose-950/10">
      <div className="flex items-center gap-2 mb-3">
        <Trophy size={16} className="text-amber-500" />
        <h3 className="text-sm font-extrabold">{tt('클럽 챌린지')}</h3>
        {challenges.length > 1 && (
          <span className="ml-auto text-[10px] font-bold text-[var(--muted)]">{locale === 'en' ? `${challenges.length} total` : `총 ${challenges.length}개`}</span>
        )}
      </div>

      {/* 챌린지 탭 */}
      {challenges.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto mb-3 -mx-1 px-1">
          {challenges.map(c => (
            <button key={c.id} onClick={() => setActiveId(c.id)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-extrabold transition ${
                c.id === activeId
                  ? 'bg-amber-500 text-white shadow-md'
                  : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--foreground)]'
              }`}>
              {c.title}
            </button>
          ))}
        </div>
      )}

      {active && (
        <>
          {challenges.length === 1 && <p className="text-base font-extrabold mb-1">{active.title}</p>}
          {active.description && (
            <p className="text-xs text-[var(--muted)] mb-3 leading-relaxed">{active.description}</p>
          )}

          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="text-center">
              <p className="text-2xl font-extrabold text-amber-600 tabular-nums">{active.days_left}</p>
              <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest">{tt('일 남음')}</p>
            </div>
            {active.target_km !== null && (
              <div className="text-center">
                <p className="text-2xl font-extrabold text-rose-600 tabular-nums">{active.target_km}</p>
                <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest">{tt('목표 km')}</p>
              </div>
            )}
            {active.target_run_count !== null && (
              <div className="text-center">
                <p className="text-2xl font-extrabold text-fuchsia-600 tabular-nums">{active.target_run_count}</p>
                <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest">{tt('목표 회수')}</p>
              </div>
            )}
          </div>

          {/* Leaderboard */}
          <div className="pt-3 border-t border-amber-200/40 dark:border-amber-900/30">
            <div className="flex items-center gap-1.5 mb-2.5">
              <Users size={12} className="text-amber-500" />
              <p className="text-[11px] font-extrabold uppercase tracking-widest text-[var(--muted)]">{tt('멤버 순위')}</p>
            </div>
            {lbLoading ? (
              <div className="py-4 text-center"><Loader2 size={14} className="animate-spin text-amber-500 mx-auto" /></div>
            ) : leaders.length === 0 ? (
              <p className="text-xs text-[var(--muted)] text-center py-3">{tt('아직 활동 기록이 없어요')}</p>
            ) : (
              <div className="space-y-1.5">
                {leaders.slice(0, 10).map(row => {
                  const isMe = row.user_id === user?.id;
                  return (
                    <div key={row.user_id}
                      className={`flex items-center gap-2.5 px-2.5 py-2 rounded-xl ${
                        isMe ? 'bg-amber-100 dark:bg-amber-950/30 ring-1 ring-amber-300/50' : 'bg-[var(--background)]'
                      }`}>
                      <div className="w-6 text-center">
                        {row.rank_position === 1 ? <Crown size={14} className="text-amber-500 mx-auto" />
                          : <span className="text-xs font-extrabold text-[var(--muted)]">{row.rank_position}</span>}
                      </div>
                      <p className={`flex-1 text-sm truncate ${isMe ? 'font-extrabold text-amber-700 dark:text-amber-300' : 'font-bold'}`}>
                        {row.display_name}{isMe && <span className="text-[10px] ml-1 text-amber-600">{tt('(나)')}</span>}
                      </p>
                      <p className="text-sm font-extrabold tabular-nums text-emerald-600">{row.total_km.toFixed(1)}km</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-3 pt-3 border-t border-amber-200/40 dark:border-amber-900/30 inline-flex items-center gap-1 text-[10px] text-[var(--muted)]">
            <Flag size={10} /> {active.start_date} ~ {active.end_date}
          </div>
        </>
      )}
    </div>
  );
}
