'use client';

// 제안/버그 게시판 (build 107) — 유저가 직접 버그/기능 요청 남기는 공개 게시판.
// 어드민은 /admin/feedback 에서 상태 변경 + 답글.

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, ThumbsUp, MessageSquare, Bug, Sparkles, Layout, HelpCircle, Plus, X, Check, Trash2, Lock, Globe } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import AppLogo from '@/components/AppLogo';
import AppToast from '@/components/AppToast';
import {
  fetchFeedback,
  fetchMyFeedbackUpvotes,
  toggleFeedbackUpvote,
  createFeedback,
  deleteMyFeedback,
  CATEGORY_LABEL,
  STATUS_LABEL,
  STATUS_COLOR,
  type FeedbackPost,
  type FeedbackCategory,
  type FeedbackStatus,
} from '@/lib/feedback-data';

const CATEGORY_ICONS: Record<FeedbackCategory, typeof Bug> = {
  bug: Bug,
  feature: Sparkles,
  ui: Layout,
  other: HelpCircle,
};

const CATEGORY_COLORS: Record<FeedbackCategory, string> = {
  bug: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  feature: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  ui: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  other: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200',
};

const STATUS_FILTERS: { id: FeedbackStatus | 'all'; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'open', label: '접수됨' },
  { id: 'reviewing', label: '검토 중' },
  { id: 'done', label: '완료' },
];

const SORT_OPTIONS = [
  { id: 'top' as const, label: '인기순' },
  { id: 'latest' as const, label: '최신순' },
];

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return '방금';
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}분`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}시간`;
  if (ms < 30 * 86400_000) return `${Math.floor(ms / 86400_000)}일`;
  return `${Math.floor(ms / (30 * 86400_000))}달`;
}

