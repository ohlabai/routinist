'use client';

// 소셜 > 명언 탭 (build 106) — 트위터/스레드 스타일 텍스트 피드.
// 사용자 결정: 나의 명언 + 명언 사전 (랭킹) 을 소셜 마지막 탭으로 이전.
// 인라인 좋아요·카운트, 본인 명언 삭제, 신고 모두 한 화면에서.

import { useEffect, useState, useCallback } from 'react';
import { PenLine, ThumbsUp, Sparkles, Flag, Trash2, Check, X, User as UserIcon } from 'lucide-react';
import {
  fetchTopQuotes,
  fetchMyQuotes,
  createUserQuote,
  deleteMyQuote,
  reportQuote,
  type MyQuote,
  type QuoteReportReason,
} from '@/lib/user-quotes';
import { toggleQuoteLike } from '@/lib/quotes-data';
import { useAuth } from '@/components/AuthProvider';
import AppToast from '@/components/AppToast';

type FilterMode = 'all' | 'mine';

interface FeedItem {
  id: string;
  text: string;
  author: string | null;
  is_user_quote: boolean;
  like_count: number;
  liked_by_me: boolean;
  created_at: string;
  is_mine?: boolean; // mine 모드에서만 true
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return '방금';
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}분`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}시간`;
  if (ms < 30 * 86400_000) return `${Math.floor(ms / 86400_000)}일`;
  return `${Math.floor(ms / (30 * 86400_000))}달`;
}

