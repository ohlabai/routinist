'use client';

// 명언 랭킹 (사용자 피드백 #8) — 좋아요 많은 순. 사용자 작성 + 공식 명언 통합.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Sparkles, ThumbsUp, Trophy, User, PenLine, Flag, MoreVertical } from 'lucide-react';
import { fetchTopQuotes, reportQuote, type RankedQuote, type QuoteReportReason } from '@/lib/user-quotes';
import { toggleQuoteLike } from '@/lib/quotes-data';
import { useAuth } from '@/components/AuthProvider';
import AppToast from '@/components/AppToast';

export default function QuoteRankingPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [quotes, setQuotes] = useState<RankedQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [likeBusy, setLikeBusy] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<RankedQuote | null>(null);
  const [reporting, setReporting] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const handleReport = async (reason: QuoteReportReason) => {
    if (!reportTarget) return;
    setReporting(true);
    try {
      await reportQuote(reportTarget.id, reason);
      setToast({ text: '신고가 접수됐어요. 검토 후 24시간 안에 조치합니다', tone: 'ok' });
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : '신고 실패', tone: 'warn' });
    } finally {
      setReporting(false);
      setReportTarget(null);
      setTimeout(() => setToast(null), 3000);
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetchTopQuotes(50, 0)
      .then(list => { if (!cancelled) setQuotes(list); })
      .catch(e => { if (!cancelled) console.warn('[quote ranking] fail', e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleLike = async (q: RankedQuote) => {
    if (likeBusy === q.id) return;
    setLikeBusy(q.id);
    const wasLiked = q.liked_by_me;
    // optimistic
    setQuotes(prev => prev.map(x => x.id === q.id ? {
      ...x,
      liked_by_me: !wasLiked,
      like_count: x.like_count + (wasLiked ? -1 : 1),
    } : x));
    try {
      const res = await toggleQuoteLike(q.id);
      setQuotes(prev => prev.map(x => x.id === q.id ? {
        ...x,
        liked_by_me: res.liked,
        like_count: res.like_count,
      } : x));
    } catch {
      // revert
      setQuotes(prev => prev.map(x => x.id === q.id ? {
        ...x,
        liked_by_me: wasLiked,
        like_count: x.like_count + (wasLiked ? 1 : -1),
      } : x));
      setToast({ text: '잠시 후 다시 시도해주세요', tone: 'warn' });
      setTimeout(() => setToast(null), 2000);
    } finally {
      setLikeBusy(null);
    }
  };

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-extrabold tracking-tight">한 줄 일기 모음</h1>
        </div>
      </header>

      {/* Hero */}
      <section className="px-4 pt-4">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-teal-600 p-5 shadow-lg shadow-emerald-500/30">
          <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-white/10 blur-2xl" />
          <div className="relative">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 backdrop-blur-sm mb-2">
              <Trophy size={11} className="text-white" />
              <span className="text-[10px] font-extrabold text-white tracking-widest">QUOTE RANKING</span>
            </div>
            <h2 className="text-xl font-extrabold text-white mb-1">러너 한 줄 모음</h2>
            <p className="text-xs text-white/90 leading-relaxed">
              나와 다른 러너들이 직접 쓴 한 줄. 좋아요로 응원해주세요.
            </p>
          </div>
        </div>
      </section>

      {/* 나의 명언 작성 CTA */}
      <section className="px-4 mt-3">
        <Link
          href="/quotes/mine"
          className="card p-3.5 flex items-center gap-3 active:scale-[0.99] group bg-gradient-to-br from-emerald-50/40 to-transparent dark:from-emerald-950/15 border-emerald-200/50 dark:border-emerald-900/40"
        >
          <div className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
            <PenLine size={18} className="text-emerald-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-extrabold text-[var(--foreground)]">한 줄 일기 쓰기</p>
            <p className="text-[11px] text-[var(--muted)]">공유 카드에 닉네임과 함께 표시돼요</p>
          </div>
          <span className="text-emerald-600 text-xs font-bold">시작 →</span>
        </Link>
      </section>

      {/* 랭킹 리스트 */}
      <section className="px-4 mt-4 space-y-2.5">
        {loading ? (
          [0,1,2,3].map(i => (
            <div key={i} className="card p-4 animate-pulse space-y-2">
              <div className="h-3 w-2/3 bg-[var(--card-border)]/50 rounded" />
              <div className="h-3 w-1/2 bg-[var(--card-border)]/50 rounded" />
            </div>
          ))
        ) : quotes.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 rounded-full bg-emerald-50 dark:bg-emerald-950/30 mx-auto mb-3 flex items-center justify-center">
              <Sparkles size={32} className="text-emerald-500" />
            </div>
            <p className="text-base font-extrabold mb-1">아직 등록된 한 줄이 없어요</p>
            <p className="text-sm text-[var(--muted)]">첫 번째 한 줄을 남겨주세요</p>
          </div>
        ) : (
          quotes.map((q, i) => (
            <div key={q.id} className="card p-4 flex gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-extrabold text-xs flex-shrink-0 ${
                i === 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' :
                i === 1 ? 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200' :
                i === 2 ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' :
                'bg-[var(--card-border)]/40 text-[var(--muted)]'
              }`}>
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm italic font-semibold text-[var(--foreground)] leading-relaxed break-keep">
                  &ldquo;{q.text}&rdquo;
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[11px] text-[var(--muted)] inline-flex items-center gap-1">
                    {q.is_user_quote ? <User size={10} /> : <Sparkles size={10} />}
                    — {q.author ?? '익명'}
                  </span>
                  {q.is_user_quote && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                      러너
                    </span>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => handleLike(q)}
                    disabled={likeBusy === q.id}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--card)] border border-[var(--card-border)] text-xs disabled:opacity-50 active:scale-95"
                    aria-label="좋아요"
                  >
                    <ThumbsUp
                      size={12}
                      className={q.liked_by_me ? 'text-emerald-500' : 'text-[var(--muted)]'}
                      fill={q.liked_by_me ? '#10b981' : 'transparent'}
                    />
                    <span className={q.liked_by_me ? 'text-emerald-600 font-bold' : 'text-[var(--muted)]'}>
                      {q.like_count}
                    </span>
                  </button>
                  {q.is_user_quote && user && (
                    <button
                      onClick={() => setReportTarget(q)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] text-[var(--muted)] active:scale-95"
                      aria-label="신고"
                    >
                      <Flag size={10} /> 신고
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </section>

      {/* 명언 신고 다이얼로그 */}
      {reportTarget && (
        <div
          className="fixed inset-0 z-[80] bg-black/65 flex items-center justify-center p-4"
          onClick={() => !reporting && setReportTarget(null)}
        >
          <div
            className="w-full max-w-xs bg-[var(--background)] rounded-3xl p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-center gap-2 mb-4">
              <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center">
                <Flag size={24} className="text-amber-600" />
              </div>
              <h3 className="text-base font-bold">러너 한 줄 신고</h3>
              <p className="text-xs text-[var(--muted)] text-center">
                신고 사유를 선택해주세요. 3회 누적되면 자동 숨김 처리됩니다.
              </p>
            </div>
            <div className="space-y-1.5">
              {([
                { id: 'inappropriate' as const, label: '부적절한 콘텐츠' },
                { id: 'spam' as const, label: '스팸/광고' },
                { id: 'harassment' as const, label: '괴롭힘/혐오' },
                { id: 'copyright' as const, label: '저작권 위반' },
                { id: 'other' as const, label: '기타' },
              ]).map(opt => (
                <button
                  key={opt.id}
                  onClick={() => handleReport(opt.id)}
                  disabled={reporting}
                  className="w-full px-3 py-3 rounded-xl bg-[var(--card-border)]/30 text-sm font-semibold disabled:opacity-50 active:bg-[var(--card-border)]/60"
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setReportTarget(null)}
              disabled={reporting}
              className="w-full mt-3 py-2.5 text-sm text-[var(--muted)] disabled:opacity-50"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2200} />}
    </div>
  );
}
