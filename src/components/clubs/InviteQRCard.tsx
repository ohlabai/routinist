'use client';

// 클럽 초대 QR 공유카드 — Canvas 기반. iMessage / 카톡 등에 바로 공유 가능.

import { useEffect, useRef, useState } from 'react';
import { X, Share2, Download } from 'lucide-react';
import QRCode from 'qrcode';
import { isNativeApp } from '@/lib/health-sync';
import { useI18n } from '@/lib/i18n';

interface Props {
  clubName: string;
  clubDescription: string | null;
  memberCount: number;
  inviteUrl: string;
  onClose: () => void;
}

export default function InviteQRCard({ clubName, clubDescription, memberCount, inviteUrl, onClose }: Props) {
  const { tt, locale } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    (async () => {
      if (!canvasRef.current) return;
      const canvas = canvasRef.current;
      const W = 720, H = 1080;
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // 배경 — emerald 그라데이션
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#ecfdf5');
      bg.addColorStop(0.55, '#ffffff');
      bg.addColorStop(1, '#d1fae5');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // 상단 로고/제목
      ctx.fillStyle = '#059669';
      ctx.font = 'bold 32px -apple-system, Pretendard, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Routinist', W / 2, 80);

      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 52px -apple-system, Pretendard, sans-serif';
      const title = clubName.length > 14 ? clubName.slice(0, 14) + '…' : clubName;
      ctx.fillText(title, W / 2, 160);

      if (clubDescription) {
        ctx.fillStyle = '#475569';
        ctx.font = '26px -apple-system, Pretendard, sans-serif';
        const desc = clubDescription.length > 30 ? clubDescription.slice(0, 30) + '…' : clubDescription;
        ctx.fillText(desc, W / 2, 210);
      }

      ctx.fillStyle = '#10b981';
      ctx.font = 'bold 26px -apple-system, Pretendard, sans-serif';
      ctx.fillText(locale === 'en' ? `${memberCount} members · come run with us!` : `멤버 ${memberCount}명 · 함께 달리러 가요!`, W / 2, 260);

      // QR
      const qrSize = 420;
      const qrDataUrl = await QRCode.toDataURL(inviteUrl, {
        width: qrSize,
        margin: 1,
        color: { dark: '#064e3b', light: '#ffffff' },
      });
      const qrImg = new Image();
      await new Promise(res => { qrImg.onload = res; qrImg.src = qrDataUrl; });

      // QR 흰 카드 배경
      const qrX = (W - qrSize) / 2;
      const qrY = 320;
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.08)';
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 8;
      const radius = 32;
      const pad = 28;
      ctx.beginPath();
      ctx.moveTo(qrX - pad + radius, qrY - pad);
      ctx.lineTo(qrX + qrSize + pad - radius, qrY - pad);
      ctx.arcTo(qrX + qrSize + pad, qrY - pad, qrX + qrSize + pad, qrY - pad + radius, radius);
      ctx.lineTo(qrX + qrSize + pad, qrY + qrSize + pad - radius);
      ctx.arcTo(qrX + qrSize + pad, qrY + qrSize + pad, qrX + qrSize + pad - radius, qrY + qrSize + pad, radius);
      ctx.lineTo(qrX - pad + radius, qrY + qrSize + pad);
      ctx.arcTo(qrX - pad, qrY + qrSize + pad, qrX - pad, qrY + qrSize + pad - radius, radius);
      ctx.lineTo(qrX - pad, qrY - pad + radius);
      ctx.arcTo(qrX - pad, qrY - pad, qrX - pad + radius, qrY - pad, radius);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

      ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

      // 안내 문구
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 32px -apple-system, Pretendard, sans-serif';
      ctx.fillText(tt('QR을 스캔해 클럽 가입하기'), W / 2, qrY + qrSize + pad + 80);

      ctx.fillStyle = '#64748b';
      ctx.font = '22px -apple-system, Pretendard, sans-serif';
      ctx.fillText(tt('앱이 설치되어 있으면 바로 열립니다'), W / 2, qrY + qrSize + pad + 120);

      // 하단 워터마크
      ctx.fillStyle = '#94a3b8';
      ctx.font = '20px -apple-system, Pretendard, sans-serif';
      ctx.fillText('Run Your Routine!', W / 2, H - 50);

      setReady(true);
    })();
    // locale 변경 시 canvas 문구 다시 그리기
  }, [clubName, clubDescription, memberCount, inviteUrl, locale, tt]);

  const handleShare = async () => {
    if (!canvasRef.current) return;
    setSharing(true);
    try {
      if (isNativeApp()) {
        const base64 = canvasRef.current.toDataURL('image/png').split(',')[1];
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        const fileName = `routinist-invite-${Date.now()}.png`;
        const result = await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache });
        const { Share } = await import('@capacitor/share');
        await Share.share({ title: locale === 'en' ? `You're invited to the ${clubName} club!` : `${clubName} 클럽에 초대합니다!`, text: inviteUrl, url: result.uri });
      } else {
        const blob = await new Promise<Blob | null>(res => canvasRef.current!.toBlob(b => res(b), 'image/png'));
        if (blob && navigator.share) {
          const file = new File([blob], 'routinist-invite.png', { type: 'image/png' });
          try { await navigator.share({ files: [file], title: `${clubName}`, text: inviteUrl }); } catch {}
        } else {
          handleDownload();
        }
      }
    } catch (e) {
      console.warn('공유 실패', e);
    } finally {
      setSharing(false);
    }
  };

  const handleDownload = () => {
    if (!canvasRef.current) return;
    const link = document.createElement('a');
    link.download = `routinist-invite-${clubName}.png`;
    link.href = canvasRef.current.toDataURL('image/png');
    link.click();
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-[var(--background)] rounded-2xl max-w-sm w-full overflow-hidden max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--card-border)] flex-shrink-0">
          <h3 className="text-base font-bold text-[var(--foreground)]">{tt('초대 QR 카드')}</h3>
          <button onClick={onClose} className="text-[var(--muted)]"><X size={20} /></button>
        </div>
        <div className="p-4 flex-1 overflow-auto">
          <canvas ref={canvasRef} className="w-full rounded-xl shadow-lg" style={{ aspectRatio: '720/1080' }} />
        </div>
        <div className="flex gap-2 px-4 pb-4 pt-2 flex-shrink-0">
          <button
            onClick={handleDownload}
            disabled={!ready}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-[var(--card-bg)] border border-[var(--card-border)] text-[var(--foreground)] font-semibold text-sm disabled:opacity-50"
          >
            <Download size={18} /> {tt('저장')}
          </button>
          <button
            onClick={handleShare}
            disabled={!ready || sharing}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-500 text-white font-bold text-sm shadow-md disabled:opacity-50"
          >
            <Share2 size={18} /> {sharing ? tt('공유 중...') : tt('공유하기')}
          </button>
        </div>
      </div>
    </div>
  );
}
