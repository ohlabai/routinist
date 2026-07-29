'use client';

/**
 * 잔디 픽셀 스프라이트 렌더러 — 워치 퍼레이드(PixelParade.swift)와 동일 그리드 데이터.
 * AppLogo.tsx 의 SVG rect 방식을 따른다. 데이터 원본: src/lib/pixel-sprites.ts (코드젠).
 */

import { useEffect, useState } from 'react';
import { PIXEL_RUNNERS, PIXEL_RUNNER_BY_NAME, type PixelRunnerDef, type SpriteGrid } from '@/lib/pixel-sprites';

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

/** 제자리 달리기 — 2프레임 다리 교차 (legEvery × 120ms 주기, 동물별 템포) */
export function PixelRunnerAnimated({
  name,
  height = 40,
  className = '',
}: {
  name: string;
  height?: number;
  className?: string;
}) {
  const runner = PIXEL_RUNNER_BY_NAME[name] ?? PIXEL_RUNNERS[0];
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const ms = Math.max(1, runner.legEvery) * 120;
    const id = setInterval(() => setFrame((f) => (f + 1) % 2), ms);
    return () => clearInterval(id);
  }, [runner]);

  const hop = runner.bounce === 1 && frame === 0 ? -height * 0.08 : 0;
  return (
    <span style={{ display: 'inline-block', transform: `translateY(${hop}px)`, transition: 'transform 0.12s linear' }}>
      <PixelSprite grid={runner.frames[frame]} height={height} className={className} />
    </span>
  );
}

/**
 * 퍼레이드 띠 — 워치 시작 버튼과 동일 컨셉: 남자→여자→…→말 이 차례로 화면을 가로질러 달림.
 * CSS transform 애니메이션 1마리씩, animation 종료 시 다음 러너로 교체.
 */
export function PixelParadeStrip({
  height = 34,
  className = '',
}: {
  height?: number;
  className?: string;
}) {
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * PIXEL_RUNNERS.length));
  const runner = PIXEL_RUNNERS[idx];
  // 워치와 동일 감각: stepCells 가 클수록 빨리 가로지름 (치타 ~2s, 거북이 ~8s)
  const duration = 7 / runner.stepCells;

  return (
    <div className={`relative overflow-hidden ${className}`} style={{ height }} aria-hidden>
      {/* 바닥 잔디 지면 라인 */}
      <div
        className="absolute bottom-0 left-0 right-0"
        style={{
          height: Math.max(2, height * 0.07),
          backgroundImage: 'repeating-linear-gradient(90deg, rgba(22,163,74,0.45) 0 6px, transparent 6px 11px)',
        }}
      />
      <div
        key={idx}
        className="absolute bottom-0 will-change-transform"
        style={{
          paddingBottom: Math.max(2, height * 0.07),
          animation: `pixel-parade-run ${duration}s linear`,
          left: 0,
        }}
        onAnimationEnd={() => setIdx((i) => (i + 1) % PIXEL_RUNNERS.length)}
      >
        <PixelRunnerAnimated name={runner.name} height={height * 0.86} />
      </div>
    </div>
  );
}

/** 달려가는 로딩 인디케이터 — 스피너 대체용. 렌더마다 랜덤 동물 */
export function PixelRunnerLoader({
  height = 28,
  className = '',
}: {
  height?: number;
  className?: string;
}) {
  const [name] = useState(() => PIXEL_RUNNERS[Math.floor(Math.random() * PIXEL_RUNNERS.length)].name);
  return (
    <span className={`inline-flex items-end gap-0 ${className}`}>
      <PixelRunnerAnimated name={name} height={height} />
    </span>
  );
}
