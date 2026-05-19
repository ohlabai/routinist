'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { Share2, X, ImagePlus, Check, Dices, PenLine, Video, ImageIcon } from 'lucide-react';
import { isNativeApp } from '@/lib/health-sync';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/components/UserDataProvider';
import { fetchRandomQuote, isFallbackQuote, type DailyQuote } from '@/lib/quotes-data';
import { detectRegionLabel } from '@/lib/region-from-gps';
import { captureCanvasAnimation } from '@/lib/canvas-to-video';
import { createUserQuote } from '@/lib/user-quotes';
import { getSupabase } from '@/lib/supabase';
import { track } from '@/lib/analytics';
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

// build 136: drawCard 가 정적 + 애니메이션(MP4) 두 용도로 쓰임.
// routeProgress (0~1) 가 1 미만이면 GPS 경로를 그 비율만큼만 그림 → 라인 그리기 애니메이션.
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
  regionLabel?: string,
  routeProgress: number = 1,
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

  // 경로 — build 136 (사용자 피드백 #5-C): 지도와 7.19 사이 여백 확대.
  // mapY 290 → 260 위로 + mapH 480 유지. 지역 라벨(regionLabel) 을 지도 위 표시.
  // routeProgress < 1 일 때는 그 비율만큼만 그려 MP4 애니메이션의 한 프레임으로 사용.
  const hasRoute = activity.route_data?.coordinates?.length;
  if (hasRoute) {
    const coordsAll = activity.route_data!.coordinates;
    const lats = coordsAll.map(c => c[1]);
    const lngs = coordsAll.map(c => c[0]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);

    const padding = 120;
    const mapW = W - padding * 2;
    const mapH = 480;
    const mapY = 260;

    const scaleX = mapW / (maxLng - minLng || 0.001);
    const scaleY = mapH / (maxLat - minLat || 0.001);
    const scale = Math.min(scaleX, scaleY);

    const offsetX = padding + (mapW - (maxLng - minLng) * scale) / 2;
    const offsetY = mapY + (mapH - (maxLat - minLat) * scale) / 2;

    // 애니메이션: routeProgress 비율만큼 슬라이스 (최소 2개 필요).
    const cutIdx = Math.max(2, Math.ceil(coordsAll.length * Math.min(1, Math.max(0, routeProgress))));
    const coords = coordsAll.slice(0, cutIdx);

    // 그림자 (배경사진 위에서도 또렷하게) — 전체 라인을 흐리게 깔아두면 미리보기가 안정됨.
    ctx.beginPath();
    coordsAll.forEach(([lng, lat], i) => {
      const x = offsetX + (lng - minLng) * scale;
      const y = offsetY + mapH - (lat - minLat) * scale;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = bgImage ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 16;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // 경로 본체 — routeProgress 비율만큼만
    ctx.beginPath();
    coords.forEach(([lng, lat], i) => {
      const x = offsetX + (lng - minLng) * scale;
      const y = offsetY + mapH - (lat - minLat) * scale;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = bgImage ? '#ffffff' : theme.routeColor;
    ctx.lineWidth = 8;
    ctx.stroke();

    // 시작점 — 항상 표시
    const [sx, sy] = [offsetX + (coordsAll[0][0] - minLng) * scale, offsetY + mapH - (coordsAll[0][1] - minLat) * scale];
    ctx.fillStyle = '#22C55E';
    ctx.beginPath(); ctx.arc(sx, sy, 14, 0, Math.PI * 2); ctx.fill();
    if (bgImage) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.stroke(); }

    // 끝점 — 라인이 종착하는 위치 (애니메이션 중에는 현재 진행점이 보임)
    const lastCoord = coords[coords.length - 1];
    const [ex, ey] = [offsetX + (lastCoord[0] - minLng) * scale, offsetY + mapH - (lastCoord[1] - minLat) * scale];
    if (routeProgress >= 1) {
      ctx.fillStyle = '#EF4444';
      ctx.beginPath(); ctx.arc(ex, ey, 14, 0, Math.PI * 2); ctx.fill();
      if (bgImage) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.stroke(); }
    } else {
      // 애니메이션 진행 중 — 깜빡이는 진행점 (러닝 마커)
      const pulse = 1 + 0.2 * Math.sin(routeProgress * Math.PI * 6);
      ctx.fillStyle = '#22C55E';
      ctx.beginPath(); ctx.arc(ex, ey, 12 * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.stroke();
    }

    // 지역 라벨 — 지도 상단 좌측 (build 136). "서울 강남" 또는 "중국 항저우" 형태.
    if (regionLabel) {
      ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      const labelText = `📍 ${regionLabel}`;
      const padX = 18;
      const textW = ctx.measureText(labelText).width;
      const labelX = padding;
      const labelY = mapY + 8;
      // 반투명 알약 배경
      ctx.fillStyle = bgImage ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.roundRect(labelX, labelY, textW + padX * 2, 44, 22);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(labelText, labelX + padX, labelY + 30);
      ctx.textAlign = 'center';
    }
  }

  const mainColor = bgImage ? '#ffffff' : theme.textMain;
  const subColor = bgImage ? 'rgba(255,255,255,0.7)' : theme.textSub;
  const accentColor = bgImage ? '#ffffff' : theme.accent;

  // 날짜는 하단 월간 막대그래프의 today 라벨로 대체 (사용자 피드백 #13). 상단 공간 확보.
  ctx.textAlign = 'center';

  // 월간 합계 + 일별 거리 맵 — 그래프(하단) + stats 4번째 컬럼에서 사용.
  let monthSum = 0;
  let monthRunCount = 0;  // build 110: 그 달 총 러닝 횟수 (막대그래프 아래 표시)
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

    const inMonth = monthlyActivities.filter(a => {
      const d = new Date(a.activity_date);
      return d.getFullYear() === activityYear && d.getMonth() === activityMonth;
    });
    monthSum = inMonth.reduce((s, a) => s + a.distance_km, 0);
    monthRunCount = inMonth.length;

    dailyKm = new Map<number, number>();
    monthlyActivities.forEach(a => {
      const d = new Date(a.activity_date);
      if (d.getFullYear() === activityYear && d.getMonth() === activityMonth) {
        dailyKm.set(d.getDate(), (dailyKm.get(d.getDate()) ?? 0) + a.distance_km);
      }
    });
  }

  // 거리 (메인) — build 136: map 끝(260+480=740) 과 7.19 사이 여백 확보.
  // distY 가 폰트의 baseline 이라 실제 위쪽은 distY-180. distY=950 → 폰트 시작 770 → map 끝 740 과 30px 여백.
  const distY = hasRoute ? 950 : H * 0.36;
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

  // 명언 (그날의 메시지) — 상단 큰 글씨 hero. author 는 별도 라인(작게)으로 분리.
  if (quote) {
    const quoteText = `"${quote.text}"`;  // author 는 별도 라인
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

    // author — build 136: 좋아요 아이콘 제거. 깔끔한 작은 라인.
    const author = quote.author ?? null;
    if (author) {
      const authorLineY = startY + (lines.length - 1) * lineH + 56;
      ctx.font = '500 30px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillStyle = subColor;
      ctx.textAlign = 'center';
      ctx.fillText(`- ${author}`, W / 2, authorLineY);
    }
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
  }

  // ★ build 136 (사용자 피드백 #5-a): 기록(statsY≈1150) 과 막대 사이 여백 축소.
  // chartTop 1320 → 1230. progress bar 도 함께 위로 (1560 → 1480).
  // "이달 N회" 라벨 → 마지막 달린 막대 아래에 작은 숫자 N (사용자 피드백).

  // (1) 월간 일별 세로 막대 그래프
  // build 141: 사용자 재요청 — 두 막대 그래프 덩어리를 더 아래로 + 위 stats4 와 더 분리.
  // chartTop 1270 → 1380 (위 stats=1160 과 gap 220 — 분리감), chartH 110 끝 1490.
  // goalBarTop 1440 → 1530 (위 막대 끝 1490 과 gap 40 — 한 덩어리 느낌).
  if (dailyKm.size > 0) {
    const chartTop = 1380;
    const chartH = 110;
    const chartPadX = 100;
    const chartW = W - chartPadX * 2;
    const maxDay = Math.max(...Array.from(dailyKm.values()), 1);
    const barWidth = (chartW - 4 * (daysInMonth - 1)) / daysInMonth;

    const onPhoto = !!bgImage;
    const barFillToday = onPhoto ? '#ffffff' : accentColor;
    const barFillOther = onPhoto ? 'rgba(255,255,255,0.55)' : accentColor + 'AA';
    const barFillEmpty = onPhoto ? 'rgba(255,255,255,0.15)' : subColor + '22';

    // 마지막 달린 날 (todayDay 이전 + km>0 중 가장 큰 day) — 막대 위치 추적
    let lastRunDay = 0;
    for (let day = 1; day <= todayDay; day++) {
      if ((dailyKm.get(day) ?? 0) > 0) lastRunDay = day;
    }

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

    // build 136: "이달 N회" 라벨 대신 마지막 달린 막대 아래에 N 숫자만.
    // 짧고 직관적 — 막대그래프 컨텍스트 안에서 즉시 이해.
    if (monthRunCount > 0 && lastRunDay > 0) {
      const x = chartPadX + (lastRunDay - 1) * (barWidth + 4) + barWidth / 2;
      const labelY = chartTop + chartH + 32;
      ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillStyle = bgImage ? 'rgba(255,255,255,0.95)' : mainColor;
      ctx.textAlign = 'center';
      ctx.fillText(`${monthRunCount}`, x, labelY);
    }
  }

  // (2) 가로 progress bar — 위 막대(1380+110=1490) 끝과 40px 간격으로 한 덩어리 인상.
  if (monthlyGoalKm && monthlyGoalKm > 0 && monthSum > 0) {
    const goalBarTop = 1530;
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

    // 두 라벨 모두 progress bar **아래** + 같은 폰트 크기 32px (사용자 피드백 — 키움 + 통일).
    // 5/11 — 오늘 진행 끝점에 정렬.   88.2/200km — 우측 끝에 정렬.
    const labelY = goalBarTop + goalBarH + 38;
    const todayMarkerX = goalBarPadX + fillW;

    ctx.font = 'bold 32px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = bgImage ? '#ffffff' : accentColor;
    ctx.textAlign = 'center';
    ctx.fillText(`${activityMonth + 1}/${todayDay}`, todayMarkerX, labelY);

    ctx.font = 'bold 32px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = bgImage ? 'rgba(255,255,255,0.95)' : mainColor;
    ctx.textAlign = 'right';
    ctx.fillText(`${monthSum.toFixed(1)} / ${monthlyGoalKm.toFixed(0)}km`, goalBarPadX + goalBarW, labelY);
  }

  // 포토에세이 — 공유카드 캔버스에는 표시 X (사용자 피드백 build 100).
  // essay 입력은 갤러리 카드 노출용으로만 사용. ShareCard 캔버스 자체는 깔끔하게.

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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export default function ShareCard({ activity, displayName, onClose, hideRegister, onRegistered }: ShareCardProps) {
  const { user, profile } = useAuth();
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
  // build 142: setTimeout cleanup — 모달 unmount 후 state 업데이트 경고 회피.
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);
  const [themeIdx, setThemeIdx] = useState(0);
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [registering, setRegistering] = useState(false);
  const [registerToast, setRegisterToast] = useState<string | null>(null);
  const [quote, setQuote] = useState<DailyQuote | null>(null);
  // build 136: 동영상 공유 기본 + 정적 이미지 선택 옵션. MediaRecorder 미지원 기기는 자동으로 이미지.
  const [shareAsVideo, setShareAsVideo] = useState(true);
  const [renderingVideo, setRenderingVideo] = useState(false);

  // GPS 첫 좌표 + profile region → 지역 라벨 (한국이면 "서울 강남", 해외면 "중국 항저우")
  const regionLabel = (() => {
    const first = activity.route_data?.coordinates?.[0] as [number, number] | undefined;
    return detectRegionLabel(first ?? null, profile);
  })();
  // 루틴포토 등록 — 디폴트 ON (체크 해제하면 캘린더만 저장).
  // 캘린더 저장은 항상 자동 (UI 표시 X — 사용자 의도).
  const [registerToGallery, setRegisterToGallery] = useState(true);
  // 나의 명언 작성. 모달 형태로 띄움.
  const [showMyQuoteModal, setShowMyQuoteModal] = useState(false);
  const [myQuoteText, setMyQuoteText] = useState('');
  const [submittingMyQuote, setSubmittingMyQuote] = useState(false);

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

  // 사용자 ID label — 이름(한글) 노출 방지. 영문/숫자 prefix 추출, fallback email prefix.
  const userIdLabel = (() => {
    const m = displayName?.match(/^[a-zA-Z0-9_.]+/);
    if (m && m[0].length >= 2) return m[0];
    const emailPrefix = user?.email?.split('@')[0];
    return emailPrefix ?? displayName ?? 'runner';
  })();

  const generate = useCallback(() => {
    if (!canvasRef.current) return;
    drawCard(canvasRef.current, activity, displayName, THEMES[themeIdx], bgImage, activities, userIdLabel, quote, monthlyGoalKm, regionLabel ?? undefined, 1);
  }, [activity, displayName, themeIdx, bgImage, activities, userIdLabel, quote, monthlyGoalKm, regionLabel]);

  useEffect(() => { generate(); }, [generate]);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => setBgImage(img);
    img.src = URL.createObjectURL(file);
  };

  const clearPhoto = () => setBgImage(null);

  // build 143: 공유 실패 시 toast 로 에러 노출 (이전 silent fallback → 사용자 모름 회귀).
  const showShareError = (label: string, err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ShareCard] ${label} 실패:`, err);
    setRegisterToast(`공유 실패 — ${msg.slice(0, 80)}`);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setRegisterToast(null), 3500);
  };

  // build 136: 정적 PNG 공유. 네이티브 공유 시트 (Capacitor Share) + 캡션.
  const sharePngBlob = async (blob: Blob, urlForCaption: string) => {
    const text = `${shareCaption}\n${urlForCaption}`;
    if (isNativeApp()) {
      try {
        const dataUrl = await blobToDataUrl(blob);
        const base64 = dataUrl.split(',')[1];
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        const fileName = `routinist-${activity.activity_date}.png`;
        const result = await Filesystem.writeFile({
          path: fileName,
          data: base64,
          directory: Directory.Cache,
        });
        const { Share } = await import('@capacitor/share');
        await Share.share({
          title: `${activity.distance_km.toFixed(2)}km 러닝`,
          text,
          url: result.uri,
          dialogTitle: '러닝 기록 공유',
        });
      } catch (err) {
        showShareError('네이티브 PNG 공유', err);
      }
    } else if (navigator.share) {
      try {
        const file = new File([blob], `routinist-${activity.activity_date}.png`, { type: 'image/png' });
        await navigator.share({ files: [file], title: `${activity.distance_km.toFixed(2)}km 러닝`, text });
      } catch (err) {
        // user cancelled 인지 진짜 에러인지 구분 — AbortError 는 무시.
        if (err instanceof Error && err.name !== 'AbortError') showShareError('웹 공유', err);
      }
    } else {
      downloadBlob(blob, `routinist-${activity.activity_date}.png`);
    }
  };

  // 비디오 (MP4/webm) 네이티브 공유. 카톡·인스타가 동영상으로 인식.
  const shareVideoBlob = async (blob: Blob, extension: 'mp4' | 'webm', urlForCaption: string) => {
    const text = `${shareCaption}\n${urlForCaption}`;
    const fileName = `routinist-${activity.activity_date}.${extension}`;
    if (isNativeApp()) {
      try {
        const dataUrl = await blobToDataUrl(blob);
        const base64 = dataUrl.split(',')[1];
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        const result = await Filesystem.writeFile({
          path: fileName,
          data: base64,
          directory: Directory.Cache,
        });
        const { Share } = await import('@capacitor/share');
        await Share.share({
          title: `${activity.distance_km.toFixed(2)}km 러닝`,
          text,
          url: result.uri,
          dialogTitle: '러닝 기록 공유',
        });
      } catch (err) {
        showShareError('네이티브 비디오 공유', err);
      }
    } else if (navigator.share) {
      try {
        const mime = extension === 'mp4' ? 'video/mp4' : 'video/webm';
        const file = new File([blob], fileName, { type: mime });
        await navigator.share({ files: [file], title: `${activity.distance_km.toFixed(2)}km 러닝`, text });
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') showShareError('웹 비디오 공유', err);
      }
    } else {
      downloadBlob(blob, fileName);
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
        // quote_id 는 quotes 테이블 row 일 때만(non-fallback). fallback(static)·네트워크 실패 케이스는 row 없음.
        // build 137: caption 컬럼에 quote.text 직접 저장 → view join 실패해도 캡션 노출 보장 (회귀 fix).
        const quoteIdForCard = quote && !isFallbackQuote(quote) ? quote.id : null;
        const captionForCard = quote ? quote.text : null;
        tasks.push(
          withTimeout(
            supabase.from('activity_photos').insert({
              activity_id: activity.id,
              user_id: user.id,
              photo_url: photoUrl,
              share_in_gallery: true,
              sort_order: 0,
              quote_id: quoteIdForCard,
              caption: captionForCard,
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
      // build 142: setTimeout cleanup — 모달 unmount 후 state 업데이트 회피.
      const closeTimer = setTimeout(() => { setRegisterToast(null); onRegistered?.(); onClose(); }, 1500);
      toastTimerRef.current = closeTimer;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '알 수 없는 오류';
      console.warn('등록 실패:', err);
      setRegisterToast(`등록 실패: ${msg}`);
      const errTimer = setTimeout(() => setRegisterToast(null), 3000);
      toastTimerRef.current = errTimer;
    } finally {
      setRegistering(false);
    }
  };

  // 캡션 — 한 줄 일기/명언 + 해시태그. 공유 시 OG 딥링크가 별도 줄로 첨부됨 (sharePngBlob/shareVideoBlob 내부).
  const shareCaption = quote
    ? `"${quote.text}"${quote.author ? ` — ${quote.author}` : ''}\n\n#Routinist #${activity.distance_km.toFixed(1)}km`
    : `오늘도 한 발 더. ${activity.distance_km.toFixed(2)}km #Routinist`;

  // build 136: 공유는 단일 CTA. 동영상 토글 ON 이면 라인 그리기 MP4, OFF 또는 미지원이면 PNG.
  const handleShare = async () => {
    if (!canvasRef.current) return;
    track('share_card_share', {
      activity_id: activity.id,
      distance_km: activity.distance_km,
      has_quote: !!quote,
      native: isNativeApp(),
      as_video: shareAsVideo,
    });

    // 카톡/인스타에서 링크 누르면 앱(또는 설치 페이지) 으로 — build 136 OG 라우트.
    // build 141 fix: routinist.kr 은 cafe24 mall — 앱 OG 도메인은 app.routinist.kr (Vercel Next 앱).
    const shareLandingUrl = `https://app.routinist.kr/r/${activity.id}`;

    // 비디오 분기 — MediaRecorder 지원 + GPS 라인 있을 때만 의미 있음.
    const hasRoute = !!activity.route_data?.coordinates?.length;
    if (shareAsVideo && hasRoute && typeof MediaRecorder !== 'undefined') {
      setRenderingVideo(true);
      try {
        const result = await captureCanvasAnimation(
          canvasRef.current,
          (progress) => {
            drawCard(
              canvasRef.current!,
              activity,
              displayName,
              THEMES[themeIdx],
              bgImage,
              activities,
              userIdLabel,
              quote,
              monthlyGoalKm,
              regionLabel ?? undefined,
              progress,
            );
          },
          // build 142: durationMs/holdMs default 사용 (canvas-to-video 의 4000/1500ms).
          // 이전 명시값 2500/1000 이 build 137 의 default 변경을 덮어쓰던 회귀 fix.
          { fps: 30, bitsPerSecond: 5_000_000 },
        );
        await shareVideoBlob(result.blob, result.extension, shareLandingUrl);
      } catch (err) {
        console.warn('비디오 생성 실패, PNG 폴백:', err);
        const blob = await new Promise<Blob | null>(res => canvasRef.current!.toBlob(b => res(b), 'image/png'));
        if (blob) await sharePngBlob(blob, shareLandingUrl);
      } finally {
        // 정적 카드로 복귀
        generate();
        setRenderingVideo(false);
      }
      return;
    }

    // 정적 이미지 공유
    const blob = await new Promise<Blob | null>(res => canvasRef.current!.toBlob(b => res(b), 'image/png'));
    if (blob) await sharePngBlob(blob, shareLandingUrl);
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
            className="absolute right-6 w-10 h-10 flex items-center justify-center rounded-full bg-black/55 hover:bg-black/75 active:scale-90 backdrop-blur-sm shadow-md"
            style={{ top: 'calc(env(safe-area-inset-top, 0px) + 24px)' }}
          >
            <X size={20} strokeWidth={2.5} className="text-white" />
          </button>
        </div>

        {/* 명언 컨트롤 — 🎲 다른 명언 + ✍️ 한 줄 일기 (build 136: 좋아요 제거, 명언 좋아요는 포토 랭킹에서 사진별로 누름).
            한 줄 일기 안 쓰면 표시되는 명언이 그대로 카드에 들어감 (랜덤 fallback). */}
        {quote && (
          <div className="px-4 pb-2 flex items-center justify-center gap-1.5 flex-shrink-0 flex-wrap">
            <button
              onClick={rerollQuote}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--card)] border border-[var(--card-border)] text-sm text-[var(--muted)] active:scale-95"
              aria-label="다른 한 줄"
            >
              <Dices size={16} />
              <span>다른 한 줄</span>
            </button>
            <button
              onClick={() => { setMyQuoteText(''); setShowMyQuoteModal(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 border border-emerald-200/60 dark:border-emerald-900/40 text-sm text-emerald-700 dark:text-emerald-300 font-semibold active:scale-95"
              aria-label="한 줄 일기 작성"
            >
              <PenLine size={16} />
              <span>한 줄 일기</span>
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

          {/* 한 줄 일기 / 명언 미리보기 — 인스타식 카드 아래 텍스트 (build 136).
              공유 시 캡션으로 함께 전달 + 갤러리에 텍스트로도 저장.
              개별 SNS 버튼은 제거 (사용자 피드백) — 카톡/인스타 공유는 메인 [공유] 버튼 한 번으로 OG 링크 + 비디오. */}
          {quote && (
            <div className="px-1">
              <div className="rounded-xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-900/40 px-3 py-2.5">
                <p className="text-sm text-emerald-900 dark:text-emerald-100 leading-snug break-keep">
                  &ldquo;{quote.text}&rdquo;
                  {quote.author && (
                    <span className="text-xs text-emerald-700 dark:text-emerald-300 font-semibold"> — {quote.author}</span>
                  )}
                </p>
              </div>
            </div>
          )}

          {/* 동영상 / 이미지 토글 (build 136) — GPS 경로 있을 때만 표시.
              동영상: 출발→도착 라인 그리기 2.5초 + 정지 1초. 카톡/인스타에서 단일 파일로 자동 재생. */}
          {!!activity.route_data?.coordinates?.length && typeof MediaRecorder !== 'undefined' && (
            <div className="grid grid-cols-2 gap-1.5 px-1">
              <button
                onClick={() => setShareAsVideo(true)}
                className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition active:scale-95 ${
                  shareAsVideo
                    ? 'bg-emerald-500 text-white shadow-sm'
                    : 'bg-[var(--card)] text-[var(--muted)] border border-[var(--card-border)]'
                }`}
              >
                <Video size={14} />
                동영상 (경로 그리기)
              </button>
              <button
                onClick={() => setShareAsVideo(false)}
                className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition active:scale-95 ${
                  !shareAsVideo
                    ? 'bg-emerald-500 text-white shadow-sm'
                    : 'bg-[var(--card)] text-[var(--muted)] border border-[var(--card-border)]'
                }`}
              >
                <ImageIcon size={14} />
                정적 이미지
              </button>
            </div>
          )}

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

          {/* 공유 — 단일 CTA. 캘린더 자동 + 루틴포토(체크박스 ON 일 때) + 공유 시트.
              build 136: 비디오 렌더링 중에는 별도 진행 상태 표시. */}
          <button
            onClick={async () => {
              if (!hideRegister) handleRegister(registerToGallery);
              await handleShare();
              setTimeout(() => onClose(), 1200);
            }}
            disabled={registering || renderingVideo}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-[var(--accent)] text-white font-semibold text-base disabled:opacity-50 active:scale-[0.99] transition"
          >
            {renderingVideo ? (
              <>
                <span className="animate-spin w-4 h-4 border-2 border-white/70 border-t-transparent rounded-full" />
                <span>동영상 만드는 중...</span>
              </>
            ) : registering ? (
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

      {/* 나의 명언 작성 모달 (사용자 피드백 #8) */}
      {showMyQuoteModal && (
        <div
          className="fixed inset-0 z-[80] bg-black/65 flex items-center justify-center p-4 animate-[fadeIn_0.2s_ease-out]"
          onClick={() => !submittingMyQuote && setShowMyQuoteModal(false)}
        >
          <div
            className="w-full max-w-sm bg-[var(--background)] rounded-3xl p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-base font-extrabold inline-flex items-center gap-1.5">
                  <PenLine size={16} className="text-emerald-500" /> 한 줄 일기
                </h3>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  공유 카드에 — {displayName} 닉네임으로 표시돼요
                </p>
              </div>
              <button onClick={() => setShowMyQuoteModal(false)} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--card-border)]/40 active:scale-90">
                <X size={16} />
              </button>
            </div>
            <textarea
              value={myQuoteText}
              onChange={(e) => setMyQuoteText(e.target.value.slice(0, 300))}
              placeholder='예) "오늘도 한 발 더, 어제의 나를 이겼다."'
              rows={4}
              autoFocus
              className="w-full px-3.5 py-3 rounded-2xl border-2 border-[var(--card-border)] bg-[var(--background)] text-sm focus:outline-none focus:border-emerald-500 resize-none"
            />
            <div className="flex justify-between mt-1.5">
              <span className="text-[10px] text-[var(--muted)]">{myQuoteText.length}/300</span>
              <span className="text-[10px] text-emerald-600 font-semibold">공유 카드 + 갤러리 캡션</span>
            </div>
            <button
              onClick={async () => {
                const trimmed = myQuoteText.trim();
                if (trimmed.length < 3) {
                  setRegisterToast('한 줄 일기가 너무 짧아요 (3자 이상)');
                  setTimeout(() => setRegisterToast(null), 2200);
                  return;
                }
                setSubmittingMyQuote(true);
                try {
                  const id = await createUserQuote(trimmed);
                  // 즉시 카드에 반영
                  setQuote({
                    id,
                    lang: 'ko_self',
                    category: 'user',
                    text: trimmed,
                    author: displayName,
                    like_count: 0,
                    liked_by_me: false,
                  });
                  setRegisterToast('✨ 한 줄 일기가 등록됐어요');
                  setShowMyQuoteModal(false);
                  setMyQuoteText('');
                  setTimeout(() => setRegisterToast(null), 2000);
                } catch (err) {
                  const msg = err instanceof Error ? err.message : '등록 실패';
                  setRegisterToast(msg);
                  setTimeout(() => setRegisterToast(null), 3000);
                } finally {
                  setSubmittingMyQuote(false);
                }
              }}
              disabled={submittingMyQuote || myQuoteText.trim().length < 3}
              className="w-full mt-3 py-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-sm disabled:opacity-50 active:scale-[0.98] inline-flex items-center justify-center gap-1.5"
            >
              {submittingMyQuote ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                  등록 중…
                </>
              ) : (
                <>
                  <Check size={16} /> 한 줄 일기 등록
                </>
              )}
            </button>
          </div>
        </div>
      )}

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
