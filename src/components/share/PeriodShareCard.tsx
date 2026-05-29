'use client';

// 주간·월간 공유카드 (build 195).
// 9:16 비율 + 8초 영상 (1s 인트로 → 5s 막대 차오름 → 1s bounce → 1s 흰색 transition).
// 이미지 (최종 프레임 PNG) + 영상 (MP4/webm) 둘 다 export.

import { useEffect, useRef, useState } from 'react';
import { X, Download, Share2, Image as ImageIcon, Video, Loader2 } from 'lucide-react';
import { captureCanvasAnimation } from '@/lib/canvas-to-video';
import { drawPeriodFrame, setupCanvas, CANVAS_W, CANVAS_H, type PeriodChartData } from '@/lib/period-share-canvas';

interface Props {
  data: PeriodChartData;
  onClose: () => void;
}

type ExportKind = 'video' | 'image';

export default function PeriodShareCard({ data, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const [previewProgress, setPreviewProgress] = useState(1);    // 1 = 최종 프레임 (정지된 미리보기)
  const [error, setError] = useState<string | null>(null);

  // 캔버스 초기 그리기 (최종 프레임)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setupCanvas(canvas);
    drawPeriodFrame(canvas, data, previewProgress);
  }, [data, previewProgress]);

  // 미리보기 loop — 주간 12s, 월간 16s (build 207 #12, #13). 데이터가 많을수록 더 천천히.
  const previewDur = data.period === 'week' ? 12000 : 16000;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf: number;
    const start = performance.now();
    const tick = () => {
      const elapsed = performance.now() - start;
      const p = Math.min(1, elapsed / previewDur);
      setPreviewProgress(p);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const replay = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf: number;
    const start = performance.now();
    const tick = () => {
      const elapsed = performance.now() - start;
      const p = Math.min(1, elapsed / previewDur);
      setPreviewProgress(p);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };

  const exportImage = async () => {
    setExporting('image');
    setError(null);
    try {
      const canvas = canvasRef.current;
      if (!canvas) throw new Error('canvas 없음');
      // 최종 프레임으로 다시 그림
      drawPeriodFrame(canvas, data, 1);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(b => resolve(b), 'image/png'));
      if (!blob) throw new Error('이미지 생성 실패');
      await downloadOrShare(blob, `routinist-${data.period}-${Date.now()}.png`, 'image/png');
    } catch (e) {
      setError(e instanceof Error ? e.message : '이미지 export 실패');
    } finally {
      setExporting(null);
    }
  };

  const exportVideo = async () => {
    setExporting('video');
    setError(null);
    try {
      const canvas = canvasRef.current;
      if (!canvas) throw new Error('canvas 없음');
      // build 207 #12, #13: 주간 12s (10초 애니 + 2초 hold), 월간 16s (14초 애니 + 2초 hold).
      // 데이터 양이 많을수록 시청자가 따라가기 좋게.
      const animMs = data.period === 'week' ? 10000 : 14000;
      const result = await captureCanvasAnimation(
        canvas,
        (p) => drawPeriodFrame(canvas, data, p),
        { durationMs: animMs, holdMs: 2000, fps: 30, bitsPerSecond: 8_000_000 },
      );
      await downloadOrShare(result.blob, `routinist-${data.period}-${Date.now()}.${result.extension}`, result.mimeType);
    } catch (e) {
      setError(e instanceof Error ? e.message : '영상 export 실패');
    } finally {
      setExporting(null);
    }
  };

  // Capacitor share / Web Share API / Blob download fallback
  async function downloadOrShare(blob: Blob, filename: string, mimeType: string) {
    // Web Share API 가 file 지원하면 그걸 우선
    try {
      const file = new File([blob], filename, { type: mimeType });
      const nav = navigator as Navigator & {
        canShare?: (data: { files?: File[] }) => boolean;
        share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
      };
      if (nav.canShare && nav.canShare({ files: [file] }) && nav.share) {
        await nav.share({ files: [file], title: 'Routinist', text: 'Run Your Routine!' });
        return;
      }
    } catch (e) {
      console.warn('[period-share] Web Share 실패, fallback', e);
    }
    // 폴백: 다운로드
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="fixed inset-0 z-[95] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="bg-[var(--background)] w-full max-w-md max-h-[95vh] rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        {/* 헤더 */}
        <div className="sticky top-0 bg-[var(--background)]/95 backdrop-blur-lg border-b border-[var(--card-border)]/30 px-4 py-3 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <Share2 size={18} className="text-emerald-500" />
            <h2 className="text-base font-extrabold">
              {data.period === 'week' ? '이번 주' : '이번 달'} 공유
            </h2>
          </div>
          <button onClick={onClose} aria-label="닫기"
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[var(--card-border)]/40 active:scale-90">
            <X size={18} />
          </button>
        </div>

        {/* 미리보기 (9:16 비율 유지) */}
        <div className="flex-1 overflow-y-auto p-4">
          <button onClick={replay} className="block w-full" aria-label="다시 재생">
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              className="w-full h-auto rounded-2xl shadow-lg"
              style={{ aspectRatio: '9 / 16' }}
            />
          </button>
          <p className="text-[11px] text-[var(--muted)] text-center mt-2">미리보기를 탭하면 다시 재생돼요</p>

          {error && (
            <p className="text-xs text-rose-500 font-semibold text-center mt-3">{error}</p>
          )}
        </div>

        {/* CTA */}
        <div className="px-4 pt-2 pb-7 border-t border-[var(--card-border)]/30 grid grid-cols-2 gap-2.5">
          <button
            onClick={exportImage}
            disabled={!!exporting}
            className="py-3.5 rounded-2xl bg-[var(--card)] border-2 border-[var(--card-border)] text-[var(--foreground)] font-extrabold text-sm active:scale-[0.98] disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
          >
            {exporting === 'image' ? <Loader2 size={16} className="animate-spin" /> : <ImageIcon size={16} />}
            이미지 저장
          </button>
          <button
            onClick={exportVideo}
            disabled={!!exporting}
            className="py-3.5 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-sm active:scale-[0.98] disabled:opacity-50 shadow-md shadow-emerald-500/30 inline-flex items-center justify-center gap-1.5"
          >
            {exporting === 'video' ? <Loader2 size={16} className="animate-spin" /> : <Video size={16} />}
            영상 공유
          </button>
        </div>
      </div>
    </div>
  );
}
