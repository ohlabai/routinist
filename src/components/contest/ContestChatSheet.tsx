'use client';

// 친선런 단체 채팅 sheet (build 121).
// 참가자/호스트만 메시지 read/write.

import { useEffect, useState, useRef, useCallback } from 'react';
import { X, Send, Trash2 } from 'lucide-react';
import {
  fetchContestMessages,
  postContestMessage,
  deleteMyContestMessage,
  type ContestMessage,
} from '@/lib/contest-data';
import AppToast from '@/components/AppToast';

interface Props {
  contestId: string;
  contestTitle: string;
  myUserId: string;
  onClose: () => void;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return '방금';
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}분`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}시간`;
  return `${Math.floor(ms / 86400_000)}일`;
}

export default function ContestChatSheet({ contestId, contestTitle, myUserId, onClose }: Props) {
  const [messages, setMessages] = useState<ContestMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const showToast = (t: string) => { setToast(t); setTimeout(() => setToast(null), 1800); };

  const load = useCallback(async () => {
    try {
      const list = await fetchContestMessages(contestId);
      setMessages(list);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '불러오기 실패');
    } finally {
      setLoading(false);
    }
  }, [contestId]);

  useEffect(() => { load(); }, [load]);

  // 스크롤 — 새 메시지 도착 시 맨 아래로
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // 5초 폴링 (간단)
  useEffect(() => {
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const handleSend = async () => {
    const b = draft.trim();
    if (b.length === 0) return;
    setSending(true);
    try {
      await postContestMessage(contestId, b);
      setDraft('');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '전송 실패');
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('내 메시지를 삭제할까요?')) return;
    try {
      await deleteMyContestMessage(id);
      setMessages(prev => prev.filter(m => m.id !== id));
    } catch (e) {
      showToast(e instanceof Error ? e.message : '삭제 실패');
    }
  };

  return (
    <div className="fixed inset-0 z-[85] bg-black/65 flex items-end sm:items-center justify-center sm:p-3" onClick={onClose}>
      <div className="w-full sm:max-w-md bg-[var(--background)] rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col" style={{ height: 'min(85vh, 720px)' }} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 px-4 py-3 bg-[var(--background)] border-b border-[var(--card-border)] rounded-t-3xl flex items-center justify-between">
          <div className="min-w-0">
            <h3 className="text-base font-extrabold truncate">💬 {contestTitle}</h3>
            <p className="text-[10px] text-[var(--muted)]">참가자 채팅</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[var(--card-border)]/40 active:scale-90"><X size={18} /></button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {loading ? (
            [0,1,2].map(i => <div key={i} className="h-10 bg-[var(--card-border)]/30 animate-pulse rounded-xl" />)
          ) : messages.length === 0 ? (
            <p className="text-center text-sm text-[var(--muted)] py-12 italic">첫 메시지를 남겨보세요</p>
          ) : (
            messages.map(m => {
              const mine = m.user_id === myUserId;
              return (
                <div key={m.id} className={`flex items-start gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
                  <div className="w-8 h-8 rounded-full bg-[var(--card-border)]/40 overflow-hidden flex-shrink-0">
                    {m.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs font-bold text-[var(--muted)]">{m.display_name.slice(0,1)}</div>
                    )}
                  </div>
                  <div className={`max-w-[75%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                    {!mine && <p className="text-[10px] text-[var(--muted)] font-bold px-1 mb-0.5">{m.display_name}</p>}
                    <div className={`px-3 py-2 rounded-2xl text-[14px] leading-relaxed whitespace-pre-wrap break-keep ${
                      mine
                        ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white rounded-tr-md'
                        : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--foreground)] rounded-tl-md'
                    }`}>{m.body}</div>
                    <div className={`flex items-center gap-1.5 mt-0.5 px-1 ${mine ? 'flex-row-reverse' : ''}`}>
                      <span className="text-[10px] text-[var(--muted)]">{timeAgo(m.created_at)}</span>
                      {mine && (
                        <button onClick={() => handleDelete(m.id)} className="text-[10px] text-rose-500 inline-flex items-center gap-0.5 active:scale-95">
                          <Trash2 size={9} /> 삭제
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="sticky bottom-0 px-3 py-3 bg-[var(--background)] border-t border-[var(--card-border)]/40 flex items-end gap-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 1000))}
            placeholder="메시지를 입력하세요"
            rows={1}
            className="flex-1 px-3.5 py-2.5 rounded-2xl border-2 border-[var(--card-border)] bg-[var(--card)] text-[15px] focus:outline-none focus:border-emerald-500 resize-none max-h-24"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          />
          <button
            onClick={handleSend}
            disabled={sending || draft.trim().length === 0}
            aria-label="전송"
            className="w-11 h-11 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white flex items-center justify-center disabled:opacity-50 active:scale-95 shadow-md shadow-emerald-500/30 flex-shrink-0"
          >
            <Send size={16} />
          </button>
        </div>

        {toast && <AppToast text={toast} tone="warn" onClose={() => setToast(null)} durationMs={1800} />}
      </div>
    </div>
  );
}
