'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { Share2, X, ImagePlus, Check, ThumbsUp, Dices } from 'lucide-react';
import { isNativeApp } from '@/lib/health-sync';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/components/UserDataProvider';
import { fetchRandomQuote, toggleQuoteLike, isFallbackQuote, type DailyQuote } from '@/lib/quotes-data';
import { getSupabase } from '@/lib/supabase';
import AppToast from '@/components/AppToast';
import type { Activity } from '@/types';

interface ShareCardProps {
  activity: Activity;
  displayName: string;
  onClose: () => void;
  /** true 면 루틴포토 등록 버튼을 숨김 (캘린더처럼 바깥에서 직접 등록 모달을 띄우는 경우) */
  hideRegister?: boolean;
  /** 등록 성공 시 호출 — 리스트 새로고침용 */
  onRegistered?: () => void;
}

type Theme = {
  name: string;
  bg: (ctx: CanvasRenderingContext2D, W: number, H: number) => void;
  accent: string;
  textMain: string;
  textSub: string;
  routeColor: string;
};

const THEMES: Theme[] = [
  {
    name: '새벽',
    bg: (ctx, W, H) => {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#0f0c29'); g.addColorStop(0.5, '#302b63'); g.addColorStop(1, '#24243e');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    },
    accent: '#818cf8', textMain: '#ffffff', textSub: '#94a3b8', routeColor: '#818cf8',
  },
  {
    name: '노을',
    bg: (ctx, W, H) => {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#f97316'); g.addColorStop(0.4, '#ec4899'); g.addColorStop(1, '#8b5cf6');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    },
    accent: '#fbbf24', textMain: '#ffffff', textSub: '#fde68a', routeColor: '#ffffff',
  },
  {
    name: '숲',
    bg: (ctx, W, H) => {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#064e3b'); g.addColorStop(0.5, '#065f46'); g.addColorStop(1, '#0f766e');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    },
    accent: '#34d399', textMain: '#ffffff', textSub: '#a7f3d0', routeColor: '#34d399',
  },
  {
    name: '하양',
    bg: (ctx, W, H) => {
      ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 0, W, H);
      // 미세한 도트 패턴
      ctx.fillStyle = '#e2e8f0';
      for (let x = 0; x < W; x += 40) {
        for (let y = 0; y < H; y += 40) {
          ctx.beginPath(); ctx.arc(x, y, 1.5, 0, Math.PI * 2); ctx.fill();
        }
      }
    },
    accent: '#3b82f6', textMain: '#1e293b', textSub: '#64748b', routeColor: '#3b82f6',
  },
  {
    name: '밤',
    bg: (ctx, W, H) => {
      ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, W, H);
      // 그리드 라인
      ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    },
    accent: '#00ff88', textMain: '#ffffff', textSub: '#4ade80', routeColor: '#00ff88',
  },
];

// Canvas 에 thumbs-up (👍) 그리기 — lucide ThumbsUp 24x24 viewBox 기반 SVG path.
// 색상은 에메랄드 그린 (emerald-500 #10b981). filled 이면 채움 + 손목줄기 stroke.
// 두 sub-path 를 분리해서 그려야 nonzero rule 로 모양 안 뭉개짐 (손=fill, 줄기=stroke).
function drawThumbsUp(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, filled: boolean, strokeColor: string) {
  ctx.save();
  const s = size / 24;
  const x = cx - 12 * s;
  const y = cy - 12 * s;
  ctx.translate(x, y);
  ctx.scale(s, s);
  // lucide ThumbsUp 의 손 윤곽 (closed path)
  const handPath = new Path2D('M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z');
  // 손목 줄기 (open line)
  const stemPath = new Path2D('M7 10v12');

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (filled) {
    ctx.fillStyle = '#10b981'; // emerald-500
    ctx.fill(handPath);
    // 채움 위에 줄기 구분선
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke(stemPath);
  } else {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2.5;
    ctx.stroke(handPath);
    ctx.stroke(stemPath);
  }
  ctx.restore();
}

function drawCard(
  canvas: HTMLCanvasElement,
  activity: Activity,
  displayName: string,
  theme: Theme,
  bgImage?: HTMLImageElement | null,
  monthlyActivities?: Activity[],
  userIdLabel?: string,
  quote?: DailyQuote | null,
  monthlyGoalKm?: number,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const W = 1080;
  const H = 1920;
  canvas.width = W;
  canvas.height = H;

  // 배경
  if (bgImage) {
    // 사진 배경 + 어두운 오버레이
    const imgRatio = bgImage.width / bgImage.height;
    const canvasRatio = W / H;
    let drawW = W, drawH = H, drawX = 0, drawY = 0;
    if (imgRatio > canvasRatio) {
      drawW = H * imgRatio; drawX = -(drawW - W) / 2;
    } else {
      drawH = W / imgRatio; drawY = -(drawH - H) / 2;
    }
    ctx.drawImage(bgImage, drawX, drawY, drawW, drawH);
    // 오버레이
    const overlay = ctx.createLinearGradient(0, 0, 0, H);
    overlay.addColorStop(0, 'rgba(0,0,0,0.3)');
    overlay.addColorStop(0.4, 'rgba(0,0,0,0.5)');
    overlay.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.fillStyle = overlay;
    ctx.fillRect(0, 0, W, H);
  } else {
    theme.bg(ctx, W, H);
  }

  // 경로 — 명언 영역(상단 200~440) 다음에 그려짐.
  const hasRoute = activity.route_data?.coordinates?.length;
  if (hasRoute) {
    const coords = activity.route_data!.coordinates;
    const lats = coords.map(c => c[1]);
    const lngs = coords.map(c => c[0]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);

    // 명언/지도/거리 위치 위로 ↑ (사용자 피드백 — 5/11 layout 재조정).
    const padding = 120;
    const mapW = W - padding * 2;
    const mapH = 480;
    const mapY = 280;

    const scaleX = mapW / (maxLng - minLng || 0.001);
    const scaleY = mapH / (maxLat - minLat || 0.001);
    const scale = Math.min(scaleX, scaleY);

    const offsetX = padding + (mapW - (maxLng - minLng) * scale) / 2;
    const offsetY = mapY + (mapH - (maxLat - minLat) * scale) / 2;

    // 그림자
    ctx.beginPath();
    coords.forEach(([lng, lat], i) => {
      const x = offsetX + (lng - minLng) * scale;
      const y = offsetY + mapH - (lat - minLat) * scale;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // 경로 본체
    ctx.beginPath();
    coords.forEach(([lng, lat], i) => {
      const x = offsetX + (lng - minLng) * scale;
      const y = offsetY + mapH - (lat - minLat) * scale;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = bgImage ? '#ffffff' : theme.routeColor;
    ctx.lineWidth = 6;
    ctx.stroke();

    // 시작/끝점
    const [sx, sy] = [offsetX + (coords[0][0] - minLng) * scale, offsetY + mapH - (coords[0][1] - minLat) * scale];
    const last = coords[coords.length - 1];
    const [ex, ey] = [offsetX + (last[0] - minLng) * scale, offsetY + mapH - (last[1] - minLat) * scale];

    ctx.fillStyle = '#22C55E';
    ctx.beginPath(); ctx.arc(sx, sy, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#EF4444';
    ctx.beginPath(); ctx.arc(ex, ey, 12, 0, Math.PI * 2); ctx.fill();
  }

  const mainColor = bgImage ? '#ffffff' : theme.textMain;
  const subColor = bgImage ? 'rgba(255,255,255,0.7)' : theme.textSub;
  const accentColor = bgImage ? '#ffffff' : theme.accent;

  // 날짜는 하단 월간 막대그래프의 today 라벨로 대체 (사용자 피드백 #13). 상단 공간 확보.
  ctx.textAlign = 'center';

  // 월간 합계 + 일별 거리 맵 — 그래프(하단) + stats 4번째 컬럼에서 사용.
  let monthSum = 0;
  let dailyKm = new Map<number, number>();
  let activityMonth = 0;
  let activityYear = 0;
  let daysInMonth = 30;
  let todayDay = 1;
  if (monthlyActivities && monthlyActivities.length > 0) {
    const activityDate = new Date(activity.activity_date);
    activityYear = activityDate.getFullYear();
    activityMonth = activityDate.getMonth();
    daysInMonth = new Date(activityYear, activityMonth + 1, 0).getDate();
    todayDay = activityDate.getDate();

    monthSum = monthlyActivities
      .filter(a => {
        const d = new Date(a.activity_date);
        return d.getFullYear() === activityYear && d.getMonth() === activityMonth;
      })
      .reduce((s, a) => s + a.distance_km, 0);

    dailyKm = new Map<number, number>();
    monthlyActivities.forEach(a => {
      const d = new Date(a.activity_date);
      if (d.getFullYear() === activityYear && d.getMonth() === activityMonth) {
        dailyKm.set(d.getDate(), (dailyKm.get(d.getDate()) ?? 0) + a.distance_km);
      }
    });
  }

  // 거리 (메인) — 사용자 피드백: 더 위로. mapY 280 → map 끝 760 → distY 위로.
  const distY = hasRoute ? H * 0.48 : H * 0.36;
  ctx.font = 'bold 180px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillStyle = mainColor;
  ctx.fillText(activity.distance_km.toFixed(2), W / 2, distY);

  ctx.font = 'bold 56px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillStyle = accentColor;
  ctx.fillText('KILOMETERS', W / 2, distY + 60);

  // 구분선
  const lineY = distY + 110;
  ctx.strokeStyle = bgImage ? 'rgba(255,255,255,0.2)' : theme.accent + '40';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W * 0.2, lineY);
  ctx.lineTo(W * 0.8, lineY);
  ctx.stroke();

  // 통계 4열 — 시간 / 페이스 / 칼로리 / 월 누적 (사용자 결정 — 월 누적 km 표시 위치 이동)
  const statsY = lineY + 100;
  const stats = [
    { label: '시간', value: activity.duration_seconds ? formatDur(activity.duration_seconds) : '--' },
    { label: '페이스', value: activity.pace_avg_sec_per_km ? formatPc(activity.pace_avg_sec_per_km) : '--' },
    { label: '칼로리', value: activity.calories ? `${activity.calories}` : '--' },
    {
      label: monthSum > 0 ? `${activityMonth + 1}월` : '월 누적',
      value: monthSum > 0 ? `${monthSum.toFixed(1)}km` : '--',
    },
  ];

  stats.forEach((stat, i) => {
    const x = W / 2 + (i - 1.5) * 220;
    ctx.font = 'bold 48px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = mainColor;
    ctx.fillText(stat.value, x, statsY);
    ctx.font = '26px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = subColor;
    ctx.fillText(stat.label, x, statsY + 42);
  });

  // 명언 (그날의 메시지) — 상단 (이전 그래프 자리) 큰 글씨로 hero 처럼.
  // 같은 활동 날짜를 공유한 모든 사용자에게 같은 명언 (글로벌 공감대).
  if (quote) {
    const quoteText = quote.author ? `"${quote.text}" — ${quote.author}` : `"${quote.text}"`;
    ctx.font = 'italic 600 52px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = mainColor;
    ctx.textAlign = 'center';
    // 상단 영역. 더 위로 (사용자 피드백). 3줄까지 수용.
    const quoteY = 200;
    const maxQuoteW = W - 120;

    // 단어 단위 wrap → 한 줄이 여전히 maxQuoteW 초과하면 글자 단위로 강제 분할.
    // 한국어는 띄어쓰기가 적어 단어 wrap 만으로는 한 줄이 넘칠 수 있음.
    const splitByGraphemes = (text: string): string[] => {
      const out: string[] = [];
      let cur = '';
      for (const ch of text) {
        const test = cur + ch;
        if (ctx.measureText(test).width > maxQuoteW && cur) {
          out.push(cur);
          cur = ch;
        } else {
          cur = test;
        }
      }
      if (cur) out.push(cur);
      return out;
    };

    const words = quoteText.split(' ');
    const wordLines: string[] = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(test).width > maxQuoteW && cur) {
        wordLines.push(cur);
        cur = w;
      } else {
        cur = test;
      }
    }
    if (cur) wordLines.push(cur);

    const allLines: string[] = [];
    for (const line of wordLines) {
      if (ctx.measureText(line).width > maxQuoteW) allLines.push(...splitByGraphemes(line));
      else allLines.push(line);
    }
    // 최대 3줄. 4줄 이상이면 마지막에 "…" — route(mapY=460) 영역 침범 방지.
    const MAX_LINES = 3;
    let lines = allLines;
    if (allLines.length > MAX_LINES) {
      const truncated = allLines.slice(0, MAX_LINES);
      const last = truncated[MAX_LINES - 1];
      // last 끝부분 자르고 "…" 추가, maxQuoteW 안에 들어가게
      let trimmed = last;
      while (ctx.measureText(trimmed + '…').width > maxQuoteW && trimmed.length > 1) {
        trimmed = trimmed.slice(0, -1);
      }
      truncated[MAX_LINES - 1] = trimmed + '…';
      lines = truncated;
    }

    const lineH = 64;
    const startY = quoteY - ((lines.length - 1) * lineH) / 2;
    lines.forEach((line, i) => ctx.fillText(line, W / 2, startY + i * lineH));
    // 👍 inline 좋아요 제거 (사용자 피드백 D): 칩 영역의 좋아요와 중복됐던 표시 단일화.
  }

  // ★ 사용자 피드백: 세로(일별)↔가로(progress) 위치 swap.
  // 세로 일별 막대 (위) → 가로 progress bar (아래) 순서.
  // 5/11 라벨은 progress bar 의 오늘 위치 위에 표시.

  // (1) 월간 일별 세로 막대 그래프 — 위
  if (dailyKm.size > 0) {
    const chartTop = 1410;
    const chartH = 110;
    const chartPadX = 100;
    const chartW = W - chartPadX * 2;
    const maxDay = Math.max(...Array.from(dailyKm.values()), 1);
    const barWidth = (chartW - 4 * (daysInMonth - 1)) / daysInMonth;

    const onPhoto = !!bgImage;
    const barFillToday = onPhoto ? '#ffffff' : accentColor;
    const barFillOther = onPhoto ? 'rgba(255,255,255,0.55)' : accentColor + 'AA';
    const barFillEmpty = onPhoto ? 'rgba(255,255,255,0.15)' : subColor + '22';

    for (let day = 1; day <= daysInMonth; day++) {
      const km = dailyKm.get(day) ?? 0;
      const x = chartPadX + (day - 1) * (barWidth + 4);
      const h = (km / maxDay) * chartH;
      const isToday = day === todayDay;
      ctx.fillStyle = isToday ? barFillToday : (km > 0 ? barFillOther : barFillEmpty);
      const barH = Math.max(h, 3);
      const barTop = chartTop + chartH - barH;
      ctx.fillRect(x, barTop, barWidth, barH);
    }
  }

  // (2) 월 목표 가로 progress bar — 아래. 흰색.
  if (monthlyGoalKm && monthlyGoalKm > 0 && monthSum > 0) {
    const goalBarTop = 1580;
    const goalBarH = 14;
    const goalBarPadX = 100;
    const goalBarW = W - goalBarPadX * 2;
    const progress = Math.min(1, monthSum / monthlyGoalKm);
    const radius = goalBarH / 2;

    // 트랙 (배경)
    ctx.fillStyle = bgImage ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.20)';
    ctx.beginPath();
    ctx.roundRect(goalBarPadX, goalBarTop, goalBarW, goalBarH, radius);
    ctx.fill();

    // 진행 (흰색)
    ctx.fillStyle = '#ffffff';
    const fillW = Math.max(goalBarH, goalBarW * progress);
    ctx.beginPath();
    ctx.roundRect(goalBarPadX, goalBarTop, fillW, goalBarH, radius);
    ctx.fill();

    // 좌측 라벨 — 월 목표
    ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = bgImage ? 'rgba(255,255,255,0.95)' : mainColor;
    ctx.textAlign = 'left';
    ctx.fillText(`${activityMonth + 1}월 목표`, goalBarPadX, goalBarTop - 14);
    ctx.textAlign = 'right';
    ctx.fillText(`${monthSum.toFixed(1)} / ${monthlyGoalKm.toFixed(0)}km`, goalBarPadX + goalBarW, goalBarTop - 14);

    // 오늘 (M/D) 라벨 — progress bar 의 오늘 위치 위에 표시 (사용자 피드백).
    // bar 의 진행 끝 위치 = 오늘까지 누적된 거리 비율. 단, todayDay/daysInMonth 비율로도 대체 가능.
    // 의미적 정확성을 위해 progress 끝점 사용.
    const todayMarkerX = goalBarPadX + fillW;
    ctx.font = 'bold 26px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = bgImage ? '#ffffff' : accentColor;
    ctx.textAlign = 'center';
    ctx.fillText(`${activityMonth + 1}/${todayDay}`, todayMarkerX, goalBarTop + goalBarH + 32);
  }

  // Footer — 한 라인 가운데 정렬. 좌측 @userId (emerald, 본인 강조), 구분 |, 우측 Routinist.
  // 사용자 결정 (2026-05-09): 자기 이름이 더 중요. 가운데 정렬 + emerald 색으로 강조.
  // build 68: 슬로건 "Run Your Routine." 을 위 라인의 우측 끝(Routinist 의 't')에 우측 정렬
  // → 시각적 anchor 명확. 가운데 정렬은 위/아래 폭 차이로 어정쩡해 보였던 신고 #7.
  const footerY = H * 0.91;
  const userText = `@${userIdLabel ?? displayName}`;
  const sep = ' | ';
  const brand = 'Routinist';
  const userColor = bgImage ? '#34d399' : '#10b981';

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  ctx.font = 'bold 40px -apple-system, BlinkMacSystemFont, sans-serif';
  const userW = ctx.measureText(userText).width;
  ctx.font = '36px -apple-system, BlinkMacSystemFont, sans-serif';
  const sepW = ctx.measureText(sep).width;
  ctx.font = 'bold 36px -apple-system, BlinkMacSystemFont, sans-serif';
  const brandW = ctx.measureText(brand).width;
  const totalW = userW + sepW + brandW;

  const lineLeftX = W / 2 - totalW / 2;
  const lineRightX = W / 2 + totalW / 2;
  let x = lineLeftX;

  ctx.font = 'bold 40px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillStyle = userColor;
  ctx.fillText(userText, x, footerY);
  x += userW;

  ctx.font = '36px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillStyle = subColor;
  ctx.fillText(sep, x, footerY);
  x += sepW;

  ctx.font = 'bold 36px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillStyle = mainColor;
  ctx.fillText(brand, x, footerY);

  // 슬로건 — 우측 정렬. lineRightX 가 Routinist 의 마지막 글자 끝.
  ctx.textAlign = 'right';
  ctx.font = 'bold 32px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillStyle = subColor;
  ctx.fillText('Run Your Routine.', lineRightX, footerY + 56);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
}

function formatDur(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function formatPc(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}'${String(sec).padStart(2, '0')}"`;
}

export default function ShareCard({ activity, displayName, onClose, hideRegister, onRegistered }: ShareCardProps) {
  const { user } = useAuth();
  const { activities, goals } = useUserData();
  // 활동 월의 목표(km) — 가로 progress bar 에 사용. 없으면 undefined → bar 미표시.
  const monthlyGoalKm = (() => {
    const d = new Date(activity.activity_date);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const g = goals?.find(g => g.year === y && g.month === m);
    return g?.goal_km ?? undefined;
  })();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [themeIdx, setThemeIdx] = useState(0);
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [registering, setRegistering] = useState(false);
  const [registerToast, setRegisterToast] = useState<string | null>(null);
  const [quote, setQuote] = useState<DailyQuote | null>(null);
  const [likeBusy, setLikeBusy] = useState(false);
  // 루틴포토 등록 — 디폴트 ON (체크 해제하면 캘린더만 저장).
  // 캘린더 저장은 항상 자동 (UI 표시 X — 사용자 의도).
  const [registerToGallery, setRegisterToGallery] = useState(true);

  // 공유카드 열 때마다 random 명언 + 🎲 버튼으로 새로 굴릴 수 있음.
  // SNS 도배 회피 + 사용자가 마음에 들 때까지 새로 받음.
  // 한국 사용자도 짧은 영어 명언은 무리 없이 이해 — 70% ko / 30% en 으로 다양성.
  const pickQuoteLang = (): 'ko' | 'en' => (Math.random() < 0.3 ? 'en' : 'ko');

  useEffect(() => {
    let cancelled = false;
    fetchRandomQuote(pickQuoteLang()).then(q => { if (!cancelled) setQuote(q); });
    return () => { cancelled = true; };
  }, [activity.id]);

  const rerollQuote = useCallback(async () => {
    const next = await fetchRandomQuote(pickQuoteLang(), quote?.id);
    setQuote(next);
  }, [quote?.id]);

  const handleToggleLike = useCallback(async () => {
    if (!quote || likeBusy || isFallbackQuote(quote)) return;
    setLikeBusy(true);
    // optimistic
    const prev = quote;
    setQuote({
      ...quote,
      liked_by_me: !quote.liked_by_me,
      like_count: quote.like_count + (quote.liked_by_me ? -1 : 1),
    });
    try {
      const res = await toggleQuoteLike(quote.id);
      setQuote(q => (q ? { ...q, liked_by_me: res.liked, like_count: res.like_count } : q));
    } catch (err) {
      console.warn('좋아요 실패:', err);
      setQuote(prev); // 롤백
    } finally {
      setLikeBusy(false);
    }
  }, [quote, likeBusy]);

  // 사용자 ID label — 이름(한글) 노출 방지. 영문/숫자 prefix 추출, fallback email prefix.
  const userIdLabel = (() => {
    const m = displayName?.match(/^[a-zA-Z0-9_.]+/);
    if (m && m[0].length >= 2) return m[0];
    const emailPrefix = user?.email?.split('@')[0];
    return emailPrefix ?? displayName ?? 'runner';
  })();

  const generate = useCallback(() => {
    if (!canvasRef.current) return;
    drawCard(canvasRef.current, activity, displayName, THEMES[themeIdx], bgImage, activities, userIdLabel, quote, monthlyGoalKm);
  }, [activity, displayName, themeIdx, bgImage, activities, userIdLabel, quote, monthlyGoalKm]);

  useEffect(() => { generate(); }, [generate]);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => setBgImage(img);
    img.src = URL.createObjectURL(file);
  };

  const clearPhoto = () => setBgImage(null);

  const handleDownload = async () => {
    if (!canvasRef.current) return;

    if (isNativeApp()) {
      // iOS/Android: Capacitor Filesystem + Share
      try {
        const base64 = canvasRef.current.toDataURL('image/png').split(',')[1];
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        const fileName = `routinist-${activity.activity_date}.png`;
        const result = await Filesystem.writeFile({
          path: fileName,
          data: base64,
          directory: Directory.Cache,
        });
        // 네이티브 공유 시트로 열기
        const { Share } = await import('@capacitor/share');
        await Share.share({
          title: `${activity.distance_km.toFixed(2)}km 러닝`,
          url: result.uri,
        });
      } catch (err) {
        console.warn('네이티브 저장 실패, 웹 폴백:', err);
        // 웹 폴백
        const link = document.createElement('a');
        link.download = `routinist-${activity.activity_date}.png`;
        link.href = canvasRef.current.toDataURL('image/png');
        link.click();
      }
    } else {
      const link = document.createElement('a');
      link.download = `routinist-${activity.activity_date}.png`;
      link.href = canvasRef.current.toDataURL('image/png');
      link.click();
    }
  };

  // 캔버스 → blob → storage 업로드 → calendar_photos 자동 + activity_photos 옵션
  // build 56: 모든 supabase 호출에 withTimeout 보호.
  // 사용자 결정: 캘린더는 항상 자동, 루틴포토는 사용자 선택 (체크박스).
  const handleRegister = async (includeGallery: boolean) => {
    if (!canvasRef.current || !user) return;
    setRegistering(true);

    // PromiseLike — Supabase 의 thenable builder 도 받게.
    const withTimeout = <T,>(p: PromiseLike<T>, ms: number, label: string): Promise<T> =>
      Promise.race<T>([
        Promise.resolve(p),
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`${label} ${ms / 1000}s timeout`)), ms)
        ),
      ]);

    try {
      const blob = await new Promise<Blob | null>(res => canvasRef.current!.toBlob(b => res(b), 'image/png'));
      if (!blob) throw new Error('이미지 변환 실패');
      const supabase = getSupabase();
      const path = `${user.id}/routine/${activity.activity_date}-${Date.now()}.png`;

      // storage upload — 30s. 사진은 수백 KB 라 LTE 환경 대응.
      const { error: upErr } = await withTimeout(
        supabase.storage.from('activity-photos').upload(path, blob, { contentType: 'image/png', upsert: false }),
        30000,
        'photo storage upload',
      );
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('activity-photos').getPublicUrl(path);
      const photoUrl = urlData.publicUrl;

      // 캘린더(항상) + 루틴포토(옵션). 동시 실행, 각 8s.
      const tasks: Promise<unknown>[] = [
        withTimeout(
          supabase.from('calendar_photos').upsert({
            user_id: user.id,
            date: activity.activity_date,
            photo_url: photoUrl,
          }, { onConflict: 'user_id,date' }),
          8000,
          'calendar_photos upsert',
        ),
      ];
      if (includeGallery) {
        tasks.push(
          withTimeout(
            supabase.from('activity_photos').insert({
              activity_id: activity.id,
              user_id: user.id,
              photo_url: photoUrl,
              share_in_gallery: true,
              sort_order: 0,
            }),
            8000,
            'activity_photos insert',
          ),
        );
      }
      const results = await Promise.allSettled(tasks);
      const calOk = results[0].status === 'fulfilled' && !(results[0].value as { error?: unknown })?.error;
      const photoOk = !includeGallery
        ? true
        : results[1].status === 'fulfilled' && !(results[1].value as { error?: unknown })?.error;

      if (calOk && photoOk) {
        setRegisterToast(includeGallery ? '✨ 공유됨!' : '✨ 캘린더에 저장됐어요');
      } else if (calOk || photoOk) {
        setRegisterToast(`부분 등록 — ${calOk ? '캘린더는 OK' : '갤러리만 OK'}. 다시 시도하세요.`);
      } else {
        throw new Error('등록 실패');
      }
      setTimeout(() => { setRegisterToast(null); onRegistered?.(); onClose(); }, 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '알 수 없는 오류';
      console.warn('등록 실패:', err);
      setRegisterToast(`등록 실패: ${msg}`);
      setTimeout(() => setRegisterToast(null), 3000);
    } finally {
      setRegistering(false);
    }
  };

  const handleShare = async () => {
    if (!canvasRef.current) return;

    if (isNativeApp()) {
      // 네이티브에서는 handleDownload가 공유까지 처리
      await handleDownload();
      return;
    }

    canvasRef.current.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], `routinist-${activity.activity_date}.png`, { type: 'image/png' });
      if (navigator.share) {
        try { await navigator.share({ files: [file], title: `${activity.distance_km.toFixed(2)}km 러닝` }); } catch { /* cancelled */ }
      } else { await handleDownload(); }
    }, 'image/png');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-[var(--background)] rounded-2xl max-w-sm w-full overflow-hidden max-h-[90vh] flex flex-col">
        {/* 캔버스 — 닫기 버튼은 이미지 우상단 floating (status bar 영역 아닌 카드 안). */}
        <div className="p-4 flex-1 overflow-auto relative">
          <canvas ref={canvasRef} className="w-full rounded-xl shadow-lg" style={{ aspectRatio: '9/16' }} />
          <button
            onClick={onClose}
            aria-label="닫기"
            className="absolute top-6 right-6 w-10 h-10 flex items-center justify-center rounded-full bg-black/55 hover:bg-black/75 active:scale-90 backdrop-blur-sm shadow-md"
          >
            <X size={20} strokeWidth={2.5} className="text-white" />
          </button>
        </div>

        {/* 명언 컨트롤 — 👍 좋아요 + 🎲 다른 명언. 클릭 시 카드 다시 그려짐. */}
        {quote && !isFallbackQuote(quote) && (
          <div className="px-4 pb-2 flex items-center justify-center gap-2 flex-shrink-0">
            <button
              onClick={handleToggleLike}
              disabled={likeBusy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--card)] border border-[var(--card-border)] text-sm disabled:opacity-50"
              aria-label={quote.liked_by_me ? '좋아요 취소' : '명언 좋아요'}
            >
              <ThumbsUp
                size={16}
                className={quote.liked_by_me ? 'text-emerald-500' : 'text-[var(--muted)]'}
                fill={quote.liked_by_me ? '#10b981' : 'transparent'}
              />
              <span className={quote.liked_by_me ? 'text-emerald-500 font-semibold' : 'text-[var(--muted)]'}>
                {quote.like_count}
              </span>
            </button>
            <button
              onClick={rerollQuote}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--card)] border border-[var(--card-border)] text-sm text-[var(--muted)] active:scale-95"
              aria-label="다른 명언"
            >
              <Dices size={16} />
              <span>다른 명언</span>
            </button>
          </div>
        )}

        {/* 테마 선택 — 5개 한 줄 grid (사용자 피드백 #9). 화살표 제거. */}
        <div className="px-4 pb-2 flex-shrink-0">
          <div className="grid grid-cols-5 gap-1.5">
            {THEMES.map((t, i) => (
              <button
                key={t.name}
                onClick={() => setThemeIdx(i)}
                className={`py-1.5 rounded-full text-xs font-bold transition-all active:scale-95 ${
                  i === themeIdx && !bgImage
                    ? 'bg-[var(--accent)] text-white shadow-sm'
                    : 'bg-[var(--card)] text-[var(--muted)] border border-[var(--card-border)]'
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>

        {/* 액션 영역 (UI 세련화):
            1) 배경 사진 추가/변경 — 사진 있으면 우측 inline X 로 제거
            2) 루틴포토 등록 체크박스 (디폴트 ON) — 캘린더는 항상 자동
            3) 공유 — 단일 CTA. "사진으로 저장만" 제거 */}
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
        <div className="flex flex-col gap-3 px-4 pb-4 pt-2 flex-shrink-0">
          {/* 배경 사진 — 메인 emerald CTA + 사진 있을 때 inline X */}
          <div className="relative">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-bold text-base shadow-md active:scale-[0.99] transition"
            >
              <ImagePlus size={18} /> {bgImage ? '사진 변경' : '배경 사진 추가'}
            </button>
            {bgImage && (
              <button
                onClick={(e) => { e.stopPropagation(); clearPhoto(); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 active:bg-white/40 flex items-center justify-center transition"
                aria-label="배경 사진 제거"
              >
                <X size={16} className="text-white" strokeWidth={2.5} />
              </button>
            )}
          </div>

          {/* 루틴포토 체크박스 — 디폴트 ON (사용자 결정). 캘린더는 항상 자동 (UI 표시 X) */}
          {!hideRegister && (
            <label className="flex items-center gap-2.5 px-1 cursor-pointer select-none">
              <span className="relative flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={registerToGallery}
                  onChange={(e) => setRegisterToGallery(e.target.checked)}
                  className="peer sr-only"
                />
                <span className="w-5 h-5 rounded-md border-2 border-[var(--card-border)] peer-checked:bg-emerald-500 peer-checked:border-emerald-500 transition-all" />
                {registerToGallery && (
                  <Check size={14} className="absolute text-white pointer-events-none" strokeWidth={3} />
                )}
              </span>
              <span className="text-sm text-[var(--foreground)]">루틴포토에 등록</span>
            </label>
          )}

          {/* 공유 — 단일 CTA. 캘린더 자동 + 루틴포토(체크박스 ON 일 때) + 공유 시트 */}
          <button
            onClick={async () => {
              if (!hideRegister) handleRegister(registerToGallery);
              await handleShare();
              setTimeout(() => onClose(), 1200);
            }}
            disabled={registering}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-[var(--accent)] text-white font-semibold text-base disabled:opacity-50 active:scale-[0.99] transition"
          >
            {registering ? (
              <>
                <span className="animate-spin w-4 h-4 border-2 border-white/70 border-t-transparent rounded-full" />
                <span>공유 중...</span>
              </>
            ) : (
              <><Share2 size={18} /> 공유</>
            )}
          </button>
        </div>
      </div>

      {/* 성공 시 큰 ✓ overlay (build 63) — 자동 닫기 전 시각 피드백 */}
      {registerToast && registerToast.startsWith('✨') && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center pointer-events-none animate-[fadeIn_0.3s_ease-out]">
          <div className="flex flex-col items-center gap-3">
            <div className="w-20 h-20 rounded-full bg-emerald-500 flex items-center justify-center shadow-2xl animate-[pulse_0.6s_ease-out]">
              <Check size={40} className="text-white" strokeWidth={3} />
            </div>
            <p className="text-white text-base font-bold drop-shadow-lg">공유됨!</p>
          </div>
        </div>
      )}

      {registerToast && (
        <AppToast
          text={registerToast}
          tone={registerToast.startsWith('등록 실패') ? 'warn' : 'ok'}
          onClose={() => setRegisterToast(null)}
          durationMs={registerToast.startsWith('등록 실패') ? 3000 : 1500}
        />
      )}
    </div>
  );
}
