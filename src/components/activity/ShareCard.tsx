'use client';

import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Share2, X, ImagePlus, Check, Shuffle, Video, ImageIcon } from 'lucide-react';
import { isNativeApp } from '@/lib/health-sync';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/components/UserDataProvider';
import { fetchRandomQuote, isFallbackQuote, type DailyQuote } from '@/lib/quotes-data';
import { detectRegionLabel } from '@/lib/region-from-gps';
import { captureCanvasAnimation } from '@/lib/canvas-to-video';
import { getSupabase } from '@/lib/supabase';
import { track } from '@/lib/analytics';
import { fetchActivityRoute } from '@/lib/routinist-data';
import { createUserQuote } from '@/lib/user-quotes';
import AppToast from '@/components/AppToast';
import type { Activity } from '@/types';

interface ShareCardProps {
  activity: Activity;
  displayName: string;
  onClose: () => void;
  /** true 면 러닝사진 등록 버튼을 숨김 (캘린더처럼 바깥에서 직접 등록 모달을 띄우는 경우) */
  hideRegister?: boolean;
  /** 등록 성공 시 호출 — 리스트 새로고침용 */
  onRegistered?: () => void;
  /** build 209~213: 주간/월간 모드 — 일간 layout 그대로 + 지도/hero KM 만 기간 누적값으로 교체. */
  periodOverrides?: {
    extraRoutes?: Array<Array<[number, number]>>;
    periodWord?: string;
    highlightDays?: number[];
    horizontalTotalKm?: number;
    bottomRankLine?: string | null;
  };
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
  /** build 167 #3: 거리 표시 카운트업. 미지정 시 activity.distance_km 그대로. */
  kmDisplay?: number,
  /** build 209~213: 주간/월간 ShareCard 가 일간과 동일 폼을 쓰기 위한 override. */
  periodOverrides?: {
    extraRoutes?: Array<Array<[number, number]>>;
    periodWord?: string;
    highlightDays?: number[];
    horizontalTotalKm?: number;
    bottomRankLine?: string | null;
  },
) {
  // build 205 #11: 막대 그래프 애니메이션 진행도. routeProgress 와 동일 timeline (0~1).
  // 일간 카드: 오늘 막대 / 가로 누적바가 0 → 목표 까지 차오른 후 bounce → 원래 색.
  // PeriodShareCard (주간/월간) 는 별도 캔버스라 영향 없음.
  const barProgress = routeProgress;
  // easeOutCubic + elastic bounce (period-share-canvas.ts 와 동일 공식)
  const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
  const easeOutElastic = (t: number) => {
    if (t <= 0) return 0; if (t >= 1) return 1;
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  };
  // build 215 #5: 막대 애니메이션 timeline 재조정 — km hero 와 동기화 + staggered.
  // 사용자 신고: 막대가 km 보다 일찍 끝남 + 모든 막대 동시 차오름 (주간 동시 버그).
  //
  // Phase A (0 ~ 0.90): 막대 staggered 차오름. 첫 highlight 일이 0, 마지막 일이 (0.90 - WINDOW)
  //   각 막대 fillT 는 [0, WINDOW] 안에서 차오름 (overlap 됨).
  // Phase B (0.90 ~ 0.96): 전체 bounce (synchronized).
  // Phase C (0.92 ~ 1.0): emerald → 원래 색 transition. km hero 가 routeProgress=1 에서 풀 도달과 일치.
  //
  // 디폴트 (highlightDays 없을 때) fillT — 단일 막대 (일간 카드 today) 용 fallback 으로 유지.
  const fillT = easeOutCubic(Math.min(1, barProgress / 0.90));
  const bounceWindow = Math.max(0, Math.min(1, (barProgress - 0.90) / 0.06));
  const bouncePx = bounceWindow > 0 && bounceWindow < 1 ? (1 - easeOutElastic(bounceWindow)) * 18 : 0;
  const colorMixT = Math.max(0, Math.min(1, (barProgress - 0.92) / 0.08));
  // staggered fillT 계산 — 각 highlighted 일이 자기 차례에 차오름
  const computeStaggeredFillT = (idx: number, total: number): number => {
    if (total <= 1) return fillT;
    const FILL_WINDOW = 0.22;            // 각 막대가 차오르는 시간 (전체 progress 의 22%)
    const SPREAD = 0.90 - FILL_WINDOW;   // 첫 막대 0, 마지막 막대 0.68 부터 시작
    const start = (idx / (total - 1)) * SPREAD;
    return easeOutCubic(Math.max(0, Math.min(1, (barProgress - start) / FILL_WINDOW)));
  };
  const lerpHex = (h1: string, h2: string, t: number) => {
    const p = (h: string) => {
      const c = h.replace('#', '');
      return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)] as const;
    };
    const [r1, g1, b1] = p(h1); const [r2, g2, b2] = p(h2);
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return `rgb(${r},${g},${b})`;
  };
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
  // build 209 #2/#3: periodOverrides.extraRoutes 있으면 주간/월간 모드 — 여러 경로 합성.
  const extraRoutes = periodOverrides?.extraRoutes;
  const hasExtraRoutes = Array.isArray(extraRoutes) && extraRoutes.length > 0;
  const hasRoute = hasExtraRoutes || activity.route_data?.coordinates?.length;
  if (hasExtraRoutes) {
    // build 214 #5: 주간/월간 카드 멀티 국가 분할 렌더링.
    // 같은 국가/지역끼리 cluster (centroid 5도 ≈ 555km 이내 같은 cluster).
    // 정적 (routeProgress=1): 가장 km 많은 cluster 만 표시 + 다른 cluster 는 하단 footer 라인 "+N개국 X.Xkm".
    // 영상 (routeProgress<1): timeline 을 cluster 별 segment 로 분할, fade 전환.
    type Cluster = {
      routes: Array<Array<[number, number]>>;
      totalM: number;
      center: [number, number];
      bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number };
    };
    const routeDistM = (route: Array<[number, number]>): number => {
      let m = 0;
      for (let i = 1; i < route.length; i++) {
        const [lng1, lat1] = route[i - 1];
        const [lng2, lat2] = route[i];
        const meanLat = (lat1 + lat2) / 2 * Math.PI / 180;
        const dx = (lng2 - lng1) * Math.cos(meanLat);
        const dy = lat2 - lat1;
        m += Math.hypot(dx, dy);
      }
      return m;
    };
    const CLUSTER_THRESHOLD_DEG = 5;
    const clusters: Cluster[] = [];
    for (const route of extraRoutes!) {
      if (route.length < 2) continue;
      const first = route[0];
      const m = routeDistM(route);
      let attached: Cluster | null = null;
      for (const c of clusters) {
        if (Math.abs(c.center[0] - first[0]) < CLUSTER_THRESHOLD_DEG &&
            Math.abs(c.center[1] - first[1]) < CLUSTER_THRESHOLD_DEG) {
          attached = c; break;
        }
      }
      if (!attached) {
        clusters.push({
          routes: [route], totalM: m,
          center: [first[0], first[1]],
          bbox: { minLat: first[1], maxLat: first[1], minLng: first[0], maxLng: first[0] },
        });
        attached = clusters[clusters.length - 1];
      } else {
        attached.routes.push(route);
        attached.totalM += m;
      }
      // bbox + center 업데이트
      for (const [lng, lat] of route) {
        if (lat < attached.bbox.minLat) attached.bbox.minLat = lat;
        if (lat > attached.bbox.maxLat) attached.bbox.maxLat = lat;
        if (lng < attached.bbox.minLng) attached.bbox.minLng = lng;
        if (lng > attached.bbox.maxLng) attached.bbox.maxLng = lng;
      }
      attached.center = [
        (attached.bbox.minLng + attached.bbox.maxLng) / 2,
        (attached.bbox.minLat + attached.bbox.maxLat) / 2,
      ];
    }
    // 큰 cluster 순으로 정렬
    clusters.sort((a, b) => b.totalM - a.totalM);

    // 영상 모드면 timeline 분할, 정적 모드면 largest 만.
    const isAnimating = routeProgress < 1;
    let activeClusterIdx = 0;
    let localProgress = 1;
    if (isAnimating && clusters.length > 0) {
      const segLen = 1 / clusters.length;
      activeClusterIdx = Math.min(clusters.length - 1, Math.floor(routeProgress / segLen));
      localProgress = Math.min(1, Math.max(0, (routeProgress - activeClusterIdx * segLen) / segLen));
    }
    const activeCluster = clusters[activeClusterIdx];

    if (activeCluster) {
      const padding = 120;
      const mapW = W - padding * 2;
      const mapH = 480;
      const mapY = 300;
      const { minLat, maxLat, minLng, maxLng } = activeCluster.bbox;
      const dLng = (maxLng - minLng) || 0.001;
      const dLat = (maxLat - minLat) || 0.001;
      const scale = Math.min(mapW / dLng, mapH / dLat);
      const offsetX = padding + (mapW - dLng * scale) / 2;
      const offsetY = mapY + (mapH - dLat * scale) / 2;

      // fade in/out (영상 모드일 때 segment 경계에서 0.1 까지 페이드)
      let segmentAlpha = 1;
      if (isAnimating && clusters.length > 1) {
        const segLen = 1 / clusters.length;
        const segLocal = (routeProgress - activeClusterIdx * segLen) / segLen;
        if (segLocal < 0.1) segmentAlpha = segLocal / 0.1;
        else if (segLocal > 0.9 && activeClusterIdx < clusters.length - 1) segmentAlpha = (1 - segLocal) / 0.1;
      }
      ctx.globalAlpha = segmentAlpha;

      // 1) 이 cluster 의 모든 경로 그림자
      for (const route of activeCluster.routes) {
        if (route.length < 2) continue;
        ctx.beginPath();
        route.forEach(([lng, lat], i) => {
          const x = offsetX + (lng - minLng) * scale;
          const y = offsetY + mapH - (lat - minLat) * scale;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = bgImage ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 14;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      }

      // 2) timeline 누적 거리 — 이 cluster 내 경로만
      const routeCums: number[][] = [];
      let grandTotal = 0;
      const offsets: number[] = [];
      for (const route of activeCluster.routes) {
        offsets.push(grandTotal);
        const cum: number[] = new Array(route.length).fill(0);
        for (let i = 1; i < route.length; i++) {
          const [lng1, lat1] = route[i - 1];
          const [lng2, lat2] = route[i];
          const meanLat = (lat1 + lat2) / 2 * Math.PI / 180;
          const dx = (lng2 - lng1) * Math.cos(meanLat);
          const dy = lat2 - lat1;
          cum[i] = cum[i - 1] + Math.hypot(dx, dy);
        }
        routeCums.push(cum);
        grandTotal += cum[cum.length - 1] || 0;
      }
      // 정적 모드면 항상 100%, 영상 모드면 localProgress
      const targetM = grandTotal * (isAnimating ? localProgress : 1);

      // 3) emerald 솔리드 progressive
      let lastDrawnX: number | null = null, lastDrawnY: number | null = null;
      for (let ri = 0; ri < activeCluster.routes.length; ri++) {
        const route = activeCluster.routes[ri];
        if (route.length < 2) continue;
        const cum = routeCums[ri];
        const routeStartM = offsets[ri];
        const routeEndM = routeStartM + cum[cum.length - 1];
        if (targetM <= routeStartM) continue;
        const localTarget = Math.min(targetM, routeEndM) - routeStartM;
        let cutIdx = route.length;
        for (let i = 0; i < cum.length; i++) {
          if (cum[i] >= localTarget) { cutIdx = Math.max(2, i + 1); break; }
        }
        const sliced: [number, number][] = route.slice(0, cutIdx).map(([lng, lat]) => [lng, lat]);
        if (cutIdx < route.length && cutIdx > 0 && localTarget < routeEndM - routeStartM) {
          const prevM = cum[cutIdx - 1];
          const segM = cum[cutIdx] - prevM;
          const ratio = segM > 0 ? Math.min(1, Math.max(0, (localTarget - prevM) / segM)) : 0;
          const [lng1, lat1] = route[cutIdx - 1];
          const [lng2, lat2] = route[cutIdx];
          sliced[sliced.length - 1] = [
            lng1 + (lng2 - lng1) * ratio,
            lat1 + (lat2 - lat1) * ratio,
          ];
        }
        ctx.beginPath();
        sliced.forEach(([lng, lat], i) => {
          const x = offsetX + (lng - minLng) * scale;
          const y = offsetY + mapH - (lat - minLat) * scale;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = bgImage ? '#ffffff' : theme.routeColor;
        ctx.lineWidth = 7;
        ctx.stroke();
        const last = sliced[sliced.length - 1];
        lastDrawnX = offsetX + (last[0] - minLng) * scale;
        lastDrawnY = offsetY + mapH - (last[1] - minLat) * scale;
      }

      ctx.globalAlpha = 1;

      // 4) 멀티 cluster 안내 — 정적 모드 + cluster > 1 일 때 footer 위에 "+N국 Xkm 더"
      if (!isAnimating && clusters.length > 1) {
        const otherCount = clusters.length - 1;
        let otherKm = 0;
        for (let i = 1; i < clusters.length; i++) otherKm += clusters[i].totalM / 1000;
        ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillStyle = bgImage ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.75)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        const text = `🌍 +${otherCount}개 지역 ${otherKm.toFixed(1)}km 더`;
        ctx.fillText(text, W / 2, mapY + mapH + 28);
      }

      // 5) 영상 모드 + 멀티 cluster 일 때 현재 cluster 번호 표시 (1/3 등)
      if (isAnimating && clusters.length > 1) {
        ctx.font = 'bold 22px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillStyle = bgImage ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.6)';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(`${activeClusterIdx + 1} / ${clusters.length}`, W - padding, mapY + 32);
        ctx.textAlign = 'center';
      }

      // 6) 펄스 그린 dot — 영상 모드, 마지막 그려진 점.
      if (lastDrawnX !== null && lastDrawnY !== null && isAnimating) {
        const pulse = 1 + 0.2 * Math.sin(routeProgress * Math.PI * 6);
        ctx.fillStyle = '#22C55E';
        ctx.beginPath(); ctx.arc(lastDrawnX, lastDrawnY, 12 * pulse, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.stroke();
      } else if (lastDrawnX !== null && lastDrawnY !== null) {
        // 완료 — 흰 dot
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(lastDrawnX, lastDrawnY, 12, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#1f2937';
        ctx.lineWidth = 4;
        ctx.stroke();
      }

      // 7) activeCluster 첫 경로의 시작점에 빨간 핀 + 도시명 (#1 패턴)
      const firstRoute = activeCluster.routes[0];
      if (firstRoute && firstRoute.length >= 1) {
        const [sLng, sLat] = firstRoute[0];
        const sx = offsetX + (sLng - minLng) * scale;
        const sy = offsetY + mapH - (sLat - minLat) * scale;
        const pinR = 18, pinCenterY = sy - 30;
        ctx.fillStyle = '#EF4444';
        ctx.beginPath();
        ctx.arc(sx, pinCenterY, pinR, Math.PI, 0, false);
        ctx.lineTo(sx + 6, pinCenterY + 10);
        ctx.lineTo(sx, sy);
        ctx.lineTo(sx - 6, pinCenterY + 10);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(sx, pinCenterY, 7, 0, Math.PI * 2); ctx.fill();
        if (regionLabel) {
          ctx.font = 'bold 26px -apple-system, BlinkMacSystemFont, sans-serif';
          const cityText = regionLabel.split(' · ')[0];
          const cityW = ctx.measureText(cityText).width;
          const padX = 14, pillH = 38;
          const wantRight = sx + 28 + cityW + padX * 2 + padding < W;
          const lx = wantRight ? sx + 24 : sx - 24 - cityW - padX * 2;
          const ly = pinCenterY - pillH / 2;
          ctx.fillStyle = 'rgba(0,0,0,0.65)';
          ctx.beginPath();
          ctx.roundRect(lx, ly, cityW + padX * 2, pillH, 19);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(cityText, lx + padX, ly + pillH / 2 + 1);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'alphabetic';
        }
      }
    }
    // 등수 라인 하단 표시 — build 213 #5: 주간/월간 카드는 data.rankLine (period 랭킹) 우선.
    // 폴백: regionLabel 의 ` · ` 뒤쪽 (오늘 랭킹).
    const rankPart = periodOverrides?.bottomRankLine
      ?? (regionLabel && regionLabel.includes(' · ')
        ? regionLabel.split(' · ').slice(1).join(' · ')
        : null);
    if (rankPart) {
      ctx.font = 'bold 32px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillStyle = bgImage ? '#ffffff' : (theme.accent || '#10b981');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(rankPart, W / 2, H - 220);
    }
  } else if (hasRoute) {
    const coordsAll = activity.route_data!.coordinates;
    const lats = coordsAll.map(c => c[1]);
    const lngs = coordsAll.map(c => c[0]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);

    const padding = 120;
    const mapW = W - padding * 2;
    const mapH = 480;
    const mapY = 300;

    const scaleX = mapW / (maxLng - minLng || 0.001);
    const scaleY = mapH / (maxLat - minLat || 0.001);
    const scale = Math.min(scaleX, scaleY);

    const offsetX = padding + (mapW - (maxLng - minLng) * scale) / 2;
    const offsetY = mapY + (mapH - (maxLat - minLat) * scale) / 2;

    // 애니메이션: routeProgress 비율만큼 슬라이스 (최소 2개 필요).
    // build 151: 좌표에 timestamp(4번째 슬롯)가 있으면 **시간 기반** progress —
    //  → 빨리 달린 구간은 영상에서 빠르게 지나가고, 느린 구간은 그 자리에 좀 머무름.
    // build 150 폴백: timestamp 없으면 누적 거리 기반 (이전 회귀 fix 유지).
    // 어느 쪽이든 좌표 개수 단순 비례보다 실제 이동에 더 충실.
    const progress01 = Math.min(1, Math.max(0, routeProgress));
    const firstTs = coordsAll[0][3];
    const lastTs = coordsAll[coordsAll.length - 1][3];
    const hasTimestamps = typeof firstTs === 'number' && typeof lastTs === 'number' && lastTs > firstTs;

    const cum: number[] = new Array(coordsAll.length);
    cum[0] = 0;
    if (hasTimestamps) {
      const t0 = firstTs as number;
      for (let i = 1; i < coordsAll.length; i++) {
        cum[i] = (coordsAll[i][3] as number) - t0;
      }
    } else {
      for (let i = 1; i < coordsAll.length; i++) {
        const [lng1, lat1] = coordsAll[i - 1];
        const [lng2, lat2] = coordsAll[i];
        const meanLat = (lat1 + lat2) / 2 * Math.PI / 180;
        const dx = (lng2 - lng1) * Math.cos(meanLat);
        const dy = lat2 - lat1;
        cum[i] = cum[i - 1] + Math.hypot(dx, dy);
      }
    }
    const totalM = cum[cum.length - 1] || 1;
    const targetM = totalM * progress01;
    let cutIdx = coordsAll.length;
    for (let i = 0; i < cum.length; i++) {
      if (cum[i] >= targetM) { cutIdx = Math.max(2, i + 1); break; }
    }
    const coords: [number, number, number?, number?][] = coordsAll.slice(0, cutIdx);
    // 마지막 점 보간 — 진행이 부드럽게 끊기도록
    if (progress01 < 1 && cutIdx < coordsAll.length && cutIdx > 0) {
      const prevM = cum[cutIdx - 1];
      const segM = cum[cutIdx] - prevM;
      const ratio = segM > 0 ? Math.min(1, Math.max(0, (targetM - prevM) / segM)) : 0;
      const [lng1, lat1] = coordsAll[cutIdx - 1];
      const [lng2, lat2] = coordsAll[cutIdx];
      coords[coords.length - 1] = [
        lng1 + (lng2 - lng1) * ratio,
        lat1 + (lat2 - lat1) * ratio,
      ];
    }

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

    // 시작점 — build 209 #1: 초록 dot → 빨간 핀(A) + 도시명 라벨 옆에 표시.
    // 핀 모양: 위가 둥글고 아래가 뾰족한 teardrop. 사용자 신고 "출발점도 초록이라 어디부터인지 헷갈림" 직접 해결.
    const [sx, sy] = [offsetX + (coordsAll[0][0] - minLng) * scale, offsetY + mapH - (coordsAll[0][1] - minLat) * scale];
    // teardrop pin: 위 원 + 아래 삼각형
    const pinR = 18;
    const pinTipY = sy;                     // 핀 끝(좌표)은 실제 시작점
    const pinCenterY = sy - 30;             // 원 중심은 위쪽 30px
    ctx.fillStyle = '#EF4444';
    ctx.beginPath();
    ctx.arc(W / 2 < sx ? sx : sx, pinCenterY, pinR, Math.PI, 0, false);
    ctx.lineTo(sx + 6, pinCenterY + 10);
    ctx.lineTo(sx, pinTipY);
    ctx.lineTo(sx - 6, pinCenterY + 10);
    ctx.closePath();
    ctx.fill();
    // 핀 안 흰 원
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(sx, pinCenterY, 7, 0, Math.PI * 2); ctx.fill();
    // 핀 테두리
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(sx, pinCenterY, pinR, Math.PI, 0, false);
    ctx.lineTo(sx + 6, pinCenterY + 10);
    ctx.lineTo(sx, pinTipY);
    ctx.lineTo(sx - 6, pinCenterY + 10);
    ctx.closePath();
    ctx.stroke();

    // 도시명 라벨 — 핀 우측 또는 좌측 (지도 가장자리 회피)
    if (regionLabel) {
      ctx.font = 'bold 26px -apple-system, BlinkMacSystemFont, sans-serif';
      const cityText = regionLabel.split(' · ')[0];   // "서울 강남 · 1위" → "서울 강남"
      const cityW = ctx.measureText(cityText).width;
      const padX = 14, pillH = 38;
      // 핀 우측에 둘 공간 부족하면 왼쪽
      const wantRight = sx + 28 + cityW + padX * 2 + padding < W;
      const lx = wantRight ? sx + 24 : sx - 24 - cityW - padX * 2;
      const ly = pinCenterY - pillH / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.beginPath();
      ctx.roundRect(lx, ly, cityW + padX * 2, pillH, 19);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(cityText, lx + padX, ly + pillH / 2 + 1);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
    }

    // 끝점 — 라인이 종착하는 위치 (애니메이션 중에는 현재 진행점이 보임)
    const lastCoord = coords[coords.length - 1];
    const [ex, ey] = [offsetX + (lastCoord[0] - minLng) * scale, offsetY + mapH - (lastCoord[1] - minLat) * scale];
    if (routeProgress >= 1) {
      // 끝점: 작은 흰 원 + 검정 테두리 — 시작 핀과 시각적 구분
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(ex, ey, 12, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 4;
      ctx.stroke();
    } else {
      const pulse = 1 + 0.2 * Math.sin(routeProgress * Math.PI * 6);
      ctx.fillStyle = '#22C55E';
      ctx.beginPath(); ctx.arc(ex, ey, 12 * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.stroke();
    }
  }
  // build 209 #1: 등수 suffix 는 카드 최하단 footer 위로 이동 (지도 위 alarm pill 제거).
  // regionLabel 에 "서울 강남 · 1위" 형식이면 rank 부분만 추출해 별도 표시.
  if (regionLabel && regionLabel.includes(' · ')) {
    const rankPart = regionLabel.split(' · ').slice(1).join(' · ');
    if (rankPart) {
      ctx.font = 'bold 32px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillStyle = bgImage ? '#ffffff' : (theme.accent || '#10b981');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(rankPart, W / 2, H - 220);
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

  // 거리 (메인). 최종 값의 dot 위치를 화면 중앙 기준 offset 으로 미리 계산 → 카운트업
  // 중에도 dot 좌표 고정. 정수/소수 자릿수가 동일하면 흔들림 0, 자릿수 변화 시에도
  // 한쪽 정렬이라 안정. 최종 텍스트 전체가 W/2 에 정확히 중심 정렬됨 (build 178 fix).
  const distY = hasRoute ? 950 : H * 0.36;
  const kmFont = 'bold 180px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.font = kmFont;
  ctx.fillStyle = mainColor;
  const kmValue = typeof kmDisplay === 'number' ? kmDisplay : activity.distance_km;
  const kmText = kmValue.toFixed(2);
  const dotIdx = kmText.indexOf('.');
  const intPart = dotIdx >= 0 ? kmText.slice(0, dotIdx) : kmText;
  const fracPart = dotIdx >= 0 ? kmText.slice(dotIdx) : '';
  const finalKmText = activity.distance_km.toFixed(2);
  const finalDotIdx = finalKmText.indexOf('.');
  const finalIntPart = finalDotIdx >= 0 ? finalKmText.slice(0, finalDotIdx) : finalKmText;
  const finalTotalWidth = ctx.measureText(finalKmText).width;
  const finalIntWidth = ctx.measureText(finalIntPart).width;
  const dotX = W / 2 - finalTotalWidth / 2 + finalIntWidth;
  ctx.textAlign = 'right';
  ctx.fillText(intPart, dotX, distY);
  ctx.textAlign = 'left';
  ctx.fillText(fracPart, dotX, distY);
  ctx.textAlign = 'center';

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
  // build 141: 두 막대 덩어리를 더 아래로 + 위 stats4 와 분리.
  // build 150: 사용자 피드백 — 세로/가로 막대가 너무 붙어 있음. goalBarTop 1530 → 1580 (gap 90).
  // chartTop=1380, chartH=110, 끝 1490. goalBarTop=1580 → 두 막대 사이 90px 여유.
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

    // build 215 #5-2: staggered 막대 애니메이션. 첫 일(highlight 중 가장 작은 day)부터 순차 차오름.
    // 이전: 모든 highlighted 막대가 동일 fillT 로 동시 차오름 (사용자 신고: 주간 동시 버그).
    const highlightSet = periodOverrides?.highlightDays
      ? new Set(periodOverrides.highlightDays)
      : null;
    // highlight 일들을 day 오름차순으로 정렬한 인덱스 맵 (1일 → idx 0, 다음 일 → idx 1, ...)
    const highlightIdxMap = (() => {
      if (!highlightSet) return null;
      const sorted = Array.from(highlightSet).sort((a, b) => a - b);
      const m = new Map<number, number>();
      sorted.forEach((d, i) => m.set(d, i));
      return { map: m, total: sorted.length };
    })();
    for (let day = 1; day <= daysInMonth; day++) {
      const km = dailyKm.get(day) ?? 0;
      const x = chartPadX + (day - 1) * (barWidth + 4);
      const isToday = day === todayDay;
      const isHighlighted = highlightSet ? highlightSet.has(day) : isToday;
      const targetH = (km / maxDay) * chartH;

      if (isHighlighted && km > 0) {
        // 자기 차례 fillT (staggered)
        const idx = highlightIdxMap?.map.get(day) ?? 0;
        const total = highlightIdxMap?.total ?? 1;
        const myFillT = computeStaggeredFillT(idx, total);
        const animH = targetH * myFillT;
        const fillEmerald = '#10b981';
        const todayBaseHex = onPhoto ? '#ffffff' : (accentColor.startsWith('#') ? accentColor : '#10b981');
        const animColor = colorMixT >= 1
          ? barFillToday
          : lerpHex(fillEmerald, todayBaseHex, colorMixT);
        ctx.fillStyle = animColor;
        const barH = Math.max(animH, 3);
        // bounce 는 myFillT 가 1 도달 후 발생 (마지막에 도착한 막대도 bounce 받음)
        const myBouncePx = myFillT >= 1 ? bouncePx : 0;
        const barTop = chartTop + chartH - barH - myBouncePx;
        ctx.fillRect(x, barTop, barWidth, barH);
      } else {
        ctx.fillStyle = km > 0 ? barFillOther : barFillEmpty;
        const barH = Math.max(targetH, 3);
        const barTop = chartTop + chartH - barH;
        ctx.fillRect(x, barTop, barWidth, barH);
      }
    }

    // build 136: "이달 N회" 라벨 대신 마지막 달린 막대 아래에 N 숫자만.
    // 짧고 직관적 — 막대그래프 컨텍스트 안에서 즉시 이해.
    if (monthRunCount > 0 && lastRunDay > 0) {
      const x = chartPadX + (lastRunDay - 1) * (barWidth + 4) + barWidth / 2;
      const labelY = chartTop + chartH + 32;
      ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillStyle = bgImage ? 'rgba(255,255,255,0.95)' : mainColor;
      ctx.textAlign = 'center';
      ctx.fillText(`${monthRunCount}회`, x, labelY);
    }
  }

  // (2) 가로 progress bar — 위 막대(1380+110=1490) 끝과 90px 여유 (build 150 피드백).
  // build 205 #11: 어제까지 누적 → 오늘 누적 까지 차오름 + bounce + 컬러 emerald → 흰색.
  // build 210 #3/#4: period 모드면 horizontalTotalKm 만큼이 emerald (주간=주간합, 월간=월간합).
  if (monthlyGoalKm && monthlyGoalKm > 0 && monthSum > 0) {
    const goalBarTop = 1580;
    const goalBarH = 14;
    const goalBarPadX = 100;
    const goalBarW = W - goalBarPadX * 2;
    const animatingKm = periodOverrides?.horizontalTotalKm ?? (dailyKm.get(todayDay) ?? 0);
    const baselineSum = Math.max(0, monthSum - animatingKm);
    const baselineProgress = Math.min(1, baselineSum / monthlyGoalKm);
    const finalProgress = Math.min(1, monthSum / monthlyGoalKm);
    // 차오름: baseline → final 사이를 fillT 비율로 보간
    const progress = baselineProgress + (finalProgress - baselineProgress) * fillT;
    const radius = goalBarH / 2;

    // 트랙 (배경)
    ctx.fillStyle = bgImage ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.20)';
    ctx.beginPath();
    ctx.roundRect(goalBarPadX, goalBarTop, goalBarW, goalBarH, radius);
    ctx.fill();

    // build 207 #10: 어제까지 누적은 항상 흰색 baseline, 오늘 추가분만 emerald 차오름 → bounce → 완료시 흰색.
    // (1) 어제까지 누적 = 흰색 (항상 표시)
    const baselineW = Math.max(goalBarH * 0, goalBarW * baselineProgress);
    if (baselineW > 0) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(goalBarPadX, goalBarTop, Math.max(goalBarH, baselineW), goalBarH, radius);
      ctx.fill();
    }
    // (2) 오늘 추가분 = baseline → today. 0~0.85 emerald, 0.85~1 흰색
    const baseFillW = Math.max(goalBarH, goalBarW * progress);
    const fillW = Math.min(goalBarW, baseFillW + (bouncePx > 0 ? bouncePx * 0.6 : 0));
    if (fillW > baselineW + 0.5) {
      const finalFillHex = '#ffffff';
      const animFillColor = colorMixT >= 1 ? finalFillHex : lerpHex('#10b981', finalFillHex, colorMixT);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(goalBarPadX, goalBarTop, fillW, goalBarH, radius);
      ctx.clip();
      ctx.fillStyle = animFillColor;
      ctx.fillRect(goalBarPadX + baselineW, goalBarTop, fillW - baselineW, goalBarH);
      ctx.restore();
    }

    // build 170 #3: 라벨 겹침 fix — 두 라벨이 같은 라인에 있어 progress 가 100% 가까울 때
    // 5/30 + 199.9/200km 가 겹침. 5/21 라벨은 막대 **위**(작게), 누적 km 는 막대 **아래** 우측.
    const todayMarkerX = goalBarPadX + fillW;
    const topLabelY = goalBarTop - 12;        // 막대 바로 위
    const bottomLabelY = goalBarTop + goalBarH + 38;

    // 위: 오늘 마커 ("5/21") — 진행 끝점 위에 작게
    ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = bgImage ? '#ffffff' : accentColor;
    ctx.textAlign = 'center';
    // 끝점이 막대 시작·끝 너무 가까우면 안쪽으로 클램프 (라벨 잘림 방지)
    const minX = goalBarPadX + 30;
    const maxX = goalBarPadX + goalBarW - 30;
    const clampedX = Math.min(maxX, Math.max(minX, todayMarkerX));
    ctx.fillText(`${activityMonth + 1}/${todayDay}`, clampedX, topLabelY);

    // 아래: 누적/목표 — 우측 끝, 굵게 (메인 정보)
    ctx.font = 'bold 32px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = bgImage ? 'rgba(255,255,255,0.95)' : mainColor;
    ctx.textAlign = 'right';
    ctx.fillText(`${monthSum.toFixed(1)} / ${monthlyGoalKm.toFixed(0)}km`, goalBarPadX + goalBarW, bottomLabelY);
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

export default function ShareCard({ activity: baseActivity, displayName, onClose, hideRegister, onRegistered, periodOverrides }: ShareCardProps) {
  const { user, profile } = useAuth();
  const { activities, goals } = useUserData();
  // build 167 #1: useUserData() activities 는 route_data 없는 lite. ShareCard 진입 시 단건 lazy fetch.
  const [routeData, setRouteData] = useState<Activity['route_data']>(baseActivity.route_data ?? null);
  const activity = useMemo<Activity>(() => ({ ...baseActivity, route_data: routeData }), [baseActivity, routeData]);
  useEffect(() => {
    if (routeData) return;
    let cancelled = false;
    fetchActivityRoute(baseActivity.id).then(r => {
      if (!cancelled && r?.route_data) setRouteData(r.route_data);
    }).catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, [baseActivity.id, routeData]);

  // 활동 월의 목표(km) — 가로 progress bar 에 사용. 없으면 undefined → bar 미표시.
  const monthlyGoalKm = (() => {
    const d = new Date(activity.activity_date);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const g = goals?.find(g => g.year === y && g.month === m);
    return g?.goal_km ?? undefined;
  })();

  // build 170 #4: MP4 카운트업 페이스 연동.
  // 시간 progress (0→1) 를 실제 그 시점의 누적 거리 비율로 매핑.
  // → 빠르게 달린 구간엔 km 숫자가 빠르게 증가, 느린/멈춘 구간엔 천천히.
  // route_data.coordinates 의 4번째 슬롯(timestamp ms) 활용. 없으면 선형 fallback.
  const paceMap = useMemo<{ timeR: number; distR: number }[] | null>(() => {
    const coords = (routeData?.coordinates ?? []) as [number, number, number?, number?][];
    if (coords.length < 2) return null;
    const first = coords[0][3];
    const last = coords[coords.length - 1][3];
    if (typeof first !== 'number' || typeof last !== 'number' || last <= first) return null;
    const totalT = last - first;
    let cumD = 0;
    const dists: number[] = [0];
    for (let i = 1; i < coords.length; i++) {
      const [lng1, lat1] = coords[i - 1];
      const [lng2, lat2] = coords[i];
      const meanLat = ((lat1 + lat2) / 2) * Math.PI / 180;
      const dx = (lng2 - lng1) * Math.cos(meanLat) * 111320;
      const dy = (lat2 - lat1) * 110540;
      cumD += Math.hypot(dx, dy);
      dists.push(cumD);
    }
    const totalD = cumD || 1;
    return coords.map((c, i) => ({
      timeR: ((c[3] as number) - first) / totalT,
      distR: dists[i] / totalD,
    }));
  }, [routeData]);

  const timeToDistRatio = useCallback((timeR: number) => {
    if (!paceMap) return timeR;
    const clamped = Math.min(1, Math.max(0, timeR));
    for (let i = 1; i < paceMap.length; i++) {
      if (paceMap[i].timeR >= clamped) {
        const prev = paceMap[i - 1];
        const cur = paceMap[i];
        const segT = cur.timeR - prev.timeR;
        const ratio = segT > 0 ? (clamped - prev.timeR) / segT : 0;
        return prev.distR + (cur.distR - prev.distR) * ratio;
      }
    }
    return 1;
  }, [paceMap]);
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
  const regionLabelBase = (() => {
    const first = activity.route_data?.coordinates?.[0] as [number, number] | undefined;
    return detectRegionLabel(first ?? null, profile);
  })();

  // build 196: 일간 카드에 옵션 D 랭킹 suffix 추가. find_hero_rank time_axis='today' 재활용.
  // 모수 ≤3 친근 메시지 ("1위 ✨"), 4 이상 사실 표기 ("8위/50명"). 실패하면 region 만 표시.
  const [rankSuffix, setRankSuffix] = useState<string | null>(null);
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data } = await supabase.rpc('find_hero_rank', {
          target_user_id: user.id, time_axis: 'today',
        });
        if (cancelled) return;
        const row = Array.isArray(data) ? data[0] : null;
        if (!row) return;
        const total = row.total_in_scope ?? 0;
        const rank = row.rank_position ?? 0;
        if (rank === 0 || total === 0) return;
        if (total <= 3) setRankSuffix(rank === 1 ? '1위 ✨' : `${rank}위`);
        else setRankSuffix(`${rank}위 / ${total}명`);
      } catch { /* 랭킹 실패해도 카드 동작에 영향 X */ }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const regionLabel = regionLabelBase && rankSuffix
    ? `${regionLabelBase} · ${rankSuffix}`
    : regionLabelBase;
  // 러닝사진 등록 — 디폴트 ON (체크 해제하면 캘린더만 저장).
  // 캘린더 저장은 항상 자동 (UI 표시 X — 사용자 의도).
  const [registerToGallery, setRegisterToGallery] = useState(true);
  // build 150: 한 줄 메시지 직접 입력. 비어있으면 명언(placeholder) 사용, 입력 있으면 카드에 그 텍스트.
  // build 167 #4: 사용자가 직접 타이핑한 customText 는 자동으로 quotes 테이블 (러너 한 줄) 에도 저장.
  //   디폴트 ON. 일회용 메시지면 체크 해제 가능. 랜덤 명언은 저장 안 함.
  const [customText, setCustomText] = useState('');
  const [saveToQuotes, setSaveToQuotes] = useState(true);

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

  // 카드/캡션에 실제로 들어가는 quote — customText 있으면 그것, 없으면 fetched quote.
  const effectiveQuote = useMemo<DailyQuote | null>(() => {
    const t = customText.trim();
    if (t) {
      return {
        id: `custom-${activity.id}`,
        lang: 'ko_self',
        category: 'user',
        text: t,
        author: displayName,
        like_count: 0,
        liked_by_me: false,
      };
    }
    return quote;
  }, [customText, quote, displayName, activity.id]);

  // 사용자 ID label — 이름(한글) 노출 방지. 영문/숫자 prefix 추출, fallback email prefix.
  const userIdLabel = (() => {
    const m = displayName?.match(/^[a-zA-Z0-9_.]+/);
    if (m && m[0].length >= 2) return m[0];
    const emailPrefix = user?.email?.split('@')[0];
    return emailPrefix ?? displayName ?? 'runner';
  })();

  const generate = useCallback(() => {
    if (!canvasRef.current) return;
    drawCard(canvasRef.current, activity, displayName, THEMES[themeIdx], bgImage, activities, userIdLabel, effectiveQuote, monthlyGoalKm, regionLabel ?? undefined, 1, undefined, periodOverrides);
  }, [activity, displayName, themeIdx, bgImage, activities, userIdLabel, effectiveQuote, monthlyGoalKm, regionLabel]);

  useEffect(() => { generate(); }, [generate]);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => setBgImage(img);
    img.src = URL.createObjectURL(file);
  };

  const clearPhoto = () => setBgImage(null);

  // build 150: 공유 실패 시 모달 자동 닫기 차단 — 사용자가 에러 toast 를 읽을 수 있게.
  const shareErrorRef = useRef(false);
  // build 143: 공유 실패 시 toast 로 에러 노출 (이전 silent fallback → 사용자 모름 회귀).
  const showShareError = (label: string, err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ShareCard] ${label} 실패:`, err);
    shareErrorRef.current = true;
    setRegisterToast(`공유 실패 — ${msg.slice(0, 80)}`);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setRegisterToast(null), 4500);
  };

  // build 136: 정적 PNG 공유. 네이티브 공유 시트 (Capacitor Share) + 캡션.
  // build 167 #3: 사용자 결정 — 공유 시 태그/링크 제거. 채팅창 지저분함 회피. 동영상/이미지만 공유.
  const sharePngBlob = async (blob: Blob) => {
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
          url: result.uri,
          dialogTitle: '러닝 기록 공유',
        });
      } catch (err) {
        showShareError('네이티브 PNG 공유', err);
      }
    } else if (navigator.share) {
      try {
        const file = new File([blob], `routinist-${activity.activity_date}.png`, { type: 'image/png' });
        await navigator.share({ files: [file] });
      } catch (err) {
        // user cancelled 인지 진짜 에러인지 구분 — AbortError 는 무시.
        if (err instanceof Error && err.name !== 'AbortError') showShareError('웹 공유', err);
      }
    } else {
      downloadBlob(blob, `routinist-${activity.activity_date}.png`);
    }
  };

  // 비디오 (MP4/webm) 네이티브 공유. 카톡·인스타가 동영상으로 인식.
  // build 167 #3: text/title 제거 — 파일만 공유.
  const shareVideoBlob = async (blob: Blob, extension: 'mp4' | 'webm') => {
    const fileName = `routinist-${activity.activity_date}.${extension}`;
    if (isNativeApp()) {
      // build 153: webm 차단(152) 제거 — 이전 빌드에서 webm 도 정상 공유됐다는 사용자 보고.
      try {
        const diag = (label: string) => {
          console.log(`[ShareCard] ${label}`);
        };
        diag(`shareVideoBlob native ext=${extension} size=${blob.size} mime=${blob.type}`);
        const dataUrl = await blobToDataUrl(blob);
        const base64 = dataUrl.split(',')[1];
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        const result = await Filesystem.writeFile({
          path: fileName,
          data: base64,
          directory: Directory.Cache,
        });
        diag(`file written uri=${result.uri}`);
        const { Share } = await import('@capacitor/share');
        const shareResult = await Share.share({
          url: result.uri,
          dialogTitle: '러닝 기록 공유',
        });
        diag(`Share.share resolved activityType=${shareResult?.activityType ?? 'unknown'}`);
      } catch (err) {
        showShareError('네이티브 비디오 공유', err);
      }
    } else if (navigator.share) {
      try {
        const mime = extension === 'mp4' ? 'video/mp4' : 'video/webm';
        const file = new File([blob], fileName, { type: mime });
        await navigator.share({ files: [file] });
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') showShareError('웹 비디오 공유', err);
      }
    } else {
      downloadBlob(blob, fileName);
    }
  };

  // 캔버스 → blob → storage 업로드 → calendar_photos 자동 + activity_photos 옵션
  // build 56: 모든 supabase 호출에 withTimeout 보호.
  // 사용자 결정: 캘린더는 항상 자동, 러닝사진는 사용자 선택 (체크박스).
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

      // 캘린더(항상) + 러닝사진(옵션). 동시 실행, 각 8s.
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
        // quote_id 는 quotes 테이블 row 일 때만 (non-fallback, 또한 user 직접 입력은 X — id 가 'custom-' 접두로 시작).
        // build 137: caption 컬럼에 quote.text 직접 저장 → view join 실패해도 캡션 노출 보장.
        // build 167 #4: 사용자가 직접 타이핑한 customText + saveToQuotes ON 이면 createUserQuote 로
        //   영구 quotes 등록 → 그 id 를 quote_id 로 연결. 소셜 탭 "러너 한 줄" / "내 한 줄" 자동 노출.
        const isCustom = effectiveQuote?.id?.toString().startsWith('custom-') ?? false;
        let quoteIdForCard: string | null = null;
        if (isCustom && saveToQuotes && customText.trim()) {
          try {
            quoteIdForCard = await withTimeout(createUserQuote(customText.trim()), 8000, 'create_user_quote');
          } catch (e) {
            console.warn('[ShareCard] createUserQuote 실패, caption-only 폴백:', e);
          }
        } else if (effectiveQuote && !isCustom && !isFallbackQuote(effectiveQuote)) {
          quoteIdForCard = effectiveQuote.id;
        }
        const captionForCard = effectiveQuote ? effectiveQuote.text : null;
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

  // build 136: 공유는 단일 CTA. 동영상 토글 ON 이면 라인 그리기 MP4, OFF 또는 미지원이면 PNG.
  // build 167 #3: 캡션·해시태그·딥링크 모두 제거. 동영상/이미지 파일만 공유 → 채팅창 깔끔.
  const handleShare = async () => {
    if (!canvasRef.current) return;
    track('share_card_share', {
      activity_id: activity.id,
      distance_km: activity.distance_km,
      has_quote: !!effectiveQuote,
      custom_text: !!customText.trim(),
      native: isNativeApp(),
      as_video: shareAsVideo,
    });

    // 비디오 분기 — MediaRecorder 지원 + GPS 라인 있을 때만 의미 있음.
    const hasRoute = !!activity.route_data?.coordinates?.length;
    if (shareAsVideo && hasRoute && typeof MediaRecorder !== 'undefined') {
      setRenderingVideo(true);
      // build 215 #5-1: 영상 길이 — 일간 기본 4s. 주간 10s. 월간 16s.
      // 사용자 신고: 월간 4s 너무 빠름. highlightDays size 로 주/월 판정.
      const periodDurMs = periodOverrides?.highlightDays
        ? (periodOverrides.highlightDays.length > 10 ? 16000 : 10000)
        : 4000;
      try {
        const result = await captureCanvasAnimation(
          canvasRef.current,
          (progress) => {
            // build 215 #5-3: km hero 도 막대와 동시에 풀 도달하도록 progress 를 0.90 까지 scale.
            // 0..0.90: km 카운트업 + 막대 staggered fill. 0.90..0.96: bounce. 0.92..1.0: 컬러 전환.
            const KM_FILL_END = 0.90;
            const kmProgress = Math.min(1, progress / KM_FILL_END);
            const distR = timeToDistRatio(kmProgress);
            drawCard(
              canvasRef.current!,
              activity,
              displayName,
              THEMES[themeIdx],
              bgImage,
              activities,
              userIdLabel,
              effectiveQuote,
              monthlyGoalKm,
              regionLabel ?? undefined,
              progress,
              activity.distance_km * distR,
              periodOverrides,
            );
          },
          { fps: 30, bitsPerSecond: 5_000_000, durationMs: periodDurMs, holdMs: 1500 },
        );
        await shareVideoBlob(result.blob, result.extension);
      } catch (err) {
        console.warn('비디오 생성 실패, PNG 폴백:', err);
        const blob = await new Promise<Blob | null>(res => canvasRef.current!.toBlob(b => res(b), 'image/png'));
        if (blob) await sharePngBlob(blob);
      } finally {
        // 정적 카드로 복귀
        generate();
        setRenderingVideo(false);
      }
      return;
    }

    // 정적 이미지 공유
    const blob = await new Promise<Blob | null>(res => canvasRef.current!.toBlob(b => res(b), 'image/png'));
    if (blob) await sharePngBlob(blob);
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

        {/* build 150: 한 줄 메시지 — 통합 인라인 input.
            - placeholder: 현재 명언 (회색). 클릭해도 사라지지 않음 (Apple Notes 패턴).
            - 사용자 타이핑 → 카드 안 명언이 실시간 동기화 (effectiveQuote).
            - 오른쪽 아이콘: 빈 상태 → 🔀 셔플(다음 명언), 입력 있음 → ✕ 지우기.
            - build 167 #4: 직접 입력 시 "러너 한 줄에도 저장" 체크박스 노출 (디폴트 ON). */}
        <div className="px-4 pb-2 flex-shrink-0">
          <div className="flex items-center gap-2 bg-[var(--card)] border border-[var(--card-border)] rounded-xl px-3 py-2.5">
            <input
              type="text"
              value={customText}
              onChange={(e) => setCustomText(e.target.value.slice(0, 100))}
              placeholder={quote ? `"${quote.text}"` : '한 줄 메시지를 입력해보세요'}
              maxLength={100}
              className="flex-1 bg-transparent text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none min-w-0"
            />
            {customText.trim() ? (
              <button
                onClick={() => setCustomText('')}
                aria-label="입력 지우기"
                className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--muted)] hover:bg-[var(--card-border)]/40 active:scale-90 flex-shrink-0"
              >
                <X size={16} />
              </button>
            ) : (
              <button
                onClick={rerollQuote}
                aria-label="다른 명언"
                className="w-7 h-7 rounded-full flex items-center justify-center text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 flex-shrink-0"
              >
                <Shuffle size={16} />
              </button>
            )}
          </div>
          {customText.trim() && (
            <label className="flex items-center gap-2 px-1 pt-2 cursor-pointer select-none">
              <span className="relative flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={saveToQuotes}
                  onChange={(e) => setSaveToQuotes(e.target.checked)}
                  className="peer sr-only"
                />
                <span className="w-4 h-4 rounded border-2 border-[var(--card-border)] peer-checked:bg-emerald-500 peer-checked:border-emerald-500 transition-all" />
                {saveToQuotes && (
                  <Check size={10} className="absolute text-white pointer-events-none" strokeWidth={3} />
                )}
              </span>
              <span className="text-[11px] text-[var(--muted)]">러너 한 줄에도 저장 (소셜 탭에서 보임)</span>
            </label>
          )}
        </div>

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
            2) 러닝사진 등록 체크박스 (디폴트 ON) — 캘린더는 항상 자동
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

          {/* 동영상 / 이미지 토글 (build 136) — GPS 경로 있을 때만 표시.
              build 150: 라벨 간명화 ("동영상 (경로 그리기)" → "동영상", "정적 이미지" → "이미지").
              동영상: 출발→도착 라인 그리기 + 정지. 카톡/인스타에서 단일 파일로 자동 재생. */}
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
                동영상
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
                이미지
              </button>
            </div>
          )}

          {/* 러닝사진 체크박스 — 디폴트 ON (사용자 결정). 캘린더는 항상 자동 (UI 표시 X) */}
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
              <span className="text-sm text-[var(--foreground)]">러닝사진에 등록</span>
            </label>
          )}

          {/* 공유 — 단일 CTA. 캘린더 자동 + 러닝사진(체크박스 ON 일 때) + 공유 시트.
              build 136: 비디오 렌더링 중에는 별도 진행 상태 표시. */}
          <button
            onClick={async () => {
              shareErrorRef.current = false;
              // build 154: 동영상은 시트 먼저, 등록 나중 — ✨ overlay 가 시트를 가리는 회귀 차단.
              // 이미지는 시트 호출이 즉시(blob 변환만)라 동시 실행 OK.
              if (shareAsVideo) {
                await handleShare();
                if (!hideRegister && !shareErrorRef.current) {
                  await handleRegister(registerToGallery);
                }
                // 동영상은 자동 닫기 X — 사용자가 X 로 닫음.
                return;
              }
              if (!hideRegister) handleRegister(registerToGallery);
              await handleShare();
              if (!shareErrorRef.current) {
                setTimeout(() => onClose(), 800);
              }
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
