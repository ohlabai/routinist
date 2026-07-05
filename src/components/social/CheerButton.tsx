'use client';

// 응원 보내기 버튼 — 랭킹/프로필 카드에 부착.
// 탭하면 5개 이모지 picker 가 떠오름. 같은 이모지는 주 1회 한도.

import { useEffect, useState } from 'react';
import { sendCheer, getMySentCheersThisWeek, CHEER_EMOJIS, type CheerEmoji } from '@/lib/cheer-data';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';

interface Props {
  toUserId: string;
  context?: 'ranking' | 'profile' | 'home_hero';
  size?: 'sm' | 'md';
}

export default function CheerButton({ toUserId, context = 'profile', size = 'md' }: Props) {
  const { user } = useAuth();
  const { tt, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [sentSet, setSentSet] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState<CheerEmoji | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    getMySentCheersThisWeek().then(setSentSet);
  }, [user, toUserId]);

  if (!user || user.id === toUserId) return null;  // 본인한테 못 보냄

  const handlePick = async (emoji: CheerEmoji) => {
    // 신문 모델 (build 57): optimistic update — 즉시 UI 반영, 서버 응답은 백그라운드.
    // 사용자가 "보냈는데 반응 없네?" 하지 않게.
    const cheerKey = `${toUserId}:${emoji}`;
    setSentSet(prev => new Set(prev).add(cheerKey));
    setToast(`${emoji} ${tt('응원 보냄!')}`);
    setSending(emoji);

    sendCheer(toUserId, emoji, context).then((result) => {
      setSending(null);
      if (!result.success) {
        // 실패 시 rollback — 같은 emoji 다시 보낼 수 있게
        setSentSet(prev => {
          const next = new Set(prev);
          next.delete(cheerKey);
          return next;
        });
        if (result.reason === 'already_sent_this_week') {
          setToast(tt('이번 주 같은 이모지로 이미 보냈어요'));
        } else {
          setToast(tt('응원 실패 — 다시 시도해주세요'));
        }
      }
    }).catch(() => {
      setSending(null);
      setSentSet(prev => {
        const next = new Set(prev);
        next.delete(cheerKey);
        return next;
      });
      setToast(tt('응원 실패 — 네트워크 확인'));
    });

    setTimeout(() => { setToast(null); setOpen(false); }, 1500);
  };

  const btnSize = size === 'sm' ? 'w-8 h-8 text-base' : 'w-10 h-10 text-lg';
  const containerCls = size === 'sm' ? 'gap-1' : 'gap-1.5';

  return (
    <div className="relative">
      {!open ? (
        <button
          onClick={(e) => { e.stopPropagation(); setOpen(true); }}
          className={`${btnSize} rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 active:scale-90 transition flex items-center justify-center`}
          aria-label={tt('응원 보내기')}
        >
          ❤️
        </button>
      ) : (
        <div className={`flex items-center ${containerCls} bg-white dark:bg-zinc-900 border border-emerald-200 dark:border-emerald-800 rounded-full px-1.5 py-1 shadow-md`}>
          {CHEER_EMOJIS.map(emoji => {
            const alreadySent = sentSet.has(`${toUserId}:${emoji}`);
            return (
              <button
                key={emoji}
                onClick={(e) => { e.stopPropagation(); !alreadySent && handlePick(emoji); }}
                disabled={alreadySent || sending !== null}
                className={`${btnSize} rounded-full active:scale-90 transition flex items-center justify-center ${
                  alreadySent ? 'opacity-30' : 'hover:bg-emerald-50'
                }`}
                title={alreadySent ? tt('이번 주 이미 보냄') : (locale === 'en' ? `Send ${emoji}` : `${emoji} 보내기`)}
              >
                {sending === emoji ? '⋯' : emoji}
              </button>
            );
          })}
          <button
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            className="text-xs text-[var(--muted)] px-1"
          >
            ✕
          </button>
        </div>
      )}
      {toast && (
        <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 whitespace-nowrap bg-white border border-emerald-200 text-emerald-700 text-xs font-semibold px-2.5 py-1 rounded-full shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