export default function QuotesTab() {
  const { user, profile } = useAuth();
  const [mode, setMode] = useState<FilterMode>('all');
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [likeBusy, setLikeBusy] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeText, setComposeText] = useState('');
  const [composing, setComposing] = useState(false);
  const [reportTarget, setReportTarget] = useState<FeedItem | null>(null);
  const [reporting, setReporting] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const showToast = useCallback((text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2200);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (mode === 'all') {
        const list = await fetchTopQuotes(50, 0);
        setItems(list.map<FeedItem>(q => ({
          id: q.id,
          text: q.text,
          author: q.author,
          is_user_quote: q.is_user_quote,
          like_count: q.like_count,
          liked_by_me: q.liked_by_me,
          created_at: q.created_at,
          is_mine: q.is_user_quote && q.author === profile?.display_name,
        })));
      } else {
        const list: MyQuote[] = await fetchMyQuotes();
        setItems(list.map<FeedItem>(q => ({
          id: q.id,
          text: q.text,
          author: q.author,
          is_user_quote: true,
          like_count: q.like_count,
          liked_by_me: false,
          created_at: q.created_at,
          is_mine: true,
        })));
      }
    } catch (e) {
      console.warn('[QuotesTab] load fail', e);
    } finally {
      setLoading(false);
    }
  }, [mode, profile?.display_name]);

  useEffect(() => { load(); }, [load]);

  const handleLike = async (q: FeedItem) => {
    if (likeBusy === q.id || mode === 'mine') return;
    setLikeBusy(q.id);
    const wasLiked = q.liked_by_me;
    setItems(prev => prev.map(x => x.id === q.id ? {
      ...x,
      liked_by_me: !wasLiked,
      like_count: x.like_count + (wasLiked ? -1 : 1),
    } : x));
    try {
      const res = await toggleQuoteLike(q.id);
      setItems(prev => prev.map(x => x.id === q.id ? { ...x, liked_by_me: res.liked, like_count: res.like_count } : x));
    } catch {
      setItems(prev => prev.map(x => x.id === q.id ? {
        ...x,
        liked_by_me: wasLiked,
        like_count: x.like_count + (wasLiked ? 1 : -1),
      } : x));
      showToast('잠시 후 다시 시도해주세요', 'warn');
    } finally {
      setLikeBusy(null);
    }
  };

  const handleCompose = async () => {
    const trimmed = composeText.trim();
    if (trimmed.length < 3) { showToast('한 줄 일기가 너무 짧아요 (3자 이상)', 'warn'); return; }
    setComposing(true);
    try {
      await createUserQuote(trimmed);
      setComposeText('');
      setComposeOpen(false);
      showToast('✨ 한 줄 일기가 등록됐어요');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '등록 실패', 'warn');
    } finally {
      setComposing(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 한 줄을 삭제할까요?')) return;
    try {
      await deleteMyQuote(id);
      setItems(prev => prev.filter(x => x.id !== id));
      showToast('삭제했어요');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '삭제 실패', 'warn');
    }
  };

  const handleReport = async (reason: QuoteReportReason) => {
    if (!reportTarget) return;
    setReporting(true);
    try {
      await reportQuote(reportTarget.id, reason);
      showToast('신고 접수됨');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '신고 실패', 'warn');
    } finally {
      setReporting(false);
      setReportTarget(null);
    }
  };

  return (
    <div className="relative pb-20">
      {/* 필터 toggle */}
      <div className="px-4 pt-3 flex items-center gap-2">
        <div className="flex p-1 rounded-full bg-[var(--card)] border border-[var(--card-border)] flex-1">
          {(['all', 'mine'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 py-1.5 rounded-full text-sm font-bold transition active:scale-95 ${
                mode === m ? 'bg-emerald-500 text-white shadow' : 'text-[var(--muted)]'
              }`}
            >
              {m === 'all' ? '전체' : '내 한 줄'}
            </button>
          ))}
        </div>
        <button
          onClick={() => setComposeOpen(true)}
          className="px-3.5 py-2 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-bold text-sm shadow active:scale-95 inline-flex items-center gap-1"
          aria-label="러너 한 줄 쓰기"
        >
          <PenLine size={14} /> 쓰기
        </button>
      </div>

      {/* 피드 */}
      <div className="mt-3 divide-y divide-[var(--card-border)]/40">
        {loading ? (
          [0, 1, 2, 3].map(i => (
            <div key={i} className="px-4 py-4 animate-pulse space-y-2">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-full bg-[var(--card-border)]/50" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-24 bg-[var(--card-border)]/50 rounded" />
                  <div className="h-2.5 w-16 bg-[var(--card-border)]/40 rounded" />
                </div>
              </div>
              <div className="h-3 w-full bg-[var(--card-border)]/50 rounded" />
              <div className="h-3 w-4/5 bg-[var(--card-border)]/50 rounded" />
            </div>
          ))
        ) : items.length === 0 ? (
          <div className="text-center py-16 px-6">
            <div className="w-16 h-16 rounded-full bg-emerald-50 dark:bg-emerald-950/30 mx-auto mb-3 flex items-center justify-center">
              <Sparkles size={28} className="text-emerald-500" />
            </div>
            <p className="text-base font-extrabold mb-1">
              {mode === 'mine' ? '아직 쓴 한 줄이 없어요' : '아직 등록된 한 줄이 없어요'}
            </p>
            <p className="text-sm text-[var(--muted)]">
              우측 상단 <span className="font-bold text-emerald-600">쓰기</span> 로 첫 한 줄을 남겨보세요
            </p>
          </div>
        ) : (
          items.map((q) => (
            <article key={q.id} className="px-4 py-4">
              <div className="flex gap-2.5">
                {/* 아바타 — author 이름 첫 글자로 placeholder */}
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-100 to-emerald-50 dark:from-emerald-900/40 dark:to-emerald-950/40 flex items-center justify-center flex-shrink-0 text-emerald-700 dark:text-emerald-300 font-extrabold">
                  {q.author?.charAt(0) ?? <UserIcon size={16} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-sm">
                    <span className="font-bold text-[var(--foreground)] truncate">
                      {q.author ?? '익명'}
                    </span>
                    {q.is_user_quote && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex-shrink-0">
                        러너
                      </span>
                    )}
                    {!q.is_user_quote && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 flex-shrink-0">
                        고전
                      </span>
                    )}
                    <span className="text-xs text-[var(--muted)] flex-shrink-0">· {timeAgo(q.created_at)}</span>
                  </div>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-[var(--foreground)] break-keep whitespace-pre-wrap">
                    {q.text}
                  </p>
                  <div className="mt-2.5 flex items-center gap-1">
                    {mode === 'all' && (
                      <button
                        onClick={() => handleLike(q)}
                        disabled={likeBusy === q.id}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition disabled:opacity-50 active:scale-95"
                        aria-label="좋아요"
                      >
                        <ThumbsUp
                          size={15}
                          className={q.liked_by_me ? 'text-emerald-500' : 'text-[var(--muted)]'}
                          fill={q.liked_by_me ? '#10b981' : 'transparent'}
                        />
                        <span className={`text-sm ${q.liked_by_me ? 'text-emerald-600 font-bold' : 'text-[var(--muted)] font-semibold'}`}>
                          {q.like_count}
                        </span>
                      </button>
                    )}
                    {mode === 'mine' && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-[var(--muted)] font-semibold">
                        <ThumbsUp size={15} /> {q.like_count}
                      </span>
                    )}
                    {q.is_mine ? (
                      <button
                        onClick={() => handleDelete(q.id)}
                        className="ml-auto inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs text-rose-600 dark:text-rose-400 active:scale-95"
                      >
                        <Trash2 size={12} /> 삭제
                      </button>
                    ) : q.is_user_quote && user ? (
                      <button
                        onClick={() => setReportTarget(q)}
                        className="ml-auto inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs text-[var(--muted)] active:scale-95"
                      >
                        <Flag size={12} /> 신고
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </article>
          ))
        )}
      </div>

      {/* 작성 모달 */}
      {composeOpen && (
        <div
          className="fixed inset-0 z-[80] bg-black/65 flex items-end sm:items-center justify-center p-3 animate-[fadeIn_0.2s_ease-out]"
          onClick={() => !composing && setComposeOpen(false)}
        >
          <div
            className="w-full max-w-md bg-[var(--background)] rounded-3xl p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-base font-extrabold inline-flex items-center gap-1.5">
                  <PenLine size={16} className="text-emerald-500" /> 한 줄 일기
                </h3>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  {profile?.display_name ?? '러너'} 닉네임으로 표시돼요
                </p>
              </div>
              <button onClick={() => setComposeOpen(false)} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--card-border)]/40 active:scale-90">
                <X size={16} />
              </button>
            </div>
            <textarea
              value={composeText}
              onChange={(e) => setComposeText(e.target.value.slice(0, 300))}
              placeholder='예) "오늘도 한 발 더, 어제의 나를 이겼다."'
              rows={4}
              autoFocus
              className="w-full px-3.5 py-3 rounded-2xl border-2 border-[var(--card-border)] bg-[var(--background)] text-[15px] focus:outline-none focus:border-emerald-500 resize-none"
            />
            <div className="flex justify-between mt-1.5">
              <span className="text-[10px] text-[var(--muted)]">{composeText.length}/300</span>
              <span className="text-[10px] text-emerald-600 font-semibold">좋아요 받기 + 공유 카드 캡션</span>
            </div>
            <button
              onClick={handleCompose}
              disabled={composing || composeText.trim().length < 3}
              className="w-full mt-3 py-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-sm disabled:opacity-50 active:scale-[0.98] inline-flex items-center justify-center gap-1.5"
            >
              {composing ? (
                <><span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" /> 등록 중…</>
              ) : (
                <><Check size={16} /> 러너 한 줄 등록</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* 신고 다이얼로그 */}
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
                신고 사유를 선택해주세요. 3회 누적 시 자동 숨김 처리.
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
