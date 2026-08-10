'use client';

// 공용 신고 다이얼로그 (Apple 1.2) — PhotoCard 의 신고 다이얼로그를 일반화.
// 사유 4종 + (선택) 차단 버튼. 신고는 content_reports insert → DB 트리거가 관리자에게 푸시.
// 사용처: 포토 댓글 · 활동 댓글 · 프로필 · 쪽지 (PhotoCard 는 기존 자체 다이얼로그 유지).

import { useState } from 'react';
import { Flag } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { reportContent, type ReportTargetType, type ReportReason } from '@/lib/content-reports';

interface Props {
  targetType: ReportTargetType;
  targetId: string;
  /** 다이얼로그 타이틀 (예: '댓글 신고', '사용자 신고') */
  title: string;
  /** 신고 detail 컬럼에 함께 저장할 컨텍스트 (댓글 원문 등 — 어드민 판단용) */
  detail?: string;
  onClose: () => void;
  /** 결과 토스트는 호출부가 띄운다 (ok=접수 성공) */
  onDone: (ok: boolean, message: string) => void;
  /** 있으면 차단 버튼 노출 — 차단 실행은 호출부 책임 */
  blockLabel?: string;
  onBlock?: () => void;
}

export default function ReportDialog({
  targetType, targetId, title, detail, onClose, onDone, blockLabel, onBlock,
}: Props) {
  const { tt } = useI18n();
  const [busy, setBusy] = useState(false);

  const handleReport = async (reason: ReportReason) => {
    if (busy) return;
    setBusy(true);
    try {
      await reportContent(targetType, targetId, reason, detail);
      onDone(true, tt('신고가 접수됐어요. 24시간 안에 검토합니다'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onDone(false, `${tt('신고 실패')} — ${msg.slice(0, 80)}`);
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[95] bg-black/60 flex items-center justify-center p-4 animate-fade-in"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-xs bg-white dark:bg-zinc-900 rounded-3xl p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center gap-2 mb-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center">
            <Flag size={26} className="text-amber-600" />
          </div>
          <h3 className="text-base font-bold text-[var(--foreground)] text-center">{title}</h3>
          <p className="text-xs text-[var(--muted)] text-center leading-relaxed">
            {tt('신고 사유를 선택해주세요. 검토 후 24시간 안에 조치합니다.')}
          </p>
        </div>
        <div className="space-y-1.5">
          {([
            { id: 'inappropriate', label: '부적절한 콘텐츠' },
            { id: 'spam', label: '스팸/광고' },
            { id: 'harassment', label: '괴롭힘/혐오' },
            { id: 'other', label: '기타' },
          ] as const).map(opt => (
            <button
              key={opt.id}
              onClick={() => handleReport(opt.id)}
              disabled={busy}
              className="w-full px-3 py-3 rounded-xl bg-[var(--card-border)]/30 text-[var(--foreground)] text-sm font-semibold disabled:opacity-50 active:bg-[var(--card-border)]/60 transition"
            >
              {tt(opt.label)}
            </button>
          ))}
        </div>
        {blockLabel && onBlock && (
          <button
            onClick={() => { onBlock(); onClose(); }}
            disabled={busy}
            className="w-full mt-1.5 px-3 py-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 text-sm font-semibold disabled:opacity-50 active:bg-rose-100 transition"
          >
            {blockLabel}
          </button>
        )}
        <button
          onClick={onClose}
          disabled={busy}
          className="w-full mt-3 py-2.5 text-sm text-[var(--muted)] disabled:opacity-50"
        >
          {tt('취소')}
        </button>
      </div>
    </div>
  );
}
