'use client';

// 우승자 맞추기 위젯 — 매주 월요일 시작, 토요일 자정 마감, 일요일 자정 정산.
// 1인 1픽 (변경 불가). 마일리지 X. 맞추면 +10 점 + "예측왕" 뱃지.

import { useEffect, useState, useCallback } from 'react';
import { Trophy, Check } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import AppToast from '@/components/AppToast';

interface Round {
  id: string;
  week_of: string;
  starts_at: string;
  closes_at: string;
  ends_at: string;
  state: 'open' | 'locked' | 'settled';
  my_pick: string | null;
  total_picks: number;
}

interface Candidate {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  region_gu: string | null;
  recent_km: number;
}

export default function WinnerPredictionWidget() {
  const { user } = useAuth();
  const [round, setRound] = useState<Round | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const supabase = getSupabase();
      // 토큰 stale 시 RPC hang 방지 — 10s race
      const roundResult = await Promise.race([
        supabase.rpc('get_current_prediction_round'),
        new Promise<{ data: null }>((resolve) =>
          setTimeout(() => resolve({ data: null }), 10000)
        ),
      ]);
      const roundData = roundResult.data;
      const r = (Array.isArray(roundData) && roundData[0]) ? roundData[0] as Round : null;
      setRound(r);
      if (r) {
        const candResult = await Promise.race([
          supabase.rpc('get_prediction_candidates', {
            p_round_id: r.id,
            p_limit: 8,
          }),
          new Promise<{ data: null }>((resolve) =>
            setTimeout(() => resolve({ data: null }), 10000)
          ),
        ]);
        setCandidates((candResult.data ?? []) as Candidate[]);
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const pick = async (userId: string) => {
    if (!round || !user) return;
    if (round.my_pick) {
      setToast('이미 픽했습니다 (변경 불가)');
      setTimeout(() => setToast(null), 2000);
      return;
    }
    setPicking(userId);

    // 낙관적 업데이트 — DB latency 동안 my_pick 가 null 로 깜빡이는 거 방지.
    // (변경 불가 정책이라 rollback 시 round 자체를 reload — load() 가 정확값으로 덮음)
    const previousRound = round;
    setRound({ ...round, my_pick: userId, total_picks: round.total_picks + 1 });

    try {
      const supabase = getSupabase();
      const { error } = await supabase.from('prediction_picks').insert({
        round_id: round.id,
        user_id: user.id,
        picked_user_id: userId,
      });
      if (error) {
        // rollback
        setRound(previousRound);
        if (error.code === '23505') {
          setToast('이미 픽했습니다');
          await load(); // 진실값으로 동기화
        } else {
          setToast('픽 실패: ' + error.message);
        }
      } else {
        setToast('픽 완료! 일요일 자정에 결과 공개');
        // 낙관적 값이 정답에 가까우니 background 로 reload (UI 깜빡임 없음)
        void load();
      }
    } finally {
      setPicking(null);
      setTimeout(() => setToast(null), 2500);
    }
  };

  if (loading || !round) return null;

  const closesIn = new Date(round.closes_at).getTime() - Date.now();
  const hoursLeft = Math.max(0, Math.floor(closesIn / 3600_000));
  const daysLeft = Math.floor(hoursLeft / 24);
  const timeLabel = daysLeft > 0 ? `${daysLeft}일 ${hoursLeft % 24}시간 남음` : hoursLeft > 0 ? `${hoursLeft}시간 남음` : '곧 마감';
  const isClosed = closesIn <= 0 || round.state !== 'open';

  return (
    <div className="mx-4 mt-3 rounded-3xl bg-gradient-to-br from-yellow-50 via-white to-amber-50 dark:from-yellow-950/20 dark:via-zinc-900 dark:to-amber-950/10 border border-yellow-200/60 dark:border-yellow-800/30 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-base font-bold text-[var(--foreground)] flex items-center gap-1.5">
            🏆 이번 주 우승자 맞히기
          </p>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            {isClosed ? '마감됨 — 일요일 자정 결과 공개' : timeLabel} · {round.total_picks}명 참여
          </p>
        </div>
        {round.my_pick && (
          <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
            <Check size={14} /> 픽 완료
          </span>
        )}
      </div>

      {candidates.length === 0 ? (
        <p className="text-xs text-[var(--muted)] text-center py-4">아직 이번 주에 달린 사람이 없어요</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {candidates.slice(0, 4).map(c => {
            const isMyPick = round.my_pick === c.user_id;
            const alreadyPicked = round.my_pick !== null && !isMyPick;
            const handleClick = () => {
              if (alreadyPicked) {
                // 다정한 안내 (build 63: 사용자 신고 #1-1.C)
                setToast('한 번 정한 응원 픽은 일요일까지! 다음 주에 다시 만나요 ✨');
                setTimeout(() => setToast(null), 3000);
                return;
              }
              pick(c.user_id);
            };
            return (
              <button
                key={c.user_id}
                onClick={handleClick}
                disabled={isClosed || picking !== null}
                className={`flex items-center gap-2 p-2 rounded-xl border transition active:scale-95 ${
                  isMyPick
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700'
                    : 'bg-white dark:bg-zinc-900 border-[var(--card-border)] hover:border-yellow-300'
                } ${alreadyPicked ? 'opacity-50' : ''}`}
              >
                <div className="w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden flex-shrink-0">
                  {c.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : null}
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-bold text-[var(--foreground)] truncate">{c.display_name}</p>
                  <p className="text-xs text-[var(--muted)] truncate">
                    {c.recent_km}km · {c.region_gu ?? '—'}
                  </p>
                </div>
                {isMyPick && <Check size={16} className="text-emerald-500 flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      )}

      {/* 픽 완료 후 안내 박스 제거 — 사용자가 다른 후보 누르면 다이얼로그로 안내 (build 63 회고). */}
      {toast && <AppToast text={toast} tone="info" onClose={() => setToast(null)} durationMs={3000} />}
    </div>
  );
}
