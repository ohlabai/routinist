'use client';

// 프로필 인라인 응원 챗 (2026-08-03 hans): 응원 카드 안에서 최근 대화 미리보기 + 바로 전송.
// 하트(원탭)와 챗(한마디) 두 갈래 응원. 대화 row 는 첫 전송 때만 생성 —
// 프로필 열람만으로 conversations 가 불어나지 않게 조회는 find-only.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Send, ChevronRight } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { getOrCreateConversation, sendMessage, markAsRead } from '@/lib/message-data';
import { useI18n } from '@/lib/i18n';
import type { Message } from '@/types';

const PREVIEW_COUNT = 3;

export default function ProfileChatBox({ otherUserId, myUserId }: { otherUserId: string; myUserId: string }) {
  const { tt, locale } = useI18n();
  const [convId, setConvId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const supabase = getSupabase();
        const [a, b] = myUserId < otherUserId ? [myUserId, otherUserId] : [otherUserId, myUserId];
        const { data: conv } = await supabase
          .from('conversations').select('id').eq('user_a', a).eq('user_b', b).maybeSingle();
        if (!alive || !conv) return;
        setConvId(conv.id);
        const { data } = await supabase
          .from('messages').select('*')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: false })
          .limit(PREVIEW_COUNT);
        if (!alive) return;
        setMsgs(((data ?? []) as Message[]).reverse());
        // 미리보기로 이미 읽었으니 인박스 뱃지도 정리
        void markAsRead(conv.id, myUserId);
      } catch {
        // 미리보기 실패는 조용히 — 입력은 여전히 동작 (전송 시 재시도 경로)
      }
    })();
    return () => { alive = false; };
  }, [myUserId, otherUserId]);

  const send = useCallback(async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setFailed(false);
    try {
      let id = convId;
      if (!id) {
        id = (await getOrCreateConversation(otherUserId)).id;
        setConvId(id);
      }
      const m = await sendMessage(id, body);
      setMsgs(prev => [...prev, m].slice(-PREVIEW_COUNT));
      setText('');
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  }, [text, sending, convId, otherUserId]);

  const fmtTime = (ts: string) =>
    new Date(ts).toLocaleTimeString(locale === 'en' ? 'en-US' : 'ko-KR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="mt-3 pt-3 border-t border-[var(--card-border)]/60">
      {msgs.length > 0 ? (
        <div className="space-y-1.5 mb-3">
          {msgs.map(m => (
            <div key={m.id} className={`flex items-end gap-1.5 ${m.sender_id === myUserId ? 'justify-end' : 'justify-start'}`}>
              {m.sender_id === myUserId && (
                <span className="text-[11px] text-[var(--muted)] shrink-0">{fmtTime(m.created_at)}</span>
              )}
              <span
                className={`max-w-[75%] px-3 py-1.5 rounded-2xl text-sm leading-snug break-words ${
                  m.sender_id === myUserId
                    ? 'bg-emerald-500 text-white rounded-br-md'
                    : 'bg-[var(--card-border)]/40 text-[var(--foreground)] rounded-bl-md'
                }`}
              >
                {m.body}
              </span>
              {m.sender_id !== myUserId && (
                <span className="text-[11px] text-[var(--muted)] shrink-0">{fmtTime(m.created_at)}</span>
              )}
            </div>
          ))}
          {convId && (
            <Link
              href={`/messages/chat?id=${convId}`}
              className="inline-flex items-center gap-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 pt-0.5"
            >
              {tt('전체 대화 보기')}
              <ChevronRight size={13} />
            </Link>
          )}
        </div>
      ) : (
        <p className="text-xs text-[var(--muted)] mb-2.5">{tt('아직 나눈 대화가 없어요. 한마디로 응원해 보세요!')}</p>
      )}

      <form
        onSubmit={e => { e.preventDefault(); void send(); }}
        className="flex items-center gap-2"
      >
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          maxLength={500}
          placeholder={tt('응원 한마디 보내기…')}
          className="flex-1 min-w-0 px-3.5 py-2.5 rounded-full bg-[var(--card-border)]/30 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] outline-none focus:ring-2 focus:ring-emerald-400/50"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          aria-label={tt('보내기')}
          className="w-10 h-10 shrink-0 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white flex items-center justify-center shadow-sm shadow-emerald-500/30 disabled:opacity-40 active:scale-90 transition"
        >
          <Send size={16} />
        </button>
      </form>
      {failed && (
        <p className="text-xs text-rose-500 mt-1.5">{tt('메시지를 못 보냈어요. 잠시 후 다시 시도해 주세요')}</p>
      )}
    </div>
  );
}
