'use client';

// 신문 모델 (build 57): "마지막 갱신 N분 전" 작은 배지.
// 사용자가 보고 있는 데이터의 신선도를 직관적으로 알게 함.
// 너무 오래되면 사용자가 자연스럽게 PullToRefresh / 새로고침 버튼을 누름.

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

interface Props {
  /** 데이터를 캐시/메모리에 저장한 시각 (ms epoch). null 이면 배지 숨김. */
  ts: number | null;
  /** 클릭 시 명시 새로고침. 없으면 클릭 비활성. */
  onRefresh?: () => void;
  /** 추가 className */
  className?: string;
  /** 5분 미만이면 배지 숨김 (default true) — UI 가 너무 빈번하게 안 튀게. */
  hideUnderMinutes?: number;
}

function formatAgo(ts: number, now: number): string {
  const diffSec = Math.floor((now - ts) / 1000);
  if (diffSec < 60) return '방금';
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  return `${d}일 전`;
}

export default function FreshnessBadge({ ts, onRefresh, className = '', hideUnderMinutes = 5 }: Props) {
  // 1분마다 라벨 재계산
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!ts) return null;
  const ageSec = (now - ts) / 1000;
  if (ageSec < hideUnderMinutes * 60) return null;

  const Wrap = onRefresh ? 'button' : 'span';
  return (
    <Wrap
      onClick={onRefresh}
      className={`inline-flex items-center gap-1 text-[11px] text-[var(--muted)] ${onRefresh ? 'active:opacity-60' : ''} ${className}`}
    >
      {onRefresh && <RefreshCw size={11} />}
      <span>{formatAgo(ts, now)}</span>
    </Wrap>
  );
}
