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
  // build 208 #1: 일간 ShareCard 와 동일 폼 — quote + map + region + handle 추가.
  // 모든 필드 optional → 데이터 없으면 그냥 해당 영역 skip (기존 로직과 호환).
  quote?: { text: string; author: string } | null;
  routes?: Array<Array<[number, number]>>;  // 기간 내 모든 활동 GPS 경로 합성 ([lng, lat])
  regionLabel?: string | null;             // "서울 강남 · 1위" 등 (rankLine 의 핵심부)
  userHandle?: string | null;              // "@hans" 풋터용
  totalCalories?: number;                  // 4-stat 칼로리 컬럼용
  totalDays?: number;                      // 4-stat 일수 컬럼용
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

function drawRegionPill(c: FrameContext) {
  // build 208 #1: 일간 ShareCard 와 동일 — 카드 최상단 center 알약.
  // rankLine 에 "강남구 50대 남성 이번 주 1위 ✨" 풀텍스트가 있으면 그걸 표시,
  // 없으면 regionLabel + periodLabel 폴백.
  const { ctx, data, p } = c;
  const alpha = Math.min(1, p / 0.15);
  ctx.globalAlpha = alpha;

  const labelText = data.rankLine
    ? `📍 ${data.rankLine}`
    : data.regionLabel
      ? `📍 ${data.regionLabel}`
      : `📍 ${data.periodLabel}`;
  ctx.font = 'bold 30px -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const padX = 22;
  const textW = ctx.measureText(labelText).width;
  const pillW = textW + padX * 2;
  const pillH = 50;
  const labelX = (W - pillW) / 2;
  const labelY = 110;
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.roundRect(labelX, labelY, pillW, pillH, 25);
  ctx.fill();
  ctx.fillStyle = C.white;
  ctx.fillText(labelText, labelX + padX, labelY + 35);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.globalAlpha = 1;
}

function drawQuote(c: FrameContext) {
  // 일간 ShareCard 와 동일 layout — quote 본문 + author. y=200 부근, 3줄 wrap.
  const { ctx, data, p } = c;
  if (!data.quote) return;
  const alpha = Math.min(1, Math.max(0, (p - 0.05) / 0.15));
  ctx.globalAlpha = alpha;

  const quoteText = `"${data.quote.text}"`;
  ctx.font = 'italic 600 44px -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
  ctx.fillStyle = C.white;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const maxW = W - 140;

  // wrap: word → char fallback
  const splitByGraphemes = (text: string): string[] => {
    const out: string[] = [];
    let cur = '';
    for (const ch of text) {
      const tst = cur + ch;
      if (ctx.measureText(tst).width > maxW && cur) {
        out.push(cur); cur = ch;
      } else cur = tst;
    }
    if (cur) out.push(cur);
    return out;
  };
  const words = quoteText.split(' ');
  const wordLines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width > maxW && cur) { wordLines.push(cur); cur = w; }
    else cur = t;
  }
  if (cur) wordLines.push(cur);
  const allLines: string[] = [];
  for (const line of wordLines) {
    if (ctx.measureText(line).width > maxW) allLines.push(...splitByGraphemes(line));
    else allLines.push(line);
  }
  const lines = allLines.slice(0, 3);
  const lineH = 58;
  const startY = 220;
  lines.forEach((ln, i) => ctx.fillText(ln, W / 2, startY + i * lineH));

  if (data.quote.author) {
    ctx.font = '500 30px -apple-system, system-ui, sans-serif';
    ctx.fillStyle = C.muted;
    ctx.fillText(`— ${data.quote.author}`, W / 2, startY + lines.length * lineH + 16);
  }

  ctx.globalAlpha = 1;
}

