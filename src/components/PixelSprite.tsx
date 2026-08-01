'use client';

/**
 * 잔디 픽셀 스프라이트 렌더러 — 워치 퍼레이드(PixelParade.swift)와 동일 그리드 데이터.
 * AppLogo.tsx 의 SVG rect 방식을 따른다. 데이터 원본: src/lib/pixel-sprites.ts (코드젠).
 *
 * 2026-08-01 hans: 모바일 UI 에서 "걸어다니는 동물" 전면 제거 ("정신없고 산만") —
 * 애니메이션 컴포넌트 (PixelRunnerAnimated·PixelParadeStrip·PixelMarchStrip·PixelRunnerLoader) 삭제.
 * 동물은 정지 배지로만 사용 (페이스 동물 등). 움직이는 동물 재제안 금지.
 */

import { PIXEL_RUNNERS, PIXEL_RUNNER_BY_NAME, type SpriteGrid } from '@/lib/pixel-sprites';

const COLORS: Record<number, string> = {
  1: '#4ade80',
  2: '#22c55e',
  3: '#16a34a',
};

/** 정지 스프라이트 1프레임 — height 기준 스케일, 폭은 그리드 비율대로 */
export function PixelSprite({
  grid,
  height = 40,
  className = '',
}: {
  grid: SpriteGrid;
  height?: number;
  className?: string;
}) {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 1;
  const cell = height / rows;
  const gap = cell * 0.08;
  const width = cols * cell;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      {grid.map((row, y) =>
        row.map((v, x) => {
          if (v === -1) return null;
          return (
            <rect
              key={`${x}-${y}`}
              x={x * cell + gap / 2}
              y={y * cell + gap / 2}
              width={cell - gap}
              height={cell - gap}
              rx={cell * 0.18}
              fill={COLORS[v]}
            />
          );
        })
      )}
    </svg>
  );
}

/** 이름으로 정지 스프라이트 — 페이스 동물 배지 등 (공유카드 캔버스와 동일 프레임 0) */
export function PixelRunnerStatic({
  name,
  height = 40,
  className = '',
}: {
  name: string;
  height?: number;
  className?: string;
}) {
  const runner = PIXEL_RUNNER_BY_NAME[name] ?? PIXEL_RUNNERS[0];
  return <PixelSprite grid={runner.frames[0]} height={height} className={className} />;
}
