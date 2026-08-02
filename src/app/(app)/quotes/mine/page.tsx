'use client';

// 내가 작성한 명언 (사용자 피드백 #8) — 작성/삭제/현황 보기.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, PenLine, Trash2, ThumbsUp, Sparkles, Trophy } from 'lucide-react';
import { fetchMyQuotes, createUserQuote, deleteMyQuote, type MyQuote } from '@/lib/user-quotes';
import { useAuth } from '@/components/AuthProvider';
import AppToast from '@/components/AppToast';

export default function MyQuotesPage() {
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const [quotes, setQuotes] = useState<MyQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2500);
  };

  const reload = async () => {
    try {
      const list = await fetchMyQuotes();
      setQuotes(list);
    } catch (e) {
      console.warn('[my quotes] fail', e);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    reload().finally(() => setLoading(false));
  }, [user, authLoading, router]);

  const handleSubmit = async () => {
    const trimmed = input.trim();
    if (trimmed.length < 3) {
      showToast('한 줄 일기가 너무 짧아요 (3자 이상)', 'warn');
      return;
    }
    setSubmitting(true);
    try {
      await createUserQuote(trimmed);
      setInput('');
      await reload();
      showToast('✨ 한 줄 일기가 등록됐어요');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '등록 실패', 'warn');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 한 줄 일기를 삭제할까요?')) return;
    setBusy(id);
    try {
      await deleteMyQuote(id);
      setQuotes(prev => prev.filter(q => q.id !== id));
      showToast('삭제했어요');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '삭제 실패', 'warn');
    } finally {
      setBusy(null);
    }
  };

  const totalLikes = quotes.reduce((s, q) => s + q.like_count, 0);

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-extrabold tracking-tight">나의 한 줄 일기</h1>
          <Link href="/quotes/ranking" className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-emerald-600 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 active:scale-95">
            <Trophy size={12} /> 랭킹
          </Link>
        </div>
      </header>

      {/* Hero stat */}
      <section className="px-4 pt-4">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-teal-600 p-5 shadow-lg shadow-emerald-500/30">
          <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-white/10 blur-2xl" />
          <div className="relative">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 backdrop-blur-sm mb-2">
              <Sparkles size={11} className="text-white" />
              <span className="text-[12px] font-extrabold text-white tracking-widest">MY QUOTES</span>
            </div>
            <p className="text-3xl font-extrabold text-white">
              {quotes.length}<span className="text-base font-bold ml-1">개</span>
              <span className="text-xs text-white/85 ml-3">총 받은 ❤️ {totalLikes}</span>
            </p>
            <p className="text-xs text-white/90 mt-2">@{profile?.display_name ?? '러너'} 의 한 줄들</p>
          </div>
        </div>
      </section>

      {/* 작성 폼 */}
      <section className="px-4 mt-4">
        <div className="card p-4 space-y-2 bg-gradient-to-br from-emerald-50/30 to-transparent dark:from-emerald-950/15 border-emerald-200/40 dark:border-emerald-900/40">
          <h2 className="text-sm font-extrabold inline-flex items-center gap-1.5">
            <PenLine size={14} className="text-emerald-500" /> 새 한 줄 일기 쓰기
          </h2>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 300))}
            placeholder='예) "오늘도 한 발 더, 어제의 나를 이겼다."'
            rows={3}
            className="w-full px-3.5 py-2.5 rounded-xl border-2 border-[var(--card-border)] bg-[var(--background)] text-sm focus:outline-none focus:border-emerald-500 resize-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-[var(--muted)]">{input.length}/300</span>
            <button
              onClick={handleSubmit}
              disabled={submitting || input.trim().length < 3}
              className="px-5 py-2 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-xs font-extrabold disabled:opacity-50 active:scale-95 inline-flex items-center gap-1"
            >
              {submitting ? '등록 중…' : '등록'}
            </button>
          </div>
        </div>
      </section>

      {/* 내 한 줄 일기 리스트 */}
      <section className="px-4 mt-5 space-y-2.5">
        <h2 className="text-sm font-extrabold mb-1">내가 쓴 한 줄</h2>
        {loading ? (
          [0,1].map(i => (
            <div key={i} className="card p-4 animate-pulse space-y-2">
              <div className="h-3 w-2/3 bg-[var(--card-border)]/50 rounded" />
              <div className="h-3 w-1/3 bg-[var(--card-border)]/50 rounded" />
            </div>
          ))
        ) : quotes.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-20 h-20 rounded-full bg-emerald-50 dark:bg-emerald-950/30 mx-auto mb-3 flex items-center justify-center">
              <PenLine size={32} className="text-emerald-500" />
            </div>
            <p className="text-sm text-[var(--muted)]">아직 쓴 한 줄 일기가 없어요. 위에서 한 줄 시작해보세요</p>
          </div>
        ) : (
          quotes.map(q => (
            <div key={q.id} className="card p-4">
              <p className="text-sm italic font-semibold text-[var(--foreground)] leading-relaxed break-keep">
                &ldquo;{q.text}&rdquo;
              </p>
              <div className="flex items-center justify-between mt-2.5">
                <span className="text-[13px] text-[var(--muted)] inline-flex items-center gap-1.5">
                  <ThumbsUp size={11} className={q.like_count > 0 ? 'text-emerald-500' : 'text-[var(--muted)]'} fill={q.like_count > 0 ? '#10b981' : 'transparent'} />
                  {q.like_count}
                  {q.status === 'hidden' && (
                    <span className="ml-2 text-amber-600">⚠ 신고로 숨김</span>
                  )}
                </span>
                <button
                  onClick={() => handleDelete(q.id)}
                  disabled={busy === q.id}
                  className="text-xs text-red-500 font-bold active:scale-95 inline-flex items-center gap-0.5"
                >
                  <Trash2 size={12} /> 삭제
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