export default function FeedbackPage() {
  const { user } = useAuth();
  const [posts, setPosts] = useState<FeedbackPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | 'all'>('all');
  const [sort, setSort] = useState<'top' | 'latest'>('top');
  const [composeOpen, setComposeOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [likeBusy, setLikeBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const showToast = useCallback((text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2200);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, myLikes] = await Promise.all([
        fetchFeedback({ status: statusFilter, sort, limit: 100 }),
        user ? fetchMyFeedbackUpvotes() : Promise.resolve(new Set<string>()),
      ]);
      setPosts(list.map(p => ({ ...p, liked_by_me: myLikes.has(p.id) })));
    } catch (e) {
      console.warn('[feedback] load fail', e);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, sort, user]);

  useEffect(() => { load(); }, [load]);

  const handleUpvote = async (p: FeedbackPost) => {
    if (!user) { showToast('로그인이 필요해요', 'warn'); return; }
    if (likeBusy === p.id) return;
    setLikeBusy(p.id);
    const wasLiked = !!p.liked_by_me;
    setPosts(prev => prev.map(x => x.id === p.id ? {
      ...x,
      liked_by_me: !wasLiked,
      upvote_count: x.upvote_count + (wasLiked ? -1 : 1),
    } : x));
    try {
      await toggleFeedbackUpvote(p.id);
    } catch (e) {
      setPosts(prev => prev.map(x => x.id === p.id ? {
        ...x,
        liked_by_me: wasLiked,
        upvote_count: x.upvote_count + (wasLiked ? 1 : -1),
      } : x));
      showToast(e instanceof Error ? e.message : '실패', 'warn');
    } finally {
      setLikeBusy(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('내 글을 삭제할까요?')) return;
    try {
      await deleteMyFeedback(id);
      setPosts(prev => prev.filter(p => p.id !== id));
      showToast('삭제됨');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '삭제 실패', 'warn');
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="max-w-lg mx-auto pb-24 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/85 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="px-3 py-3 flex items-center gap-2">
          <Link href="/profile" className="w-10 h-10 flex items-center justify-center rounded-full active:bg-[var(--card-border)]/30">
            <ArrowLeft size={20} />
          </Link>
          <AppLogo size={24} />
          <h1 className="text-lg font-extrabold tracking-tight">제안 / 버그 게시판</h1>
        </div>
        <div className="px-4 pb-3 flex items-center gap-2 overflow-x-auto scrollbar-hide">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap active:scale-95 transition ${
                statusFilter === f.id
                  ? 'bg-emerald-500 text-white shadow'
                  : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="text-[var(--card-border)] px-1">|</span>
          {SORT_OPTIONS.map(o => (
            <button
              key={o.id}
              onClick={() => setSort(o.id)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap active:scale-95 transition ${
                sort === o.id
                  ? 'bg-[var(--foreground)] text-[var(--background)]'
                  : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </header>

      <div className="p-4 space-y-3">
        {/* 안내 카드 */}
        <div className="rounded-2xl bg-gradient-to-br from-emerald-50/80 via-white to-emerald-50/30 dark:from-emerald-950/30 dark:via-zinc-900 dark:to-emerald-950/10 border border-emerald-200/50 dark:border-emerald-900/40 p-4">
          <p className="text-sm font-extrabold text-emerald-700 dark:text-emerald-300 mb-1">
            서비스를 더 나아지게 도와주세요
          </p>
          <p className="text-xs text-[var(--muted)] leading-relaxed">
            버그·기능·UI 어떤 제안이든 환영해요. 좋아요가 많이 모인 글은 우선 검토합니다.
            <br />반영되면 운영자가 직접 답글로 알려드려요.
          </p>
        </div>

        {loading ? (
          [0, 1, 2, 3].map(i => <div key={i} className="card p-4 h-28 animate-pulse" />)
        ) : posts.length === 0 ? (
          <div className="text-center py-16 px-6">
            <div className="w-16 h-16 rounded-full bg-emerald-50 dark:bg-emerald-950/30 mx-auto mb-3 flex items-center justify-center">
              <MessageSquare size={28} className="text-emerald-500" />
            </div>
            <p className="text-base font-extrabold mb-1">아직 글이 없어요</p>
            <p className="text-sm text-[var(--muted)]">첫 제안을 남겨주세요</p>
          </div>
        ) : (
          posts.map(p => {
            const Icon = CATEGORY_ICONS[p.category];
            const isMine = user?.id === p.user_id;
            const isOpen = expanded.has(p.id);
            return (
              <article key={p.id} className="card p-4">
                <div className="flex items-start gap-2.5 mb-2">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${CATEGORY_COLORS[p.category]}`}>
                    <Icon size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-[var(--card-border)]/40 text-[var(--muted)]">
                        {CATEGORY_LABEL[p.category]}
                      </span>
                      <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${STATUS_COLOR[p.status]}`}>
                        {STATUS_LABEL[p.status]}
                      </span>
                      {!p.is_public && (
                        <span className="text-[10px] font-bold inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[var(--muted)]">
                          <Lock size={9} /> 비공개
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-extrabold mt-1 text-[var(--foreground)] leading-snug">{p.title}</p>
                    <p className="text-[11px] text-[var(--muted)] mt-0.5">
                      {p.author_name} · {timeAgo(p.created_at)}
                    </p>
                  </div>
                </div>

                <p className={`text-sm text-[var(--foreground)] leading-relaxed whitespace-pre-wrap break-keep ${isOpen ? '' : 'line-clamp-3'}`}>
                  {p.body}
                </p>
                {p.body.length > 100 && (
                  <button
                    onClick={() => toggleExpand(p.id)}
                    className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mt-1"
                  >
                    {isOpen ? '접기' : '더 보기'}
                  </button>
                )}

                {/* 어드민 답글 */}
                {p.admin_reply && (
                  <div className="mt-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-900/40 p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center">
                        <Check size={11} className="text-white" />
                      </div>
                      <span className="text-[11px] font-extrabold text-emerald-700 dark:text-emerald-300">운영자 답글</span>
                      {p.admin_replied_at && (
                        <span className="text-[10px] text-[var(--muted)]">· {timeAgo(p.admin_replied_at)}</span>
                      )}
                    </div>
                    <p className="text-sm text-emerald-900 dark:text-emerald-100 leading-relaxed whitespace-pre-wrap break-keep">
                      {p.admin_reply}
                    </p>
                  </div>
                )}

                <div className="mt-3 flex items-center gap-1">
                  <button
                    onClick={() => handleUpvote(p)}
                    disabled={likeBusy === p.id}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold transition active:scale-95 disabled:opacity-50 ${
                      p.liked_by_me
                        ? 'bg-emerald-500 text-white'
                        : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
                    }`}
                  >
                    <ThumbsUp size={14} fill={p.liked_by_me ? '#ffffff' : 'transparent'} />
                    {p.upvote_count}
                  </button>
                  {isMine && (
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs text-rose-600 dark:text-rose-400 font-semibold active:scale-95"
                    >
                      <Trash2 size={11} /> 삭제
                    </button>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>

      {/* FAB */}
      <button
        onClick={() => {
          if (!user) { showToast('로그인이 필요해요', 'warn'); return; }
          setComposeOpen(true);
        }}
        aria-label="제안 쓰기"
        className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+88px)] z-30 px-4 py-3 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold shadow-xl shadow-emerald-500/40 active:scale-95 inline-flex items-center gap-1.5"
      >
        <Plus size={18} /> 쓰기
      </button>

      {composeOpen && (
        <ComposeModal
          onClose={() => setComposeOpen(false)}
          onCreated={() => { setComposeOpen(false); load(); showToast('✨ 제안이 등록됐어요'); }}
          onError={(msg) => showToast(msg, 'warn')}
        />
      )}

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2200} />}
    </div>
  );
}

function ComposeModal({ onClose, onCreated, onError }: {
  onClose: () => void;
  onCreated: () => void;
  onError: (msg: string) => void;
}) {
  const [category, setCategory] = useState<FeedbackCategory>('bug');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const t = title.trim();
    const b = body.trim();
    if (t.length < 2) { onError('제목이 너무 짧아요'); return; }
    if (b.length < 5) { onError('내용이 너무 짧아요'); return; }
    setSubmitting(true);
    try {
      await createFeedback(category, t, b, isPublic);
      onCreated();
    } catch (e) {
      onError(e instanceof Error ? e.message : '등록 실패');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/65 flex items-end sm:items-center justify-center p-3 animate-[fadeIn_0.2s_ease-out]"
      onClick={() => !submitting && onClose()}
    >
      <div className="w-full max-w-md bg-[var(--background)] rounded-3xl p-5 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-base font-extrabold inline-flex items-center gap-1.5">
            <MessageSquare size={16} className="text-emerald-500" /> 제안 쓰기
          </h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--card-border)]/40 active:scale-90">
            <X size={16} />
          </button>
        </div>

        <label className="block text-xs font-bold text-[var(--muted)] mb-1">카테고리</label>
        <div className="grid grid-cols-4 gap-1.5">
          {(['bug', 'feature', 'ui', 'other'] as FeedbackCategory[]).map(c => {
            const Icon = CATEGORY_ICONS[c];
            const active = category === c;
            return (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`flex flex-col items-center gap-1 py-2.5 rounded-xl font-bold text-[11px] active:scale-95 transition ${
                  active ? 'bg-emerald-500 text-white shadow' : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
                }`}
              >
                <Icon size={14} />
                {CATEGORY_LABEL[c]}
              </button>
            );
          })}
        </div>

        <label className="block text-xs font-bold text-[var(--muted)] mt-3 mb-1">제목</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 120))}
          placeholder="한 줄로 요약해주세요"
          className="w-full px-3.5 py-2.5 rounded-xl border-2 border-[var(--card-border)] bg-[var(--background)] text-sm focus:outline-none focus:border-emerald-500"
        />

        <label className="block text-xs font-bold text-[var(--muted)] mt-3 mb-1">내용</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, 4000))}
          rows={6}
          placeholder={
            category === 'bug'
              ? '어떤 화면에서 / 어떻게 했을 때 / 어떻게 됐는지 알려주세요'
              : category === 'feature'
              ? '어떤 기능이 / 왜 / 어디서 필요한지 알려주세요'
              : '자유롭게 의견을 들려주세요'
          }
          className="w-full px-3.5 py-3 rounded-xl border-2 border-[var(--card-border)] bg-[var(--background)] text-sm focus:outline-none focus:border-emerald-500 resize-none"
        />
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-[var(--muted)]">{body.length}/4000</span>
        </div>

        <label className="flex items-start gap-2.5 mt-3 cursor-pointer">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            className="mt-0.5"
          />
          <div className="flex-1">
            <p className="text-sm font-bold inline-flex items-center gap-1">
              {isPublic ? <Globe size={13} className="text-emerald-500" /> : <Lock size={13} className="text-[var(--muted)]" />}
              {isPublic ? '공개로 등록' : '비공개 (나와 운영자만)'}
            </p>
            <p className="text-[11px] text-[var(--muted)] mt-0.5 leading-snug">
              공개로 등록하면 다른 러너가 좋아요를 누를 수 있어요. 같은 의견이 모이면 우선 반영됩니다.
            </p>
          </div>
        </label>

        <button
          onClick={handleSubmit}
          disabled={submitting || title.trim().length < 2 || body.trim().length < 5}
          className="w-full mt-4 py-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-sm disabled:opacity-50 active:scale-[0.98] inline-flex items-center justify-center gap-1.5"
        >
          {submitting ? '등록 중…' : <><Check size={16} /> 등록</>}
        </button>
      </div>
    </div>
  );
}
