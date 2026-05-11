'use client';

// 어드민 — 명언 신고 모더레이션. hans@openhan.kr 만 접근.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Flag, EyeOff, RotateCcw, Check, Sparkles } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { fetchPendingQuoteReports, resolveQuoteReport, type PendingQuoteReport } from '@/lib/user-quotes';
import AppToast from '@/components/AppToast';

import { isAdminEmail } from '@/lib/admin-emails';

const REASON_LABEL: Record<string, string> = {
  inappropriate: '부적절',
  spam: '스팸',
  harassment: '괴롭힘',
  copyright: '저작권',
  other: '기타',
};

export default function AdminQuotesPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const [reports, setReports] = useState<PendingQuoteReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    if (!isAdmin) { router.replace('/'); return; }
  }, [authLoading, user, isAdmin, router]);

  const reload = async () => {
    try {
      const list = await fetchPendingQuoteReports();
      setReports(list);
    } catch (e) {
      console.warn('[admin/quotes] fail', e);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    reload().finally(() => setLoading(false));
  }, [isAdmin]);

  const handleAction = async (quoteId: string, action: 'hide' | 'dismiss' | 'restore') => {
    setBusy(quoteId);
    try {
      await resolveQuoteReport(quoteId, action);
      const labelMap = { hide: '숨김 처리', dismiss: '무시 처리', restore: '복구' };
      setToast({ text: `✓ ${labelMap[action]} 완료`, tone: 'ok' });
      setReports(prev => prev.filter(r => r.quote_id !== quoteId));
      setTimeout(() => setToast(null), 2200);
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : '처리 실패', tone: 'warn' });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setBusy(null);
    }
  };

  if (authLoading || !isAdmin) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-extrabold tracking-tight flex-1">명언 모더레이션</h1>
          <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40">
            ADMIN
          </span>
        </div>
      </header>

      <section className="px-4 pt-4">
        <div className="card p-4 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 border-amber-200/60 dark:border-amber-900/40">
          <div className="flex items-center gap-3">
            <Flag size={20} className="text-amber-600" />
            <div>
              <p className="text-sm font-extrabold">{reports.length}건 미해결 신고</p>
              <p className="text-[11px] text-[var(--muted)]">3회 누적 시 자동 숨김. 어드민 수동 처리도 가능.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 mt-4 space-y-2.5">
        {loading ? (
          [0,1,2].map(i => (
            <div key={i} className="card p-4 animate-pulse space-y-2">
              <div className="h-3 w-2/3 bg-[var(--card-border)]/50 rounded" />
              <div className="h-3 w-1/2 bg-[var(--card-border)]/50 rounded" />
            </div>
          ))
        ) : reports.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 rounded-full bg-emerald-50 dark:bg-emerald-950/30 mx-auto mb-3 flex items-center justify-center">
              <Sparkles size={32} className="text-emerald-500" />
            </div>
            <p className="text-base font-extrabold mb-1">처리할 신고가 없어요</p>
            <p className="text-sm text-[var(--muted)]">평화로워요 🌿</p>
          </div>
        ) : (
          reports.map(r => (
            <div key={r.quote_id} className="card p-4 space-y-3">
              <div>
                <p className="text-sm italic font-semibold leading-relaxed break-keep">&ldquo;{r.quote_text}&rdquo;</p>
                <p className="text-[11px] text-[var(--muted)] mt-1">— {r.quote_author ?? '익명'}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-950/30 text-red-600">
                  신고 {r.report_count}건
                </span>
                {r.reasons.map(reason => (
                  <span key={reason} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--card-border)]/40 text-[var(--muted)]">
                    {REASON_LABEL[reason] ?? reason}
                  </span>
                ))}
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--card-border)]/40 text-[var(--muted)]">
                  상태: {r.quote_status}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-1">
                <button
                  onClick={() => handleAction(r.quote_id, 'hide')}
                  disabled={busy === r.quote_id}
                  className="py-2 rounded-xl bg-red-50 dark:bg-red-950/30 text-red-600 text-xs font-extrabold inline-flex items-center justify-center gap-1 disabled:opacity-50 active:scale-95"
                >
                  <EyeOff size={12} /> 숨김
                </button>
                <button
                  onClick={() => handleAction(r.quote_id, 'restore')}
                  disabled={busy === r.quote_id}
                  className="py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 text-xs font-extrabold inline-flex items-center justify-center gap-1 disabled:opacity-50 active:scale-95"
                >
                  <RotateCcw size={12} /> 복구
                </button>
                <button
                  onClick={() => handleAction(r.quote_id, 'dismiss')}
                  disabled={busy === r.quote_id}
                  className="py-2 rounded-xl bg-[var(--card-border)]/40 text-[var(--muted)] text-xs font-bold inline-flex items-center justify-center gap-1 disabled:opacity-50 active:scale-95"
                >
                  <Check size={12} /> 무시
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2500} />}
    </div>
  );
}
