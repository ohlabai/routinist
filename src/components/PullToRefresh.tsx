'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface Props {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
}

// 신문 모델 (build 58): UX 정비 — 단계 라벨, 부드러운 회전, 완료 후 success flash.
export default function PullToRefresh({ onRefresh, children }: Props) {
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [justRefreshed, setJustRefreshed] = useState(false);
  const startY = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const threshold = 70;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (containerRef.current && containerRef.current.scrollTop === 0) {
      startY.current = e.touches[0].clientY;
      setPulling(true);
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!pulling || refreshing) return;
    const diff = e.touches[0].clientY - startY.current;
    if (diff > 0) {
      // 감쇠: 멀리 당길수록 점점 더 무거워지게
      setPullDistance(Math.min(diff * 0.45, 110));
    }
  }, [pulling, refreshing]);

  const handleTouchEnd = useCallback(async () => {
    if (!pulling) return;
    setPulling(false);

    if (pullDistance >= threshold && !refreshing) {
      setRefreshing(true);
      setPullDistance(threshold * 0.7);
      try {
        await onRefresh();
        setJustRefreshed(true);
      } finally {
        setRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pulling, pullDistance, refreshing, onRefresh]);

  // 완료 flash — "방금 갱신됨" 1.2초 표시 후 사라짐
  useEffect(() => {
    if (!justRefreshed) return;
    const id = setTimeout(() => setJustRefreshed(false), 1200);
    return () => clearTimeout(id);
  }, [justRefreshed]);

  // 0~1 진행률 — 스피너 회전과 라벨 분기에 사용
  const progress = Math.min(pullDistance / threshold, 1);
  const overThreshold = progress >= 1;

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto relative"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* 풀 인디케이터 */}
      <div
        className="flex items-center justify-center overflow-hidden transition-[height] duration-200 ease-out"
        style={{ height: pullDistance > 0 ? pullDistance : 0 }}
      >
        {refreshing ? (
          <div className="flex flex-col items-center gap-1.5">
            <div className="animate-spin w-6 h-6 border-[2.5px] border-emerald-500 border-t-transparent rounded-full" />
            <span className="text-xs font-medium text-emerald-600">새로고침 중…</span>
          </div>
        ) : pullDistance > 0 ? (
          <div className="flex flex-col items-center gap-1.5">
            {/* 진행률 따라 채워지는 원 — 임계값 도달 시 emerald, 그 전엔 회색 */}
            <div className="relative w-7 h-7">
              <svg viewBox="0 0 36 36" className="w-7 h-7 -rotate-90">
                <circle cx="18" cy="18" r="15" fill="none"
                        stroke="currentColor" strokeWidth="3"
                        className="text-emerald-100 dark:text-emerald-950/50" />
                <circle cx="18" cy="18" r="15" fill="none"
                        stroke="currentColor" strokeWidth="3"
                        strokeDasharray={`${progress * 94.2} 94.2`}
                        strokeLinecap="round"
                        className={`transition-colors ${overThreshold ? 'text-emerald-500' : 'text-emerald-300'}`} />
              </svg>
            </div>
            <span className={`text-xs font-medium transition-colors ${overThreshold ? 'text-emerald-600' : 'text-[var(--muted)]'}`}>
              {overThreshold ? '놓으면 새로고침' : '당겨서 새로고침'}
            </span>
          </div>
        ) : null}
      </div>

      {/* 완료 flash — 헤더 위에 살짝 떠오른 success */}
      {justRefreshed && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <div className="px-3 py-1.5 rounded-full bg-emerald-500 text-white text-xs font-semibold shadow-md animate-[fadeInUp_0.3s_ease-out]">
            ✓ 새로고침 완료
          </div>
        </div>
      )}

      {children}
    </div>
  );
}
