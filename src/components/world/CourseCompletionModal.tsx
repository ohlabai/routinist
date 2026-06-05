'use client';

// build 251: 월드런 완주 축하 모달.
// 사용자가 메인 진입 시 fetchUnackCompletions() 가 row 를 돌려주면 한 번씩 모달 표시.
// "닫기" 누르면 ack_course_completion 로 표시 → 다음 진입 시 안 뜸.
//
// hans 가 도쿄/보스턴 완주했는데 모르고 지나간 사고 (2026-06-05) 의 1차 fix.
// 백필로 이미 완주된 row 도 acknowledged_at IS NULL → 첫 진입 시 일괄 표시.

import { useEffect, useState } from 'react';
import { X, Trophy, Sparkles, Share2 } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { ackCourseCompletion, fetchUnackCompletions, type UnackCompletion } from '@/lib/world-data';
import MedalShareCard from './MedalShareCard';

export default function CourseCompletionModal() {
  const { profile } = useAuth();
  const [queue, setQueue] = useState<UnackCompletion[]>([]);
  const [busy, setBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchUnackCompletions();
        if (!cancelled) setQueue(list);
      } catch (e) {
        console.warn('[CourseCompletionModal] fetch fail', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (queue.length === 0) return null;
  const current = queue[0];

  const handleAck = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await ackCourseCompletion(current.course_id);
    } catch (e) {
      console.warn('[CourseCompletionModal] ack fail', e);
    }
    setQueue((q) => q.slice(1));
    setShareOpen(false);
    setBusy(false);
  };

  const handleShare = () => {
    setShareOpen(true);
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="w-full sm:max-w-md bg-[var(--background)] rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-[slide-up_0.3s_ease-out]">
        {/* 헤더 */}
        <div className="relative bg-gradient-to-br from-emerald-500 to-emerald-700 px-6 py-8 text-white text-center">
          <button
            type="button"
            onClick={handleAck}
            disabled={busy}
            aria-label="닫기"
            className="absolute top-3 right-3 p-2 rounded-full hover:bg-white/10 transition disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-white/15 backdrop-blur-sm mb-3 animate-bounce">
            <Trophy className="w-10 h-10 text-yellow-300" />
          </div>
          <div className="text-xs font-medium opacity-80 mb-1">월드런 챌린지 완주</div>
          <h2 className="text-2xl font-bold flex items-center justify-center gap-2">
            {current.country?.split(' ')[0] ?? '🏁'} {current.name}
          </h2>
          <p className="text-sm opacity-90 mt-1">{Number(current.distance_km).toFixed(2)} km 완주</p>
        </div>

        {/* 바디 */}
        <div className="px-6 py-6 space-y-4">
          <div className="text-center">
            <div className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 text-sm font-medium">
              <Sparkles className="w-4 h-4" />
              축하해요! 메달을 손에 넣었어요
            </div>
          </div>

          {current.refund_amount > 0 && (
            <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-2xl px-5 py-4 flex items-center justify-between">
              <div>
                <div className="text-xs text-[var(--text-muted)] mb-0.5">완주 환급 보상</div>
                <div className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
                  + {current.refund_amount.toLocaleString()} P
                </div>
              </div>
              <div className="text-xs text-[var(--text-muted)] text-right">
                참가비의 50%<br />이미 적립됐어요
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 pt-2">
            <button
              type="button"
              onClick={handleAck}
              disabled={busy}
              className="py-3 rounded-2xl bg-[var(--card-bg)] text-[var(--foreground)] text-sm font-medium hover:bg-[var(--card-border)]/40 transition disabled:opacity-50"
            >
              닫기
            </button>
            <button
              type="button"
              onClick={handleShare}
              disabled={busy}
              className="py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white text-sm font-bold hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Share2 className="w-4 h-4" />
              메달 공유하기
            </button>
          </div>

          {queue.length > 1 && (
            <div className="text-center text-xs text-[var(--text-muted)] pt-1">
              + 추가 완주 {queue.length - 1}건이 더 있어요
            </div>
          )}
        </div>
      </div>

      {shareOpen && (
        <MedalShareCard
          courseName={current.name}
          countryFlag={current.country?.split(' ')[0] ?? '🏁'}
          distanceKm={Number(current.distance_km)}
          completedAt={current.completed_at}
          displayName={profile?.display_name ?? '러너'}
          refundAmount={current.refund_amount}
          onClose={handleAck}
        />
      )}

      <style jsx>{`
        @keyframes slide-up {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
