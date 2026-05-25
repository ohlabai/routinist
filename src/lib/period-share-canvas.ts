// 주간·월간 공유카드용 canvas 그리기 (build 195).
// 9:16 (1080×1920) 인스타 스토리 비율.
// 8초 영상 = 1s 인트로 → 5s 막대 차오르기 (세로+가로) → 1s 고무공 bounce → 1s 흰색 transition + 정지.
//
// 디자인 룰:
// - 에메랄드 그린 디자인 시스템 (feedback_emerald_design_system)
// - 막대는 에메랄드 → 마지막 흰색으로 전환
// - 세로 막대: 일별 거리 (주 7개 / 월 ~30개)
// - 가로 막대: 이번 기간 vs 직전 동기간 누적 거리 (직전 기록부터 출발해 차오름)
// - 고무공 bounce: elastic ease-out

export interface PeriodChartData {
  period: 'week' | 'month';
  userName: string;
  periodLabel: string;            // "이번 주 (5/19 ~ 5/25)" 또는 "이번 달 (5월)"
  bars: number[];                 // 일별 거리 km (주=7, 월=가변 28~31)
  barLabels: string[];            // 일별 라벨 (주: "월 화 수 ...", 월: 일자 숫자 또는 주차)
  totalKm: number;                // 이번 기간 합계
  prevTotalKm: number;            // 직전 동기간 합계 (가로 막대 시작 위치)
  totalDurationSec: number;       // 이번 기간 총 시간
  avgPaceSec: number | null;      // 이번 기간 평균 페이스
  runs: number;
  rankLine: string | null;        // 옵션 D — "8위 · 강남구 50명" 또는 "우리 동네 최초!" 또는 null
}

const W = 1080;
const H = 1920;

const C = {
  bg: '#0a0a0a',
  emerald: '#10b981',
  emeraldLight: '#34d399',
  emeraldDark: '#059669',
  white: '#ffffff',
  muted: '#a3a3a3',
  faint: 'rgba(255,255,255,0.08)',
};

function easeOutCubic(t: number): number { return 1 - Math.pow(1 - t, 3); }
function easeOutElastic(t: number): number {
  if (t === 0 || t === 1) return t;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function lerpColor(a: string, b: string, t: number): string {
  // hex → rgb interpolate
  const pa = a.startsWith('#') ? a.slice(1) : a;
  const pb = b.startsWith('#') ? b.slice(1) : b;
  const ar = parseInt(pa.slice(0, 2), 16), ag = parseInt(pa.slice(2, 4), 16), ab = parseInt(pa.slice(4, 6), 16);
  const br = parseInt(pb.slice(0, 2), 16), bg = parseInt(pb.slice(2, 4), 16), bb = parseInt(pb.slice(4, 6), 16);
  const r = Math.round(lerp(ar, br, t));
  const g = Math.round(lerp(ag, bg, t));
  const bl = Math.round(lerp(ab, bb, t));
  return `rgb(${r},${g},${bl})`;
}

export function setupCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = W;
  canvas.height = H;
}

interface FrameContext { ctx: CanvasRenderingContext2D; data: PeriodChartData; p: number; }

