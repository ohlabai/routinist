'use client';

// build 252: 월드런 완주 메달 공유카드.
// 자체 canvas 렌더링 — 1080x1350 (인스타 스토리 비율). 트로피 + 코스명 + 거리 + 완주일 + 브랜드.
// @capacitor/share 로 PNG 공유. 웹은 navigator.share / 다운로드 폴백.

import { useEffect, useRef, useState } from 'react';
import { Share2, X, Download } from 'lucide-react';
// 2026-07-15 리뷰: 전체 한국어 하드코딩 → ttl (canvas/공유 문구) + locale 분기
import { ttl, getCurrentLocale } from '@/lib/i18n';

interface Props {
  courseName: string;
  countryFlag: string;
  distanceKm: number;
  completedAt: string;
  displayName: string;
  refundAmount?: number;
  onClose: () => void;
}

const W = 1080;
const H = 1350;

export default function MedalShareCard({
  courseName,
  countryFlag,
  distanceKm,
  completedAt,
  displayName,
  refundAmount,
  onClose,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = W;
    canvas.height = H;

    // 그라데이션 배경 (에메랄드)
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#064e3b');
    grad.addColorStop(0.5, '#047857');
    grad.addColorStop(1, '#022c22');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // 장식 — 미세한 그리드
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 60) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += 60) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // 상단 라벨
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '600 28px -apple-system, BlinkMacSystemFont, system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(getCurrentLocale() === 'en' ? 'Routinist · World Run Finisher' : 'Routinist · 월드런 완주', W / 2, 100);

    // 메달 원형 (트로피 자리)
    const cx = W / 2;
    const cy = 380;
    const r = 200;
    const medalGrad = ctx.createRadialGradient(cx, cy - 50, 30, cx, cy, r);
    medalGrad.addColorStop(0, '#fef3c7');
    medalGrad.addColorStop(0.5, '#fbbf24');
    medalGrad.addColorStop(1, '#b45309');
    ctx.fillStyle = medalGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // 메달 안쪽 링
    ctx.strokeStyle = '#92400e';
    ctx.lineWidth = 8;
    ctx.stroke();

    // 메달 내부 원
    ctx.fillStyle = '#fef3c7';
    ctx.beginPath();
    ctx.arc(cx, cy, r - 40, 0, Math.PI * 2);
    ctx.fill();

    // 트로피 이모지
    ctx.font = '180px -apple-system, BlinkMacSystemFont, system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏆', cx, cy + 10);
    ctx.textBaseline = 'alphabetic';

    // 국기
    ctx.font = '120px -apple-system, system-ui';
    ctx.fillText(countryFlag || '🏁', cx, 720);

    // 코스명
    ctx.fillStyle = '#fff';
    ctx.font = '900 80px -apple-system, BlinkMacSystemFont, system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(courseName, cx, 830);

    // 거리
    ctx.fillStyle = '#a7f3d0';
    ctx.font = '900 64px -apple-system, system-ui';
    ctx.fillText(getCurrentLocale() === 'en' ? `${distanceKm.toFixed(3)} km finished` : `${distanceKm.toFixed(3)} km 완주`, cx, 920);

    // 완주일
    const dateStr = formatDate(completedAt);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '500 36px -apple-system, system-ui';
    ctx.fillText(dateStr, cx, 980);

    // 환급 보상 (있을 때)
    if (refundAmount && refundAmount > 0) {
      ctx.fillStyle = '#fef3c7';
      ctx.font = '700 40px -apple-system, system-ui';
      ctx.fillText(getCurrentLocale() === 'en' ? `✨ ${refundAmount.toLocaleString()}P mileage refunded` : `✨ 마일리지 ${refundAmount.toLocaleString()}P 환급`, cx, 1060);
    }

    // 하단 — 러너 닉네임 + 브랜드
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '700 36px -apple-system, system-ui';
    ctx.fillText(getCurrentLocale() === 'en' ? displayName : displayName + ' 님', cx, 1200);

    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '500 26px -apple-system, system-ui';
    ctx.fillText('routinist.kr', cx, 1260);
  }, [courseName, countryFlag, distanceKm, completedAt, displayName, refundAmount]);

  const handleShare = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const blob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob fail'))), 'image/png', 0.95);
      });

      // capacitor native share
      const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
      const isNative = cap?.isNativePlatform?.() === true;
      const fileName = `routinist-medal-${Date.now()}.png`;

      if (isNative) {
        try {
          const { Filesystem, Directory } = await import('@capacitor/filesystem');
          const base64 = await blobToBase64(blob);
          const written = await Filesystem.writeFile({
            path: fileName,
            data: base64,
            directory: Directory.Cache,
          });
          const { Share } = await import('@capacitor/share');
          await Share.share({
            title: ttl('완주!') && getCurrentLocale() === 'en' ? `Finished ${courseName}!` : `${courseName} 완주!`,
            text: getCurrentLocale() === 'en' ? `🏆 Finished ${courseName} — ${distanceKm.toFixed(3)}km! #Routinist` : `🏆 ${courseName} ${distanceKm.toFixed(3)}km 완주! #Routinist`,
            url: written.uri,
            dialogTitle: ttl('메달 공유'),
          });
        } catch (e) {
          console.warn('[MedalShareCard] native share fail', e);
        }
      } else if (typeof navigator !== 'undefined' && 'share' in navigator) {
        try {
          const file = new File([blob], fileName, { type: 'image/png' });
          await (navigator as Navigator & { share: (data: { files: File[]; title?: string; text?: string }) => Promise<void> }).share({
            files: [file],
            title: getCurrentLocale() === 'en' ? `Finished ${courseName}!` : `${courseName} 완주!`,
            text: getCurrentLocale() === 'en' ? `🏆 Finished ${courseName} — ${distanceKm.toFixed(3)}km! #Routinist` : `🏆 ${courseName} ${distanceKm.toFixed(3)}km 완주! #Routinist`,
          });
        } catch (e) {
          console.warn('[MedalShareCard] web share fail', e);
          downloadBlob(blob, fileName);
        }
      } else {
        downloadBlob(blob, fileName);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, `routinist-medal-${Date.now()}.png`);
    }, 'image/png', 0.95);
  };

  return (
    <div className="fixed inset-0 z-[95] bg-black/80 backdrop-blur-sm flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <button type="button" onClick={onClose} aria-label={ttl('닫기')} className="p-2 rounded-full hover:bg-white/10">
          <X className="w-6 h-6" />
        </button>
        <div className="text-sm font-bold">{ttl('메달 공유')}</div>
        <div className="w-10" />
      </div>

      <div className="flex-1 flex items-center justify-center px-4 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="rounded-2xl shadow-2xl max-w-full max-h-full"
          style={{ aspectRatio: `${W} / ${H}` }}
        />
      </div>

      <div className="p-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={handleDownload}
          disabled={busy}
          className="py-3 rounded-2xl bg-white/10 backdrop-blur text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Download className="w-4 h-4" />
          {ttl('저장')}
        </button>
        <button
          type="button"
          onClick={handleShare}
          disabled={busy}
          className="py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Share2 className="w-4 h-4" />
          {busy ? ttl('준비중...') : ttl('친구에게 공유')}
        </button>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}.${m}.${day}`;
  } catch {
    return iso.slice(0, 10);
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] ?? '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
