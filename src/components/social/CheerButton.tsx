'use client';

// 응원 보내기 버튼 — 모든 응원 표면의 단일 폼 (2026-07-30 hans 통일 재설계).
// - 탭 = ❤️ 즉시 발사. **몇 번이든 OK** (주 1회 제한 제거 — DB unique 드롭과 세트).
// - 매 발사마다 픽셀 블록 하트가 흩날리는 버스트 — "보냈다" 가 눈으로 즉시 보임.
// - 꾹 누르면 (450ms) 5종 이모지 picker (안내 카피는 두지 않는다 — 발견하는 재미).
// - 알림 스팸은 서버 트리거가 시간당 1건으로 dedup (notify_on_cheer).

import { useEffect, useRef, useState } from 'react';
import { sendCheer, CHEER_EMOJIS, type CheerEmoji } from '@/lib/cheer-data';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';

interface Props {
  toUserId: string;
  context?: 'ranking' | 'profile' | 'home_hero' | 'activity' | 'club';
  size?: 'sm' | 'md';
}

// 잔디 블록 문법의 픽셀 하트 (7×6) — 1=라이트 로즈, 2=딥 로즈
const HEART_GRID: number[][] = [
  [0, 1, 1, 0, 1, 1, 0],
  [1, 2, 2, 1, 2, 2, 1],
  [1, 2, 2, 2, 2, 2, 1],
  [0, 1, 2, 2, 2, 1, 0],
  [0, 0, 1, 2, 1, 0, 0],
  [0, 0, 0, 1, 0, 0, 0],
];
const HEART_COLORS: Record<number, string> = { 1: '#fb7185', 2: '#f43f5e' };

function PixelHeart({ size = 14 }: { size?: number }) {
  const cell = size / 7;
  return (
    <svg width={size} height={(size * 6) / 7} viewBox={`0 0 ${size} ${(size * 6) / 7}`} aria-hidden>
      {HEART_GRID.map((row, y) =>
        row.map((v, x) =>
          v === 0 ? null : (
            <rect
              key={`${x}-${y}`}
              x={x * cell}
              y={y * cell}
              width={cell * 0.92}
              height={cell * 0.92}
              rx={cell * 0.2}
              fill={HEART_COLORS[v]}
            />
          )
        )
      )}
    </svg>
  );
}

interface Burst {
  id: number;
  emoji: CheerEmoji;
}

/** 발사 버스트 — 버튼 중심에서 픽셀 하트(또는 이모지)들이 흩날리며 사라진다 */
function BurstLayer({ bursts }: { bursts: Burst[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-visible" aria-hidden>
      {bursts.map((b) => (
        <span key={b.id}>
          {Array.from({ length: 7 }, (_, i) => {
            const dx = Math.round(Math.random() * 72 - 36);
            const dy = -Math.round(28 + Math.random() * 46);
            const rot = Math.round(Math.random() * 70 - 35);
            const dur = 0.85 + Math.random() * 0.45;
            const delay = Math.random() * 0.12;
            return (
              <span
                key={i}
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{
                  animation: `cheer-fly ${dur}s ease-out ${delay}s forwards`,
                  ['--dx' as string]: `${dx}px`,
                  ['--dy' as string]: `${dy}px`,
                  ['--rot' as string]: `${rot}deg`,
                  opacity: 0,
                }}
              >
                {b.emoji === '❤️' ? <PixelHeart size={12 + Math.round(Math.random() * 6)} /> : (
                  <span className="text-sm">{b.emoji}</span>
                )}
              </span>
            );
          })}
        </span>
      ))}
    </div>
  );
}

export default function CheerButton({ toUserId, context = 'profile', size = 'md' }: Props) {
  const { user } = useAuth();
  const { tt, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const burstIdRef = useRef(0);
  const lastSentAtRef = useRef(0);
  // 꾹 누르기 감지 — PhotoCard 더블탭 패턴처럼 ref 로 (렌더마다 초기화되면 안 됨)
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressedRef = useRef(false);

  // 언마운트 시 타이머 정리
  useEffect(() => () => { if (pressTimerRef.current) clearTimeout(pressTimerRef.current); }, []);

  if (!user || user.id === toUserId) return null;  // 본인한테 못 보냄

  const fire = (emoji: CheerEmoji) => {
    // 연타 허용하되 250ms 최소 간격 — 실수 도배 방지 (재미는 유지)
    const now = Date.now();
    if (now - lastSentAtRef.current < 250) return;
    lastSentAtRef.current = now;

    // 버스트는 즉시 (optimistic) — 서버 응답은 백그라운드
    const id = ++burstIdRef.current;
    setBursts((prev) => [...prev.slice(-3), { id, emoji }]);
    setTimeout(() => setBursts((prev) => prev.filter((b) => b.id !== id)), 1500);

    sendCheer(toUserId, emoji, context).then((result) => {
      if (!result.success && result.reason !== 'already_sent_this_week') {
        setToast(tt('응원 실패 — 다시 시도해주세요'));
        setTimeout(() => setToast(null), 2000);
      }
    }).catch(() => {
      setToast(tt('응원 실패 — 네트워크 확인'));
      setTimeout(() => setToast(null), 2000);
    });
  };

  const btnSize = size === 'sm' ? 'w-8 h-8 text-base' : 'w-10 h-10 text-lg';
  const containerCls = size === 'sm' ? 'gap-1' : 'gap-1.5';

  // 탭 = ❤️ 즉시 / 꾹 (450ms) = picker. pointer 이벤트로 판별.
  const startPress = (e: React.PointerEvent) => {
    e.stopPropagation();
    longPressedRef.current = false;
    pressTimerRef.current = setTimeout(() => {
      longPressedRef.current = true;
      setOpen(true);
    }, 450);
  };
  const endPress = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (pressTimerRef.current) { clearTimeout(pressTimerRef.current); pressTimerRef.current = null; }
    if (longPressedRef.current) return;  // picker 가 이미 열림 — 발사 안 함
    fire('❤️');
  };
  const cancelPress = () => {
    if (pressTimerRef.current) { clearTimeout(pressTimerRef.current); pressTimerRef.current = null; }
  };

  return (
    <div className="relative">
      {!open ? (
        <button
          onPointerDown={startPress}
          onPointerUp={endPress}
          onPointerLeave={cancelPress}
          onPointerCancel={cancelPress}
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
          onContextMenu={(e) => e.preventDefault()}
          className={`${btnSize} rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 active:scale-90 transition flex items-center justify-center select-none`}
          aria-label={locale === 'en' ? 'Send a cheer' : '응원 보내기'}
        >
          ❤️
        </button>
      ) : (
        <div className={`flex items-center ${containerCls} bg-white dark:bg-zinc-900 border border-emerald-200 dark:border-emerald-800 rounded-full px-1.5 py-1 shadow-md`}>
          {CHEER_EMOJIS.map(emoji => (
            <button
              key={emoji}
              onClick={(e) => { e.stopPropagation(); fire(emoji); }}
              className={`${btnSize} rounded-full active:scale-90 transition flex items-center justify-center hover:bg-emerald-50`}
              title={locale === 'en' ? `Send ${emoji}` : `${emoji} 보내기`}
            >
              {emoji}
            </button>
          ))}
          <button
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            className="text-xs text-[var(--muted)] px-1"
          >
            ✕
          </button>
        </div>
      )}
      <BurstLayer bursts={bursts} />
      {toast && (
        <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 whitespace-nowrap bg-white border border-emerald-200 text-emerald-700 text-xs font-semibold px-2.5 py-1 rounded-full shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
