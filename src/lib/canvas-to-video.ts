// Canvas → 짧은 비디오 (build 136 / 공유카드 #5-C).
// 사용자 요구: 정적 이미지가 아니라 GPS 경로가 출발점에서 도착점까지 빠르게 그려지는 동적 클립.
// 단일 파일로 카톡/인스타에 그대로 공유 가능해야 함.
//
// 구현: canvas.captureStream + MediaRecorder.
// mimeType 우선순위 — iOS WKWebView 가 mp4 를 못 만들면 webm 로 폴백.
//   카톡·인스타 모두 webm/mp4 어느 쪽이든 동영상 첨부로 인식.

export interface VideoResult {
  blob: Blob;
  mimeType: string;
  extension: 'mp4' | 'webm';
}

/**
 * 캔버스에 frame 마다 drawFrame(progress) 을 호출하면서 MediaRecorder 로 녹화.
 * progress 0~1 사이 (1 도달 후 holdMs 만큼 정지 화면).
 *
 * - durationMs: 라인 그리기 애니메이션 길이 (기본 2500ms)
 * - holdMs: 라인이 끝까지 그려진 후 정지 프레임 길이 (기본 1000ms)
 * - fps: 캡처 fps (기본 30)
 */
export async function captureCanvasAnimation(
  canvas: HTMLCanvasElement,
  drawFrame: (progress: number) => void,
  opts: { durationMs?: number; holdMs?: number; fps?: number; bitsPerSecond?: number } = {},
): Promise<VideoResult> {
  // build 137: 사용자 피드백 — 더 느린 라인 그리기 + 더 긴 정지 (감상 시간 확보).
  const durationMs = opts.durationMs ?? 4000;
  const holdMs = opts.holdMs ?? 1500;
  const fps = opts.fps ?? 30;
  const bitsPerSecond = opts.bitsPerSecond ?? 5_000_000;

  if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
    throw new Error('이 기기에서 비디오 생성이 지원되지 않아요');
  }

  // mp4 우선, 없으면 webm. iOS 17+ 일부 빌드는 mp4 를 지원하지만 대부분 webm 만 가능.
  const candidates = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  const mimeType = candidates.find(t => {
    try { return MediaRecorder.isTypeSupported(t); } catch { return false; }
  }) ?? '';
  if (!mimeType) throw new Error('지원되는 비디오 코덱이 없어요');

  const extension: 'mp4' | 'webm' = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';

  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitsPerSecond });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e: BlobEvent) => { if (e.data && e.data.size > 0) chunks.push(e.data); };

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  // start 후 첫 ondataavailable 이 나오기 전에 그리기가 시작돼야 첫 프레임이 비어 보이지 않음.
  // 초기 0 프레임 한 번 그려서 첫 프레임 확정 후 record 시작.
  drawFrame(0);
  recorder.start(200); // 200ms 마다 chunk

  // 애니메이션 — requestAnimationFrame
  const startTime = performance.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      const elapsed = performance.now() - startTime;
      const p = Math.min(1, elapsed / durationMs);
      drawFrame(p);
      if (p < 1) {
        requestAnimationFrame(tick);
      } else {
        // 마지막 프레임 정지 holdMs
        setTimeout(() => resolve(), holdMs);
      }
    };
    requestAnimationFrame(tick);
  });

  recorder.stop();
  await stopped;

  const blob = new Blob(chunks, { type: mimeType });
  return { blob, mimeType, extension };
}