function drawBackground(c: FrameContext) {
  const { ctx } = c;
  // 어두운 배경 + 상단 미세 에메랄드 글로우
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  const grad = ctx.createRadialGradient(W / 2, -200, 50, W / 2, -200, 900);
  grad.addColorStop(0, 'rgba(16,185,129,0.45)');
  grad.addColorStop(1, 'rgba(16,185,129,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}

function drawHeader(c: FrameContext) {
  const { ctx, data, p } = c;
  const alpha = Math.min(1, p / 0.15);  // 0~0.15 fade in
  ctx.globalAlpha = alpha;

  // 기간 라벨 (작게, 상단)
  ctx.fillStyle = C.emeraldLight;
  ctx.font = '700 38px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(data.periodLabel.toUpperCase(), W / 2, 140);

  // 사용자 이름 + "의 기록"
  ctx.fillStyle = C.white;
  ctx.font = '800 80px system-ui, -apple-system, sans-serif';
  const periodWord = data.period === 'week' ? '이번 주' : '이번 달';
  ctx.fillText(`${data.userName}님의 ${periodWord}`, W / 2, 240);
  ctx.globalAlpha = 1;
}

function drawHero(c: FrameContext) {
  const { ctx, data, p } = c;
  // 0.1~0.7 진행률에서 숫자 카운트업
  const t = Math.max(0, Math.min(1, (p - 0.1) / 0.6));
  const animKm = data.totalKm * easeOutCubic(t);

  const alpha = Math.min(1, p / 0.2);
  ctx.globalAlpha = alpha;

  // 큰 거리 숫자
  ctx.fillStyle = C.white;
  ctx.font = '900 220px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(animKm.toFixed(1), W / 2, 470);

  // km 단위
  ctx.fillStyle = C.emeraldLight;
  ctx.font = '700 60px system-ui, -apple-system, sans-serif';
  ctx.fillText('km', W / 2 + 280, 490);

  // 보조 stats (runs, 시간, 평균 페이스)
  const hh = Math.floor(data.totalDurationSec / 3600);
  const mm = Math.floor((data.totalDurationSec % 3600) / 60);
  const timeStr = hh > 0 ? `${hh}시간 ${mm}분` : `${mm}분`;
  const paceStr = data.avgPaceSec
    ? `${Math.floor(data.avgPaceSec / 60)}'${Math.floor(data.avgPaceSec % 60).toString().padStart(2, '0')}"`
    : '—';

  ctx.font = '700 42px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = C.muted;
  ctx.textBaseline = 'top';
  const stats = [`${data.runs}회 러닝`, timeStr, `평균 ${paceStr}`];
  const statY = 620;
  const gap = 70;
  let totalW = 0;
  const widths = stats.map(s => {
    const w = ctx.measureText(s).width;
    totalW += w;
    return w;
  });
  totalW += gap * (stats.length - 1);
  let x = (W - totalW) / 2;
  stats.forEach((s, i) => {
    ctx.fillStyle = C.muted;
    ctx.textAlign = 'left';
    ctx.fillText(s, x, statY);
    x += widths[i];
    if (i < stats.length - 1) {
      ctx.fillStyle = C.emeraldDark;
      ctx.fillText('·', x + gap / 2 - 10, statY);
      x += gap;
    }
  });
  ctx.globalAlpha = 1;
}

function drawVerticalBars(c: FrameContext) {
  const { ctx, data, p } = c;
  // 막대 영역: y 800 ~ 1300 (높이 500)
  const top = 800;
  const bottom = 1300;
  const areaH = bottom - top;
  const left = 80;
  const right = W - 80;
  const areaW = right - left;
  const n = data.bars.length;
  const gap = n <= 7 ? 24 : 8;
  const barW = (areaW - gap * (n - 1)) / n;
  const maxVal = Math.max(...data.bars, 1);

  // base line
  ctx.fillStyle = C.faint;
  ctx.fillRect(left, bottom - 2, areaW, 2);

  // 각 막대: stagger 시작 — 0.15 ~ 0.7 사이에 차오름. 0.7 ~ 0.78 사이 bounce. 0.85 ~ 1 흰색 transition.
  for (let i = 0; i < n; i++) {
    const val = data.bars[i];
    const localStart = 0.15 + (i / n) * 0.35;     // 막대마다 stagger
    const fillDur = 0.25;
    const t = Math.max(0, Math.min(1, (p - localStart) / fillDur));
    const fillT = easeOutCubic(t);

    // bounce: 0.72 ~ 0.82 — 각 막대 끝에서 elastic 효과
    const bounceT = Math.max(0, Math.min(1, (p - 0.72) / 0.10));
    const bounceAmt = bounceT > 0 && bounceT < 1 ? (1 - easeOutElastic(bounceT)) * 30 : 0;

    const hRaw = (val / maxVal) * areaH * 0.85;
    const h = hRaw * fillT;

    const x = left + i * (barW + gap);
    const y = bottom - h - bounceAmt;
    const w = barW;

    // 색: 0~0.85 에메랄드 → 0.85~1.0 흰색
    const colorT = Math.max(0, Math.min(1, (p - 0.85) / 0.15));
    const baseColor = lerpColor(C.emerald, C.white, colorT);

    // 그라데이션 (위 밝게)
    const grad = ctx.createLinearGradient(x, y, x, bottom);
    grad.addColorStop(0, baseColor);
    grad.addColorStop(1, lerpColor(C.emeraldDark, '#d4d4d4', colorT));
    ctx.fillStyle = grad;

    // rounded rect (top corners only)
    const r = Math.min(barW / 2, 18);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, bottom);
    ctx.lineTo(x, bottom);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();

    // 라벨 (날짜)
    if (data.barLabels[i]) {
      ctx.fillStyle = C.muted;
      ctx.font = '600 28px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(data.barLabels[i], x + w / 2, bottom + 14);
    }

    // 값 (상단 숫자, 막대가 어느 정도 자랐을 때만)
    if (val > 0 && fillT > 0.5 && n <= 10) {
      ctx.fillStyle = C.white;
      ctx.font = '800 26px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(val.toFixed(1), x + w / 2, y - 8);
    }
  }
}

function drawHorizontalBar(c: FrameContext) {
  const { ctx, data, p } = c;
  // 1430 부근 — 가로 막대 (이전 vs 현재 누적)
  const y = 1430;
  const barH = 56;
  const left = 80;
  const right = W - 80;
  const areaW = right - left;

  const maxScale = Math.max(data.totalKm, data.prevTotalKm, 1);
  // prevWidth: 이전 기록 → 영원히 유지되는 baseline (faint)
  const prevW = (data.prevTotalKm / maxScale) * areaW;
  // 이번 기간 진행: 0.2 ~ 0.7 사이 차오름. prevW 에서 출발해서 현재 totalKm 만큼.
  const t = Math.max(0, Math.min(1, (p - 0.2) / 0.5));
  const tt = easeOutCubic(t);
  const targetW = (data.totalKm / maxScale) * areaW;
  // 시작: prevW, 종료: targetW.
  // 만약 이번 < 이전 이면 prevW 에서 감소 (왼쪽으로 줄어듦) 또는 그냥 이번값까지만 그리기.
  const curW = lerp(prevW, targetW, tt);

  // bounce 끝: 0.72 ~ 0.82
  const bounceT = Math.max(0, Math.min(1, (p - 0.72) / 0.10));
  const bounceAmt = bounceT > 0 && bounceT < 1 ? (1 - easeOutElastic(bounceT)) * 20 : 0;

  // bg track
  ctx.fillStyle = C.faint;
  ctx.beginPath();
  // rounded
  const r = barH / 2;
  ctx.moveTo(left + r, y);
  ctx.lineTo(left + areaW - r, y);
  ctx.quadraticCurveTo(left + areaW, y, left + areaW, y + r);
  ctx.quadraticCurveTo(left + areaW, y + barH, left + areaW - r, y + barH);
  ctx.lineTo(left + r, y + barH);
  ctx.quadraticCurveTo(left, y + barH, left, y + barH - r);
  ctx.quadraticCurveTo(left, y, left + r, y);
  ctx.closePath();
  ctx.fill();

  // prev marker (이전 기록 위치 — 점선 또는 작은 표시)
  if (prevW > 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(left + prevW, y - 20);
    ctx.lineTo(left + prevW, y + barH + 20);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.muted;
    ctx.font = '600 22px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`지난 ${data.period === 'week' ? '주' : '달'}: ${data.prevTotalKm.toFixed(1)}km`, left + prevW, y - 24);
  }

  // 현재 진행 fill
  const colorT = Math.max(0, Math.min(1, (p - 0.85) / 0.15));
  const fillColor = lerpColor(C.emerald, C.white, colorT);
  ctx.fillStyle = fillColor;
  const fillW = curW + bounceAmt;
  ctx.beginPath();
  ctx.moveTo(left + r, y);
  ctx.lineTo(left + Math.max(r, fillW - r), y);
  ctx.quadraticCurveTo(left + fillW, y, left + fillW, y + r);
  ctx.quadraticCurveTo(left + fillW, y + barH, left + Math.max(r, fillW - r), y + barH);
  ctx.lineTo(left + r, y + barH);
  ctx.quadraticCurveTo(left, y + barH, left, y + barH - r);
  ctx.quadraticCurveTo(left, y, left + r, y);
  ctx.closePath();
  ctx.fill();

  // 라벨 (총 km)
  ctx.fillStyle = C.emeraldLight;
  ctx.font = '700 28px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`누적 ${data.totalKm.toFixed(1)}km`, left, y + barH + 18);

  const delta = data.totalKm - data.prevTotalKm;
  if (Math.abs(delta) > 0.1) {
    const sign = delta > 0 ? '+' : '';
    ctx.fillStyle = delta > 0 ? C.emeraldLight : '#f87171';
    ctx.textAlign = 'right';
    ctx.fillText(`${sign}${delta.toFixed(1)}km`, right, y + barH + 18);
  }
}

function drawFooter(c: FrameContext) {
  const { ctx, data, p } = c;
  const alpha = Math.min(1, Math.max(0, (p - 0.4) / 0.2));
  ctx.globalAlpha = alpha;

  // 랭킹 라인
  if (data.rankLine) {
    ctx.fillStyle = C.white;
    ctx.font = '800 44px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(data.rankLine, W / 2, 1620);
  }

  // 워터마크
  ctx.fillStyle = C.muted;
  ctx.font = '700 32px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Routinist', W / 2, 1820);

  ctx.globalAlpha = 1;
}

export function drawPeriodFrame(canvas: HTMLCanvasElement, data: PeriodChartData, progress: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const frameCtx: FrameContext = { ctx, data, p: progress };
  drawBackground(frameCtx);
  drawHeader(frameCtx);
  drawHero(frameCtx);
  drawVerticalBars(frameCtx);
  drawHorizontalBar(frameCtx);
  drawFooter(frameCtx);
}

export const CANVAS_W = W;
export const CANVAS_H = H;
