'use client';

// 제안/버그 게시판 (build 107) — 유저가 직접 버그/기능 요청 남기는 공개 게시판.
// 어드민은 /admin/feedback 에서 상태 변경 + 답글.

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft, ThumbsUp, MessageSquare, Bug, Sparkles, Layout, HelpCircle, Plus, X, Check, Trash2, Lock, Globe, Flag, ImagePlus } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import AppLogo from '@/components/AppLogo';
import AppToast from '@/components/AppToast';
import { track } from '@/lib/analytics';
import { useI18n } from '@/lib/i18n';
import {
  fetchFeedback,
  fetchMyFeedbackUpvotes,
  toggleFeedbackUpvote,
  createFeedback,
  uploadFeedbackImage,
  deleteMyFeedback,
  reportFeedback,
  adminUpdateFeedback,
  CATEGORY_LABEL,
  STATUS_LABEL,
  STATUS_COLOR,
  type FeedbackPost,
  type FeedbackCategory,
  type FeedbackStatus,
  type FeedbackReportReason,
} from '@/lib/feedback-data';
import { isAdminEmail } from '@/lib/admin-emails';

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

function timeAgo(iso: string, locale: 'ko' | 'en' = 'ko'): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (locale === 'en') {
    if (ms < 60_000) return 'now';
    if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m`;
    if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h`;
    if (ms < 30 * 86400_000) return `${Math.floor(ms / 86400_000)}d`;
    return `${Math.floor(ms / (30 * 86400_000))}mo`;
  }
  if (ms < 60_000) return '방금';
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}분`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}시간`;
  if (ms < 30 * 86400_000) return `${Math.floor(ms / 86400_000)}일`;
  return `${Math.floor(ms / (30 * 86400_000))}달`;
}

