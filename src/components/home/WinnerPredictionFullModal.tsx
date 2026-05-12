'use client';

// 우승자 맞히기 — 전체 후보 (TOP 30) 풀스크린 모달.
// 위젯의 2x2 grid 로는 4명까지만 노출되어 사용자가 "선택지가 너무 적다" 신고.
// build 100: 백엔드는 이미 global cohort, UI 만 확장.

import { useEffect, useState } from 'react';
import { X, Check, Trophy } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';

interface Candidate {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  region_gu: string | null;
  recent_km: number;
}

interface Props {
  roundId: string;
  myPick: string | null;
  isClosed: boolean;
  onClose: () => void;
  // 픽 처리는 부모(위젯) 에서 — 그래야 위젯의 round.my_pick 상태와 일치
  onPick: (userId: string) => Promise<void>;
}

export default function WinnerPredictionFullModal({ roundId, myPick, isClosed, onClose, onPick }: Props) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getSupabase();
      const result = await Promise.race([
        supabase.rpc('get_prediction_candidates', { p_round_id: roundId, p_limit: 30 }),
        new Promise<{ data: null }>((resolve) =>
          setTimeout(() => resolve({ data: null }), 10000)
        ),
      ]);
      if (cancelled) return;
      setCandidates((result.data ?? []) as Candidate[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [roundId]);

  // body scroll lock — 모달 뒤 페이지 스크롤 막기
  useEffect(() => {
    const orig = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = orig; };
  }, []);

  const handlePick = async (userId: string) => {
    if (picking !== null) return;
    setPicking(userId);
    try {
      await onPick(userId);
    } finally {
      setPicking(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-[var(--background)] w-full max-w-lg max-h-[85vh] rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="sticky top-0 z-10 bg-[var(--background)]/95 backdrop-blur-lg border-b border-[var(--card-border)] px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Trophy size={20} className="text-emerald-600 flex-shrink-0" />
            <h2 className="text-base font-extrabold text-[var(--foreground)] truncate">우승자 맞히기 — 전체 후보</h2>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-[var(--card-border)]/40 flex items-center justify-center active:scale-95 transition flex-shrink-0"
            aria-label="닫기"
          >
            <X size={18} className="text-[var(--foreground)]" />
          </button>
        </div>

        {/* 안내 */}
        <div className="px-5 py-3 bg-emerald-50/50 dark:bg-emerald-950/10 border-b border-emerald-100 dark:border-emerald-900/30">
          <p className="text-xs text-[var(--muted)] leading-relaxed">
            전국 이번 주 거리 상위 후보들이에요. 1명만 응원할 수 있고, 변경은 불가능합니다.
            {myPick && <span className="block mt-1 font-bold text-emerald-600">이미 픽한 후보가 있어요.</span>}
          </p>
        </div>

        {/* 후보 리스트 */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
            </div>
          ) : candidates.length === 0 ? (
            <p className="text-center text-sm text-[var(--muted)] py-12">아직 이번 주에 달린 사람이 없어요</p>
          ) : (
            <ul className="space-y-1.5 py-2">
              {candidates.map((c, i) => {
                const isMyPick = myPick === c.user_id;
                const disabled = isClosed || (!!myPick && !isMyPick);
                const rank = i + 1;
                const isPodium = rank <= 3;
                const podiumBg =
                  rank === 1 ? 'bg-gradient-to-br from-amber-400 to-yellow-500 text-white' :
                  rank === 2 ? 'bg-gradient-to-br from-slate-300 to-slate-500 text-white' :
                  rank === 3 ? 'bg-gradient-to-br from-orange-400 to-amber-600 text-white' :
                  'bg-[var(--card-border)]/40 text-[var(--muted)]';
                return (
                  <li key={c.user_id}>
                    <button
                      onClick={() => handlePick(c.user_id)}
                      disabled={picking !== null}
                      className={`w-full flex items-center gap-3 p-3 rounded-2xl border transition active:scale-[0.98] ${
                        isMyPick
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 shadow-sm'
                          : disabled
                            ? 'bg-[var(--card)] border-[var(--card-border)] opacity-60'
                            : 'bg-[var(--card)] border-[var(--card-border)] hover:border-emerald-300'
                      }`}
                    >
                      {/* 랭킹 배지 */}
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-extrabold flex-shrink-0 ${podiumBg} ${isPodium ? 'shadow-md' : ''}`}>
                        {rank}
                      </div>

                      {/* 아바타 */}
                      <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden flex-shrink-0">
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

                      {isMyPick && <Check size={20} className="text-emerald-500 flex-shrink-0" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-[var(--card-border)] px-5 py-3 text-center">
          <p className="text-[11px] text-[var(--muted)]">일요일 자정 결과 공개 · 맞추면 +10점 + 예측왕 뱃지</p>
        </div>
      </div>
    </div>
  );
}
