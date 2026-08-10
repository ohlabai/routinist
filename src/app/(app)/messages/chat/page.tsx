'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { fetchMessages, sendMessage, markAsRead, getOrCreateConversation, blockUser } from '@/lib/message-data';
import { requestBadgeRefresh } from '@/lib/notifications-data';
import { getSupabase } from '@/lib/supabase';
import { PUBLIC_PROFILE_FIELDS } from '@/lib/profile-fields';
import { ArrowLeft, Send, ShieldAlert, Flag } from 'lucide-react';
import ReportDialog from '@/components/ReportDialog';
import AppToast from '@/components/AppToast';
import Link from 'next/link';
import type { Message, Profile } from '@/types';
import AppLogo from '@/components/AppLogo';
import { logClientWarn } from '@/lib/error-logger';
import { useI18n } from '@/lib/i18n';

function ChatView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const { tt, locale } = useI18n();
  // build 219 #2: ?user= 로 들어오면 getOrCreateConversation 으로 id 를 부여.
  // 기존 대화가 있으면 그 채팅을, 없으면 새 대화를 즉시 만들어 빈 채팅 화면 노출.
  const idParam = searchParams.get('id');
  const userParam = searchParams.get('user');
  const [conversationId, setConversationId] = useState<string | null>(idParam);
  const [convResolving, setConvResolving] = useState(!idParam && !!userParam);
  const [convError, setConvError] = useState<string | null>(null);
  useEffect(() => {
    if (idParam) { setConversationId(idParam); return; }
    if (!userParam || !user) return;
    setConvResolving(true);
    (async () => {
      try {
        const conv = await getOrCreateConversation(userParam);
        setConversationId(conv.id);
      } catch (e) {
        setConvError(String(e instanceof Error ? e.message : e));
      } finally {
        setConvResolving(false);
      }
    })();
  }, [idParam, userParam, user]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [otherUser, setOtherUser] = useState<Profile | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  };

  const loadData = useCallback(async () => {
    if (!conversationId || !user) return;
    setLoading(true);
    try {
      const supabase = getSupabase();

      // 대화 정보
      const { data: conv } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .single();

      if (conv) {
        const otherId = conv.user_a === user.id ? conv.user_b : conv.user_a;
        const { data: profile } = await supabase.from('profiles').select(PUBLIC_PROFILE_FIELDS).eq('id', otherId).maybeSingle();
        setOtherUser(profile as Profile | null);
      }

      const msgs = await fetchMessages(conversationId);
      setMessages(msgs);

      // 읽음 처리
      await markAsRead(conversationId, user.id);
      // 2026-07-15 리뷰 fix: 읽음 처리 후 앱 아이콘/내정보 탭 배지 즉시 갱신 (이전엔 다음 focus 까지 stale)
      requestBadgeRefresh();
    } catch (e) {
      logClientWarn('chat', 'loadData 실패', { conversationId, err: String(e) });
    } finally {
      setLoading(false);
      setTimeout(scrollToBottom, 100);
    }
  }, [conversationId, user]);

  useEffect(() => { loadData(); }, [loadData]);

  // Realtime 구독
  useEffect(() => {
    if (!conversationId) return;
    const supabase = getSupabase();
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        const newMsg = payload.new as Message;
        setMessages((prev) => [...prev, newMsg]);
        setTimeout(scrollToBottom, 100);
        // 읽음 처리
        if (user && newMsg.sender_id !== user.id) {
          markAsRead(conversationId, user.id).then(() => requestBadgeRefresh()).catch(() => {});
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [conversationId, user]);

  const [sendError, setSendError] = useState<string | null>(null);
  // Apple 1.2: 대화 상대 신고
  const [showReport, setShowReport] = useState(false);
  const [reportToast, setReportToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const handleSend = async () => {
    if (!newMessage.trim() || !conversationId || sending) return;
    // 클라 1차 금칙어 필터 — 서버 트리거 (is_clean_text) 가 최종 방어선
    const { moderationError } = await import('@/lib/moderation');
    const modErr = moderationError(newMessage, locale === 'en' ? 'en' : 'ko');
    if (modErr) {
      setSendError(modErr);
      setTimeout(() => setSendError(null), 3500);
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      await sendMessage(conversationId, newMessage.trim());
      setNewMessage('');
    } catch (e) {
      logClientWarn('chat', 'sendMessage 실패', { conversationId, err: String(e) });
      const msg = String(e);
      setSendError(
        msg.includes('objectionable') ? tt('사용할 수 없는 단어가 포함되어 있어요.')
        : msg.includes('row-level security') || msg.includes('violates')
          ? tt('메시지를 보낼 수 없는 상대예요.')
          : tt('전송 실패. 네트워크 확인 후 다시 시도해주세요.')
      );
      setTimeout(() => setSendError(null), 3500);
    } finally {
      setSending(false);
    }
  };

  if (!conversationId) {
    if (convResolving) {
      return (
        <div className="flex justify-center py-20">
          <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
        </div>
      );
    }
    return (
      <div className="max-w-lg mx-auto px-4 py-6 text-center">
        <p className="text-[var(--muted)]">{convError ?? tt('대화를 찾을 수 없습니다')}</p>
        <button onClick={() => router.back()} className="text-[var(--accent)] text-sm mt-4">{tt('뒤로가기')}</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full max-w-lg mx-auto">
      {/* 헤더 — 더 큰 터치 영역 + 폰트. layout 의 nav/header 가 채팅에선 숨김 처리됨.
          build 220 #3: 뒤로가기를 router.back() 으로. 홈/공유카드 → 채팅 진입 시
          뒤로가기 한 번에 원래 화면 (공유카드 또는 진입 지점) 복귀.
          진입 경로 정보가 없으면 /messages 로 fallback. */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--card-border)] flex-shrink-0">
        <button
          onClick={() => {
            // history 가 1 이상이면 진짜 뒤로, 없으면 messages 리스트.
            if (typeof window !== 'undefined' && window.history.length > 1) router.back();
            else router.push('/messages');
          }}
          className="text-[var(--muted)] -ml-1 p-1"
          aria-label={tt('뒤로')}
        ><ArrowLeft size={24} /></button>
        <Link href={otherUser ? `/profile/view?id=${otherUser.id}` : '#'} className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-9 h-9 rounded-full bg-[var(--card-border)] overflow-hidden flex-shrink-0">
            {otherUser?.avatar_url ? (
              <img src={otherUser.avatar_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center"><AppLogo size={20} /></div>
            )}
          </div>
          <span className="text-base font-semibold text-[var(--foreground)] truncate">
            {otherUser?.display_name ?? tt('러너')}
          </span>
        </Link>
        {/* Apple 1.2: 대화 상대 신고 (2026-08-10) */}
        {otherUser && (
          <button
            onClick={() => setShowReport(true)}
            className="p-2 text-[var(--muted)] active:opacity-60"
            aria-label={tt('신고')}
            title={tt('신고')}
          >
            <Flag size={19} />
          </button>
        )}
        {/* build 290: 차단 (Apple 1.2) — 차단 후 대화 목록으로 복귀 (목록에서 자동 숨김) */}
        {otherUser && (
          <button
            onClick={async () => {
              const confirmMsg = locale === 'en'
                ? `Block ${otherUser.display_name ?? 'this user'}?\nBlocking hides this conversation from your list, and their photos and comments will no longer be visible.`
                : `${otherUser.display_name ?? '이 사용자'}님을 차단할까요?\n차단하면 대화가 목록에서 숨겨지고 사진·댓글도 보이지 않아요.`;
              if (!window.confirm(confirmMsg)) return;
              try {
                await blockUser(otherUser.id);
                router.push('/messages');
              } catch (e) {
                logClientWarn('Chat', '차단 실패', { err: String(e) });
              }
            }}
            className="p-2 text-[var(--muted)] active:opacity-60"
            aria-label={tt('사용자 차단')}
            title={tt('사용자 차단')}
          >
            <ShieldAlert size={20} />
          </button>
        )}
      </div>

      {/* 메시지 영역 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
          </div>
        ) : messages.length === 0 ? (
          <p className="text-center text-xs text-[var(--muted)] py-8">{tt('첫 메시지를 보내보세요!')}</p>
        ) : (
          messages.map((msg) => {
            const isMine = msg.sender_id === user?.id;
            return (
              <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl ${
                  isMine
                    ? 'bg-[var(--accent)] text-white rounded-br-md'
                    : 'bg-[var(--card)] text-[var(--foreground)] rounded-bl-md'
                }`}>
                  <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>
                  <p className={`text-sm mt-1 ${isMine ? 'text-white/60' : 'text-[var(--muted)]'}`}>
                    {new Date(msg.created_at).toLocaleTimeString(locale === 'en' ? 'en-US' : 'ko-KR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 입력 영역 — 모바일 트렌드 (인스타/카톡 톤). 큰 폰트, 둥근 캡슐, safe-area-bottom 보정.
          layout 에서 채팅 페이지 nav 가 숨겨졌으니 입력창이 nav 에 가리지 않음. */}
      {sendError && (
        <div className="px-4 py-2 text-sm text-red-500 bg-red-500/10 border-t border-red-500/30 text-center">
          {sendError}
        </div>
      )}
      <div className="flex-shrink-0 border-t border-[var(--card-border)] px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)] bg-[var(--background)]">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder={tt('메시지를 입력하세요')}
            maxLength={2000}
            className="flex-1 px-5 py-3.5 rounded-full bg-[var(--card)] border border-[var(--card-border)] text-base text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent"
          />
          <button
            onClick={handleSend}
            disabled={!newMessage.trim() || sending}
            aria-label={tt('보내기')}
            className="w-12 h-12 flex-shrink-0 rounded-full bg-[var(--accent)] text-white disabled:opacity-30 flex items-center justify-center active:scale-95 transition-transform shadow-sm"
          >
            <Send size={20} />
          </button>
        </div>
      </div>

      {showReport && otherUser && (
        <ReportDialog
          targetType="user"
          targetId={otherUser.id}
          title={tt('사용자 신고')}
          detail={conversationId ? `대화: ${conversationId}` : undefined}
          onClose={() => setShowReport(false)}
          onDone={(ok, message) => setReportToast({ text: message, tone: ok ? 'ok' : 'warn' })}
        />
      )}
      {reportToast && (
        <AppToast text={reportToast.text} tone={reportToast.tone} onClose={() => setReportToast(null)} durationMs={2500} />
      )}
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" /></div>}>
      <ChatView />
    </Suspense>
  );
}