function drawMap(c: FrameContext) {
  // build 208 #1: 기간 내 모든 활동 경로를 한 지도에 합성.
  // bounding box = 모든 점의 min/max. 각 route 를 emerald 라인으로 그림.
  const { ctx, data, p } = c;
  const routes = data.routes;
  if (!routes || routes.length === 0) return;

  const alpha = Math.min(1, Math.max(0, (p - 0.1) / 0.2));
  ctx.globalAlpha = alpha;

  const padding = 120;
  const mapW = W - padding * 2;
  const mapH = 420;
  const mapY = 460;

  // bbox 모든 점에서 계산
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const r of routes) {
    for (const [lng, lat] of r) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }
  if (!Number.isFinite(minLat) || !Number.isFinite(minLng)) { ctx.globalAlpha = 1; return; }

  const dLng = (maxLng - minLng) || 0.001;
  const dLat = (maxLat - minLat) || 0.001;
  const scale = Math.min(mapW / dLng, mapH / dLat);
  const offsetX = padding + (mapW - dLng * scale) / 2;
  const offsetY = mapY + (mapH - dLat * scale) / 2;

  // 각 route 그리기 (그림자 + 본체)
  for (const route of routes) {
    if (route.length < 2) continue;
    // 그림자
    ctx.beginPath();
    route.forEach(([lng, lat], i) => {
      const x = offsetX + (lng - minLng) * scale;
      const y = offsetY + mapH - (lat - minLat) * scale;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    // 본체
    ctx.beginPath();
    route.forEach(([lng, lat], i) => {
      const x = offsetX + (lng - minLng) * scale;
      const y = offsetY + mapH - (lat - minLat) * scale;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = C.emerald;
    ctx.lineWidth = 7;
    ctx.stroke();

    // 시작점 (작은 dot)
    const [sLng, sLat] = route[0];
    const sx = offsetX + (sLng - minLng) * scale;
    const sy = offsetY + mapH - (sLat - minLat) * scale;
    ctx.fillStyle = '#22C55E';
    ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI * 2); ctx.fill();
  }

  ctx.globalAlpha = 1;
}

function drawHero(c: FrameContext) {
  // build 208 #1: 일간 카드와 동일 — 0.00 / KILOMETERS / 4-stat row.
  const { ctx, data, p } = c;
  // 카운트업 (0.1~0.7)
  const t = Math.max(0, Math.min(1, (p - 0.1) / 0.6));
  const animKm = data.totalKm * easeOutCubic(t);

  const alpha = Math.min(1, p / 0.2);
  ctx.globalAlpha = alpha;

  // KM hero — 일간 형식과 동일하게 dot-anchored 중앙 정렬.
  const distY = 1020;
  const kmFont = 'bold 180px -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
  ctx.font = kmFont;
  ctx.fillStyle = C.white;
  ctx.textBaseline = 'alphabetic';
  const finalKmText = data.totalKm.toFixed(2);
  const finalDotIdx = finalKmText.indexOf('.');
  const finalIntPart = finalDotIdx >= 0 ? finalKmText.slice(0, finalDotIdx) : finalKmText;
  const finalTotalWidth = ctx.measureText(finalKmText).width;
  const finalIntWidth = ctx.measureText(finalIntPart).width;
  const dotX = W / 2 - finalTotalWidth / 2 + finalIntWidth;
  const kmText = animKm.toFixed(2);
  const dotIdx = kmText.indexOf('.');
  const intPart = dotIdx >= 0 ? kmText.slice(0, dotIdx) : kmText;
  const fracPart = dotIdx >= 0 ? kmText.slice(dotIdx) : '';
  ctx.textAlign = 'right';
  ctx.fillText(intPart, dotX, distY);
  ctx.textAlign = 'left';
  ctx.fillText(fracPart, dotX, distY);
  ctx.textAlign = 'center';

  ctx.font = 'bold 56px -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
  ctx.fillStyle = C.emeraldLight;
  ctx.fillText('KILOMETERS', W / 2, distY + 60);

  // 구분선
  const lineY = distY + 110;
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W * 0.2, lineY);
  ctx.lineTo(W * 0.8, lineY);
  ctx.stroke();

  // 4-stat row — 시간 / 페이스 / 횟수 / (주/달 라벨)
  const hh = Math.floor(data.totalDurationSec / 3600);
  const mm = Math.floor((data.totalDurationSec % 3600) / 60);
  const ss = data.totalDurationSec % 60;
  const timeStr = hh > 0
    ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${mm}:${String(ss).padStart(2, '0')}`;
  const paceStr = data.avgPaceSec
    ? `${Math.floor(data.avgPaceSec / 60)}'${Math.floor(data.avgPaceSec % 60).toString().padStart(2, '0')}"`
    : '--';
  const periodLabelShort = data.period === 'week' ? '이번 주' : '이번 달';
  const runsValueStr = String(data.runs);

  const statsY = lineY + 100;
  const stats: Array<{ label: string; value: string }> = [
    { label: '시간', value: timeStr },
    { label: '페이스', value: paceStr },
    { label: '횟수', value: `${runsValueStr}회` },
    { label: periodLabelShort, value: `${data.totalKm.toFixed(1)}km` },
  ];
  ctx.textBaseline = 'alphabetic';
  stats.forEach((stat, i) => {
    const x = W / 2 + (i - 1.5) * 220;
    ctx.font = 'bold 48px -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
    ctx.fillStyle = C.white;
    ctx.textAlign = 'center';
    ctx.fillText(stat.value, x, statsY);
    ctx.font = '26px -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
    ctx.fillStyle = C.muted;
    ctx.fillText(stat.label, x, statsY + 42);
  });
  ctx.globalAlpha = 1;
}

function drawVerticalBars(c: FrameContext) {
  const { ctx, data, p } = c;
  // build 208 #1: 일간 폼 통일 — 하단으로 이동 (y 1340 ~ 1560, 높이 220).
  // 위쪽 자리는 quote(220-360) + map(460-880) + km hero(950-1180) + 구분선/stats(1290) 가 차지.
  const top = 1340;
  const bottom = 1560;
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
  // build 208 #1: 세로 막대 하단 이동에 맞춰 가로 막대 y=1640 으로 동조.
  const y = 1640;
  const barH = 48;
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

  // build 207 #10: 이전 누적 부분은 항상 흰색(baseline), 새로 추가된 부분만 에메랄드 차오름 → bounce → 흰색.
  // (1) 이전 누적 (prevW) — 항상 흰색
  if (prevW > 0) {
    ctx.fillStyle = C.white;
    ctx.beginPath();
    const pw = prevW;
    ctx.moveTo(left + r, y);
    ctx.lineTo(left + Math.max(r, pw - r), y);
    ctx.quadraticCurveTo(left + pw, y, left + pw, y + r);
    ctx.quadraticCurveTo(left + pw, y + barH, left + Math.max(r, pw - r), y + barH);
    ctx.lineTo(left + r, y + barH);
    ctx.quadraticCurveTo(left, y + barH, left, y + barH - r);
    ctx.quadraticCurveTo(left, y, left + r, y);
    ctx.closePath();
    ctx.fill();
  }

  // (2) 새로 추가된 부분 (prevW → curW) — 0~0.85 에메랄드, 0.85~1 흰색으로 페이드 → 최종 흰색
  const addStart = prevW;
  const addEnd = curW + bounceAmt;
  if (addEnd > addStart) {
    const colorT = Math.max(0, Math.min(1, (p - 0.85) / 0.15));
    const fillColor = lerpColor(C.emerald, C.white, colorT);
    ctx.fillStyle = fillColor;
    // rounded right edge only if extends to full width's roundness
    ctx.beginPath();
    const startX = left + addStart;
    const endX = left + addEnd;
    const leftIsRound = addStart <= r; // 시작이 0 근처면 둥근 왼쪽
    const rightIsRound = addEnd >= areaW - r; // 끝이 끝 근처면 둥근 오른쪽
    if (leftIsRound) {
      ctx.moveTo(left + r, y);
    } else {
      ctx.moveTo(startX, y);
    }
    if (rightIsRound) {
      ctx.lineTo(left + areaW - r, y);
      ctx.quadraticCurveTo(left + areaW, y, left + areaW, y + r);
      ctx.quadraticCurveTo(left + areaW, y + barH, left + areaW - r, y + barH);
    } else {
      ctx.lineTo(endX, y);
      ctx.lineTo(endX, y + barH);
    }
    if (leftIsRound) {
      ctx.lineTo(left + r, y + barH);
      ctx.quadraticCurveTo(left, y + barH, left, y + barH - r);
      ctx.quadraticCurveTo(left, y, left + r, y);
    } else {
      ctx.lineTo(startX, y + barH);
      ctx.lineTo(startX, y);
    }
    ctx.closePath();
    ctx.fill();
  }

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
  // build 208 #1: 일간 ShareCard 와 동일 — "@handle | Routinist" + "Run Your Routine."
  // rankLine 은 이미 상단 region pill 로 이동했으므로 footer 에서는 생략.
  const { ctx, data, p } = c;
  const alpha = Math.min(1, Math.max(0, (p - 0.4) / 0.2));
  ctx.globalAlpha = alpha;

  const handleLine = data.userHandle
    ? `${data.userHandle} | Routinist`
    : `@${data.userName} | Routinist`;
  ctx.fillStyle = C.white;
  ctx.font = '800 36px -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(handleLine, W / 2, 1790);

  ctx.fillStyle = C.muted;
  ctx.font = '500 26px -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
  ctx.fillText('Run Your Routine.', W / 2, 1840);

  ctx.globalAlpha = 1;
}

export function drawPeriodFrame(canvas: HTMLCanvasElement, data: PeriodChartData, progress: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const frameCtx: FrameContext = { ctx, data, p: progress };
  drawBackground(frameCtx);
  drawRegionPill(frameCtx);
  drawQuote(frameCtx);
  drawMap(frameCtx);
  drawHero(frameCtx);
  drawVerticalBars(frameCtx);
  drawHorizontalBar(frameCtx);
  drawFooter(frameCtx);
}

export const CANVAS_W = W;
export const CANVAS_H = H;
