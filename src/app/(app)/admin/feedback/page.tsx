'use client';

// 어드민 — 제안/버그 게시판 모더레이션 (build 107).
// 비공개 글도 모두 조회 + 상태 변경 + 답글 작성.

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, MessageSquare, ThumbsUp, Check, Lock, Globe, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { isAdminEmail } from '@/lib/admin-emails';
import {
  fetchFeedback,
  adminUpdateFeedback,
  CATEGORY_LABEL,
  STATUS_LABEL,
  STATUS_COLOR,
  type FeedbackPost,
  type FeedbackStatus,
} from '@/lib/feedback-data';
import AppToast from '@/components/AppToast';

const STATUS_OPTIONS: { id: FeedbackStatus; label: string }[] = [
  { id: 'open', label: '접수됨' },
  { id: 'reviewing', label: '검토 중' },
  { id: 'done', label: '완료' },
  { id: 'wont_fix', label: '보류' },
];

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 3600_000) return `${Math.floor(ms / 60_000) || 1}분 전`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}시간 전`;
  return `${Math.floor(ms / 86400_000)}일 전`;
}

export default function AdminFeedbackPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const [posts, setPosts] = useState<FeedbackPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | 'all'>('open');
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, { status: FeedbackStatus; reply: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !isAdmin) { router.replace('/'); return; }
  }, [authLoading, user, isAdmin, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchFeedback({ status: statusFilter, sort: 'latest', limit: 200 });
      setPosts(list);
    } catch (e) {
      console.warn('[admin/feedback] fail', e);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const toggle = (p: FeedbackPost) => {
    setOpened(prev => {
      const next = new Set(prev);
      if (next.has(p.id)) next.delete(p.id);
      else {
        next.add(p.id);
        if (!drafts[p.id]) setDrafts(d => ({ ...d, [p.id]: { status: p.status, reply: p.admin_reply ?? '' } }));
      }
      return next;
    });
  };

  const save = async (p: FeedbackPost) => {
    const d = drafts[p.id];
    if (!d) return;
    setSaving(p.id);
    try {
      await adminUpdateFeedback(p.id, d.status, d.reply.trim() || null);
      setToast({ text: '✨ 저장됨', tone: 'ok' });
      await load();
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : '저장 실패', tone: 'warn' });
    } finally {
      setSaving(null);
      setTimeout(() => setToast(null), 2200);
    }
  };

  if (!isAdmin) return null;

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/85 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <Link href="/admin" className="w-10 h-10 flex items-center justify-center rounded-full active:bg-[var(--card-border)]/30">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-xl font-extrabold tracking-tight inline-flex items-center gap-1.5">
            <MessageSquare size={18} className="text-emerald-500" /> 제안 모더레이션
          </h1>
        </div>
        <div className="px-4 pb-3 flex items-center gap-2 overflow-x-auto scrollbar-hide">
          {(['all', ...STATUS_OPTIONS.map(s => s.id)] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap active:scale-95 ${
                statusFilter === s
                  ? 'bg-emerald-500 text-white shadow'
                  : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
              }`}
            >
              {s === 'all' ? '전체' : STATUS_LABEL[s as FeedbackStatus]}
            </button>
          ))}
        </div>
      </header>

      <div className="p-4 space-y-2">
        {loading ? (
          [0, 1, 2].map(i => <div key={i} className="card p-4 h-24 animate-pulse" />)
        ) : posts.length === 0 ? (
          <div className="text-center py-16 text-sm text-[var(--muted)]">없음</div>
        ) : (
          posts.map(p => {
            const isOpen = opened.has(p.id);
            const d = drafts[p.id] ?? { status: p.status, reply: p.admin_reply ?? '' };
            return (
              <article key={p.id} className="card p-4">
                <button onClick={() => toggle(p)} className="w-full text-left">
                  <div className="flex items-start gap-2 mb-1">
                    <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${STATUS_COLOR[p.status]}`}>
                      {STATUS_LABEL[p.status]}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--card-border)]/40 text-[var(--muted)]">
                      {CATEGORY_LABEL[p.category]}
                    </span>
                    {p.is_public ? (
                      <Globe size={11} className="text-emerald-500 ml-0.5" />
                    ) : (
                      <Lock size={11} className="text-[var(--muted)] ml-0.5" />
                    )}
                    <span className="ml-auto inline-flex items-center gap-1 text-xs text-[var(--muted)]">
                      <ThumbsUp size={11} /> {p.upvote_count}
                    </span>
                    {isOpen ? <ChevronUp size={14} className="text-[var(--muted)]" /> : <ChevronDown size={14} className="text-[var(--muted)]" />}
                  </div>
                  <p className="text-sm font-extrabold text-[var(--foreground)] leading-snug">{p.title}</p>
                  <p className="text-[11px] text-[var(--muted)] mt-0.5">
                    {p.author_name} · {timeAgo(p.created_at)}
                  </p>
                </button>

                {isOpen && (
                  <div className="mt-3 pt-3 border-t border-[var(--card-border)]/40 space-y-3">
                    <p className="text-sm text-[var(--foreground)] leading-relaxed whitespace-pre-wrap break-keep">
                      {p.body}
                    </p>

                    <div>
                      <label className="block text-xs font-bold text-[var(--muted)] mb-1.5">상태</label>
                      <div className="grid grid-cols-4 gap-1.5">
                        {STATUS_OPTIONS.map(s => (
                          <button
                            key={s.id}
                            onClick={() => setDrafts(prev => ({ ...prev, [p.id]: { ...d, status: s.id } }))}
                            className={`py-2 rounded-xl text-xs font-bold active:scale-95 transition ${
                              d.status === s.id
                                ? 'bg-emerald-500 text-white shadow'
                                : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
                            }`}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-[var(--muted)] mb-1.5">답글</label>
                      <textarea
                        value={d.reply}
                        onChange={(e) => setDrafts(prev => ({ ...prev, [p.id]: { ...d, reply: e.target.value.slice(0, 2000) } }))}
                        rows={4}
                        placeholder="진행 상황 / 반영 시점 / 채택 이유 등을 알려주세요. 공개 글이면 모든 러너에게 보입니다."
                        className="w-full px-3 py-2.5 rounded-xl border-2 border-[var(--card-border)] bg-[var(--background)] text-sm focus:outline-none focus:border-emerald-500 resize-none"
                      />
                      <p className="text-[10px] text-[var(--muted)] mt-0.5">{d.reply.length}/2000 · 비우면 답글 없이 상태만 변경</p>
                    </div>

                    <button
                      onClick={() => save(p)}
                      disabled={saving === p.id}
                      className="w-full py-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-sm disabled:opacity-50 active:scale-[0.98] inline-flex items-center justify-center gap-1.5"
                    >
                      {saving === p.id ? '저장 중…' : <><Check size={16} /> 저장</>}
                    </button>
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2000} />}
    </div>
  );
}