export default function FeedbackPage() {
  const { user } = useAuth();
  const { tt, locale } = useI18n();
  const [posts, setPosts] = useState<FeedbackPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | 'all'>('all');
  const [sort, setSort] = useState<'top' | 'latest'>('top');
  const [composeOpen, setComposeOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [likeBusy, setLikeBusy] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<FeedbackPost | null>(null);
  const [reporting, setReporting] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  // build 259: 어드민이 일반 게시판에서 인라인으로 답변 작성. /admin/feedback 거치지 않고 빠르게.
  const isAdmin = isAdminEmail(user?.email);
  const [adminReplyDraft, setAdminReplyDraft] = useState<Record<string, string>>({});
  const [adminReplyBusy, setAdminReplyBusy] = useState<string | null>(null);

  const showToast = useCallback((text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2200);
  }, []);

  const handleAdminReply = useCallback(async (post: FeedbackPost) => {
    const draft = (adminReplyDraft[post.id] ?? '').trim();
    if (!draft) return;
    setAdminReplyBusy(post.id);
    try {
      // 상태는 그대로 (open 이면 open) 유지하고 답글만 추가. 어드민이 페이지에서 빠르게 답변.
      await adminUpdateFeedback(post.id, post.status, draft);
      setPosts(prev => prev.map(p => p.id === post.id ? { ...p, admin_reply: draft, admin_replied_at: new Date().toISOString() } : p));
      setAdminReplyDraft(prev => { const next = { ...prev }; delete next[post.id]; return next; });
      showToast(tt('답글이 저장됐어요'));
    } catch (e) {
      showToast(tt('답글 저장 실패: ') + (e instanceof Error ? e.message : ''), 'warn');
    } finally {
      setAdminReplyBusy(null);
    }
  }, [adminReplyDraft, showToast, tt]);

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
    if (!user) { showToast(tt('로그인이 필요해요'), 'warn'); return; }
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
      showToast(e instanceof Error ? e.message : tt('실패'), 'warn');
    } finally {
      setLikeBusy(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(tt('내 글을 삭제할까요?'))) return;
    try {
      await deleteMyFeedback(id);
      setPosts(prev => prev.filter(p => p.id !== id));
      showToast(tt('삭제됨'));
    } catch (e) {
      showToast(e instanceof Error ? e.message : tt('삭제 실패'), 'warn');
    }
  };

  const handleReport = async (reason: FeedbackReportReason) => {
    if (!reportTarget) return;
    setReporting(true);
    try {
      await reportFeedback(reportTarget.id, reason);
      showToast(tt('신고가 접수됐어요. 24시간 안에 검토합니다'));
    } catch (e) {
      showToast(e instanceof Error ? e.message : tt('신고 실패'), 'warn');
    } finally {
      setReporting(false);
      setReportTarget(null);
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
          <AppLogo size={26} />
          <h1 className="text-xl font-extrabold tracking-tight">{tt('앱 기능 제안 게시판')}</h1>
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
              {tt(f.label)}
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
              {tt(o.label)}
            </button>
          ))}
        </div>
      </header>

      <div className="p-4 space-y-3">
        {/* 안내 카드 — 에메랄드 히어로 */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-500 via-emerald-500 to-teal-600 p-5 shadow-lg shadow-emerald-500/30">
          <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/10 blur-2xl" />
          <div className="relative">
            <p className="text-base font-extrabold text-white mb-1.5">
              {tt('서비스를 더 나아지게 도와주세요')}
            </p>
            <p className="text-xs text-white/90 leading-relaxed">
              {tt('버그·기능·UI 어떤 제안이든 환영해요. 좋아요가 모이면 우선 검토하고, 운영자가 직접 답글로 진행 상황을 알려드려요.')}
            </p>
          </div>
        </div>

        {loading ? (
          [0, 1, 2, 3].map(i => <div key={i} className="card p-4 h-28 animate-pulse" />)
        ) : posts.length === 0 ? (
          <div className="text-center py-16 px-6">
            <div className="w-16 h-16 rounded-full bg-emerald-50 dark:bg-emerald-950/30 mx-auto mb-3 flex items-center justify-center">
              <MessageSquare size={28} className="text-emerald-500" />
            </div>
            <p className="text-base font-extrabold mb-1">{tt('아직 글이 없어요')}</p>
            <p className="text-sm text-[var(--muted)]">{tt('첫 제안을 남겨주세요')}</p>
          </div>
        ) : (
          posts.map(p => {
            const Icon = CATEGORY_ICONS[p.category];
            const isMine = user?.id === p.user_id;
            const isOpen = expanded.has(p.id);
            return (
              <article key={p.id} className="rounded-2xl bg-[var(--card)] border border-[var(--card-border)] p-5">
                <div className="flex items-start gap-3 mb-2.5">
                  <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 ${CATEGORY_COLORS[p.category]}`}>
                    <Icon size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11px] font-extrabold px-2 py-0.5 rounded-full bg-[var(--card-border)]/40 text-[var(--muted)]">
                        {tt(CATEGORY_LABEL[p.category])}
                      </span>
                      <span className={`text-[11px] font-extrabold px-2 py-0.5 rounded-full ${STATUS_COLOR[p.status]}`}>
                        {tt(STATUS_LABEL[p.status])}
                      </span>
                      {!p.is_public && (
                        <span className="text-[10px] font-bold inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[var(--muted)]">
                          <Lock size={9} /> {tt('비공개')}
                        </span>
                      )}
                    </div>
                    <p className="text-[17px] font-extrabold mt-1.5 text-[var(--foreground)] leading-snug break-keep">{p.title}</p>
                    <p className="text-xs text-[var(--muted)] mt-1 font-medium">
                      {p.author_name} <span className="text-[var(--card-border)]">·</span> {timeAgo(p.created_at, locale)}
                    </p>
                  </div>
                </div>

                <p className={`text-[15px] text-[var(--foreground)] leading-relaxed whitespace-pre-wrap break-keep ${isOpen ? '' : 'line-clamp-3'}`}>
                  {p.body}
                </p>
                {p.body.length > 100 && (
                  <button
                    onClick={() => toggleExpand(p.id)}
                    className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400 mt-1.5 active:scale-95"
                  >
                    {isOpen ? (locale === 'en' ? 'Collapse ↑' : '접기 ↑') : (locale === 'en' ? 'Read more ↓' : '더 보기 ↓')}
                  </button>
                )}

                {/* build 172.1 #5C: 첨부 이미지 표시 */}
                {p.image_url && (
                  <div className="mt-3 rounded-2xl overflow-hidden border border-[var(--card-border)]/40 bg-[var(--card)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.image_url}
                      alt={tt('첨부')}
                      className="w-full max-h-[420px] object-contain cursor-pointer"
                      onClick={() => window.open(p.image_url!, '_blank', 'noopener')}
                    />
                  </div>
                )}

                {/* 어드민 답글 — 에메랄드 톤 강화 */}
                {p.admin_reply && (
                  <div className="mt-3.5 rounded-2xl bg-gradient-to-br from-emerald-50 to-emerald-50/50 dark:from-emerald-950/40 dark:to-emerald-950/20 border-2 border-emerald-200/60 dark:border-emerald-800/40 p-3.5">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-sm">
                        <Check size={13} className="text-white" strokeWidth={3} />
                      </div>
                      <span className="text-xs font-extrabold text-emerald-700 dark:text-emerald-300">{tt('운영자 답글')}</span>
                      {p.admin_replied_at && (
                        <span className="text-[10px] text-[var(--muted)]">· {timeAgo(p.admin_replied_at, locale)}</span>
                      )}
                    </div>
                    <p className="text-[14px] text-emerald-900 dark:text-emerald-100 leading-relaxed whitespace-pre-wrap break-keep">
                      {p.admin_reply}
                    </p>
                  </div>
                )}

                {/* build 259: 어드민이 답글 없는 게시글에 인라인으로 빠르게 답변. /admin/feedback 거치지 않음. */}
                {isAdmin && !p.admin_reply && (
                  <div className="mt-3.5 rounded-2xl border-2 border-dashed border-emerald-300/50 dark:border-emerald-700/40 bg-emerald-50/30 dark:bg-emerald-950/15 p-3.5">
                    <div className="flex items-center gap-1.5 mb-2">
                      <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                        <MessageSquare size={11} className="text-emerald-600" strokeWidth={2.5} />
                      </div>
                      <span className="text-xs font-extrabold text-emerald-700 dark:text-emerald-300">{tt('운영자 답글 작성')}</span>
                    </div>
                    <textarea
                      value={adminReplyDraft[p.id] ?? ''}
                      onChange={(e) => setAdminReplyDraft(prev => ({ ...prev, [p.id]: e.target.value }))}
                      placeholder={tt('사용자에게 답변을 작성해주세요')}
                      rows={3}
                      className="w-full text-[14px] rounded-xl border border-[var(--card-border)] bg-[var(--background)] px-3 py-2 resize-none focus:outline-none focus:border-emerald-400"
                    />
                    <div className="mt-2 flex justify-end">
                      <button
                        onClick={() => handleAdminReply(p)}
                        disabled={!adminReplyDraft[p.id]?.trim() || adminReplyBusy === p.id}
                        className="px-4 py-1.5 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-sm font-extrabold shadow-md shadow-emerald-500/20 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {adminReplyBusy === p.id ? tt('저장 중...') : tt('답글 저장')}
                      </button>
                    </div>
                  </div>
                )}

                <div className="mt-3.5 flex items-center gap-1.5">
                  <button
                    onClick={() => handleUpvote(p)}
                    disabled={likeBusy === p.id}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-extrabold transition active:scale-95 disabled:opacity-50 ${
                      p.liked_by_me
                        ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-500/30'
                        : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
                    }`}
                  >
                    <ThumbsUp size={15} fill={p.liked_by_me ? '#ffffff' : 'transparent'} strokeWidth={2.2} />
                    {p.upvote_count}
                  </button>
                  {isMine ? (
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs text-rose-600 dark:text-rose-400 font-semibold active:scale-95"
                    >
                      <Trash2 size={11} /> {tt('삭제')}
                    </button>
                  ) : user ? (
                    <button
                      onClick={() => setReportTarget(p)}
                      className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs text-[var(--muted)] font-semibold active:scale-95"
                      aria-label={tt('신고')}
                    >
                      <Flag size={11} /> {tt('신고')}
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })
        )}
      </div>

      {/* FAB — 큼직하고 또렷한 에메랄드 CTA */}
      <button
        onClick={() => {
          if (!user) { showToast(tt('로그인이 필요해요'), 'warn'); return; }
          setComposeOpen(true);
        }}
        aria-label={tt('제안 쓰기')}
        className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+88px)] z-30 px-5 py-3.5 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-base shadow-xl shadow-emerald-500/40 active:scale-95 inline-flex items-center gap-2 transition"
      >
        <Plus size={20} strokeWidth={3} /> {tt('제안 쓰기')}
      </button>

      {composeOpen && (
        <ComposeModal
          onClose={() => setComposeOpen(false)}
          onCreated={() => { setComposeOpen(false); load(); showToast(tt('✨ 제안이 등록됐어요')); }}
          onError={(msg) => showToast(msg, 'warn')}
        />
      )}

      {/* 신고 다이얼로그 (Apple 1.2 UGC) */}
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
              <h3 className="text-base font-bold">{tt('게시글 신고')}</h3>
              <p className="text-xs text-[var(--muted)] text-center leading-relaxed">
                {tt('신고 사유를 선택해주세요. 3회 누적되면 자동 숨김 처리되며 24시간 안에 운영자가 검토합니다.')}
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
                  disabled={reporting}
                  className="w-full px-3 py-3 rounded-xl bg-[var(--card-border)]/30 text-sm font-semibold disabled:opacity-50 active:bg-[var(--card-border)]/60"
                >
                  {tt(opt.label)}
                </button>
              ))}
            </div>
            <button
              onClick={() => setReportTarget(null)}
              disabled={reporting}
              className="w-full mt-3 py-2.5 text-sm text-[var(--muted)] disabled:opacity-50"
            >
              {tt('취소')}
            </button>
          </div>
        </div>
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
  const { user } = useAuth();
  const { tt, locale } = useI18n();
  const [category, setCategory] = useState<FeedbackCategory>('bug');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // build 172.1 #5C: 이미지 첨부 (1장)
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) { onError(tt('이미지 파일만 첨부할 수 있어요')); return; }
    if (f.size > 10 * 1024 * 1024) { onError(tt('이미지가 10MB 보다 커요')); return; }
    setImageFile(f);
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(f);
  };

  const clearImage = () => {
    setImageFile(null); setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async () => {
    const t = title.trim();
    const b = body.trim();
    if (t.length < 2) { onError(tt('제목이 너무 짧아요')); return; }
    if (b.length < 5) { onError(tt('내용이 너무 짧아요')); return; }
    setSubmitting(true);
    try {
      // 이미지 있으면 먼저 업로드 후 URL 받아 createFeedback 에 전달
      let imageUrl: string | null = null;
      if (imageFile && user) {
        try {
          imageUrl = await uploadFeedbackImage(user.id, imageFile);
        } catch (e) {
          const reason = e instanceof Error ? e.message.slice(0, 80) : tt('알 수 없는 오류');
          onError(`${tt('이미지 업로드 실패')} — ${reason}`);
          setSubmitting(false);
          return;
        }
      }
      await createFeedback(category, t, b, isPublic, imageUrl);
      track('feedback_create', { category, is_public: isPublic, body_length: b.length, has_image: !!imageUrl });
      onCreated();
    } catch (e) {
      onError(e instanceof Error ? e.message : tt('등록 실패'));
    } finally {
      setSubmitting(false);
    }
  };

  // 모바일 작성 최적화 (build 172.1 #5):
  // - max-h-[92dvh] (iOS Safari 키보드 대응 — dvh 가 vh 보다 정확)
  // - sticky CTA 제거 → flex flex-col 의 마지막 자식으로 자연 배치 (가림 회귀 fix)
  // - 본문은 flex-1 + min-h-0 + overflow-y-auto (flex 내부 스크롤 안전 패턴)
  return (
    <div
      className="fixed inset-0 z-[80] bg-black/65 flex items-end sm:items-center justify-center sm:p-3 animate-[fadeIn_0.2s_ease-out]"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="w-full sm:max-w-lg bg-[var(--background)] rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 — flex-shrink-0, 에메랄드 그라데이션 액센트 */}
        <div className="flex-shrink-0 px-5 pt-4 pb-3 bg-[var(--background)] border-b border-emerald-100 dark:border-emerald-950/40 rounded-t-3xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-100 to-emerald-50 dark:from-emerald-900/40 dark:to-emerald-950/40 flex items-center justify-center">
                <MessageSquare size={18} className="text-emerald-600" />
              </div>
              <div>
                <h3 className="text-lg font-extrabold tracking-tight">{tt('제안 쓰기')}</h3>
                <p className="text-[11px] text-[var(--muted)]">{tt('의견을 들려주세요')}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-[var(--card-border)]/40 active:scale-90 transition"
              aria-label={tt('닫기')}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* 본문 — flex-1 + min-h-0 (flex 내부 overflow 안전 패턴) */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">
          {/* 카테고리 — 2x2 grid, 큰 카드 */}
          <div>
            <label className="block text-sm font-extrabold text-[var(--foreground)] mb-2">{tt('카테고리')}</label>
            <div className="grid grid-cols-2 gap-2">
              {(['bug', 'feature', 'ui', 'other'] as FeedbackCategory[]).map(c => {
                const Icon = CATEGORY_ICONS[c];
                const active = category === c;
                return (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    className={`flex items-center gap-2.5 py-3.5 px-4 rounded-2xl font-bold text-sm active:scale-95 transition border-2 ${
                      active
                        ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white border-transparent shadow-md shadow-emerald-500/30'
                        : 'bg-[var(--card)] text-[var(--foreground)] border-[var(--card-border)]'
                    }`}
                  >
                    <Icon size={18} className={active ? 'text-white' : 'text-emerald-500'} />
                    {tt(CATEGORY_LABEL[c])}
                  </button>
                );
              })}
            </div>
          </div>

          {/* build 173.1 #2: 이미지 첨부 — 카테고리 다음 (스크롤 안 해도 노출). compact 형태 */}
          <div>
            <label className="block text-sm font-extrabold text-[var(--foreground)] mb-2">
              {tt('사진 첨부')} <span className="text-[11px] text-[var(--muted)] font-medium">{tt('(선택 · 캡쳐 화면 첨부 가능)')}</span>
            </label>
            {imagePreview ? (
              <div className="relative rounded-2xl overflow-hidden border-2 border-emerald-200/60 dark:border-emerald-800/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagePreview} alt={tt('첨부 이미지')} className="w-full max-h-[220px] object-contain bg-[var(--card)]" />
                <button
                  type="button"
                  onClick={clearImage}
                  className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/65 text-white flex items-center justify-center active:scale-90 shadow-md"
                  aria-label={tt('첨부 이미지 제거')}
                >
                  <X size={16} strokeWidth={2.5} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-3.5 rounded-2xl border-2 border-dashed border-emerald-300/60 bg-emerald-50/30 dark:bg-emerald-950/15 text-emerald-700 dark:text-emerald-300 font-bold text-sm active:scale-[0.99] inline-flex items-center justify-center gap-2 hover:border-emerald-400 hover:bg-emerald-50/60 transition"
              >
                <ImagePlus size={20} />
                {tt('캡쳐 화면 / 사진 첨부하기')}
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImagePick}
              className="hidden"
            />
          </div>

          {/* 제목 — 큰 input */}
          <div>
            <label className="block text-sm font-extrabold text-[var(--foreground)] mb-2">{tt('제목')}</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 120))}
              placeholder={tt('한 줄로 요약해주세요')}
              className="w-full px-4 py-4 rounded-2xl border-2 border-[var(--card-border)] bg-[var(--card)] text-[17px] font-semibold focus:outline-none focus:border-emerald-500 focus:bg-emerald-50/40 dark:focus:bg-emerald-950/20 transition placeholder:text-[var(--muted)] placeholder:font-normal"
            />
            <p className="text-[11px] text-[var(--muted)] mt-1.5 px-1">{title.length}/120</p>
          </div>

          {/* 내용 — 큰 textarea */}
          <div>
            <label className="block text-sm font-extrabold text-[var(--foreground)] mb-2">{tt('내용')}</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, 4000))}
              rows={9}
              placeholder={
                locale === 'en'
                  ? (
                      category === 'bug'
                        ? 'Which screen\nWhat you did\nWhat happened\n\nThe more specific, the faster we can fix it'
                        : category === 'feature'
                        ? 'What feature\nWhy you need it\nWhere you would use it\n\nFeel free to share'
                        : category === 'ui'
                        ? 'Which screen\nWhich part\nHow it could be improved'
                        : 'Share your thoughts freely'
                    )
                  : (
                      category === 'bug'
                        ? '어떤 화면에서\n어떻게 했을 때\n어떻게 됐는지\n\n구체적으로 알려주시면 빠르게 고칠 수 있어요'
                        : category === 'feature'
                        ? '어떤 기능이\n왜 필요한지\n어디서 쓰고 싶은지\n\n자유롭게 들려주세요'
                        : category === 'ui'
                        ? '어떤 화면의\n어떤 부분이\n어떻게 개선되면 좋을지'
                        : '자유롭게 의견을 들려주세요'
                    )
              }
              className="w-full px-4 py-4 rounded-2xl border-2 border-[var(--card-border)] bg-[var(--card)] text-[17px] leading-relaxed focus:outline-none focus:border-emerald-500 focus:bg-emerald-50/40 dark:focus:bg-emerald-950/20 transition resize-none placeholder:text-[var(--muted)] placeholder:text-[15px] placeholder:leading-relaxed"
            />
            <div className="flex justify-between mt-1.5 px-1">
              <span className="text-[11px] text-[var(--muted)]">{body.length}/4000</span>
              {body.length >= 5 && (
                <span className="text-[11px] text-emerald-600 font-bold inline-flex items-center gap-0.5">
                  <Check size={11} /> {tt('충분히 적었어요')}
                </span>
              )}
            </div>
          </div>

          {/* 공개여부 — 큰 toggle 카드 */}
          <button
            type="button"
            onClick={() => setIsPublic(!isPublic)}
            className={`w-full flex items-start gap-3 p-4 rounded-2xl border-2 text-left active:scale-[0.99] transition ${
              isPublic
                ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-300/60 dark:border-emerald-800/40'
                : 'bg-[var(--card)] border-[var(--card-border)]'
            }`}
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
              isPublic
                ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white'
                : 'bg-[var(--card-border)]/40 text-[var(--muted)]'
            }`}>
              {isPublic ? <Globe size={18} /> : <Lock size={18} />}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-extrabold ${isPublic ? 'text-emerald-700 dark:text-emerald-300' : 'text-[var(--foreground)]'}`}>
                {isPublic ? tt('공개로 등록') : tt('비공개 (나·운영자만)')}
              </p>
              <p className="text-[12px] text-[var(--muted)] mt-0.5 leading-snug">
                {isPublic
                  ? tt('다른 러너가 좋아요를 누를 수 있어요. 같은 의견이 모이면 우선 반영됩니다.')
                  : tt('공개 게시판에는 노출되지 않아요. 운영자만 볼 수 있어요.')}
              </p>
            </div>
            <div className={`w-11 h-6 rounded-full flex-shrink-0 mt-1 transition relative ${
              isPublic ? 'bg-gradient-to-r from-emerald-500 to-emerald-600' : 'bg-[var(--card-border)]'
            }`}>
              <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
                isPublic ? 'left-[22px]' : 'left-0.5'
              }`} />
            </div>
          </button>

        </div>

        {/* CTA — flex 마지막 자식 (sticky 제거). 가려짐 회귀 fix. safe-area 만 추가 */}
        <div className="flex-shrink-0 px-5 py-4 bg-[var(--background)] border-t border-[var(--card-border)]/40" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}>
          <button
            onClick={handleSubmit}
            disabled={submitting || title.trim().length < 2 || body.trim().length < 5}
            className="w-full py-4 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-base disabled:opacity-50 active:scale-[0.98] inline-flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/30 transition"
          >
            {submitting ? (
              <>
                <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                {tt('등록 중…')}
              </>
            ) : (
              <><Check size={18} strokeWidth={3} /> {tt('등록')}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
