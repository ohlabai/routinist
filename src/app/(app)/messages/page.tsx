'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { fetchConversations } from '@/lib/message-data';
import { ArrowLeft, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import type { Conversation } from '@/types';
import AppLogo from '@/components/AppLogo';

export default function MessagesPage() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    // 8초 timeout — 무한 로딩 방지
    const timer = setTimeout(() => {
      if (!cancelled) setLoading(false);
    }, 8000);
    fetchConversations(user.id)
      .then(c => { if (!cancelled) setConversations(c); })
      .catch(e => { if (!cancelled) console.warn('[messages] fetch 실패', e); })
      .finally(() => {
        clearTimeout(timer);
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; clearTimeout(timer); };
  }, [user]);

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return '어제';
    if (diffDays < 7) return `${diffDays}일 전`;
    return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/social" className="text-[var(--muted)]"><ArrowLeft size={24} /></Link>
        <h1 className="text-2xl font-bold text-[var(--foreground)]">쪽지</h1>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
        </div>
      ) : conversations.length === 0 ? (
        <div className="text-center py-16">
          <MessageCircle size={48} className="mx-auto mb-4 text-[var(--muted)]" />
          <p className="text-xs text-[var(--muted)]">아직 쪽지가 없습니다</p>
          <p className="text-xs text-[var(--muted)] mt-1">다른 러너의 프로필에서 쪽지를 보내보세요</p>
        </div>
      ) : (
        <div className="card divide-y divide-[var(--card-border)]">
          {(() => {
            // 같은 display_name 으로 두 명 이상 있으면 region/id 로 보조 라벨 — 사용자 피드백 #9.
            // 예전에는 둘 다 "러너"로 떠서 한 명이 다른 사람으로 오인됐음.
            const nameCount = new Map<string, number>();
            conversations.forEach(c => {
              const n = c.other_user?.display_name ?? '러너';
              nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
            });
            return conversations.map((conv) => {
              const name = conv.other_user?.display_name ?? '러너';
              const ambiguous = (nameCount.get(name) ?? 0) > 1;
              const suffix = ambiguous
                ? (conv.other_user?.region_gu
                    ? ` · ${conv.other_user.region_gu}`
                    : conv.other_user?.id
                      ? ` · ${conv.other_user.id.slice(0, 4)}`
                      : '')
                : '';
              return (
                <Link
                  key={conv.id}
                  href={`/messages/chat?id=${conv.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--card-border)]/30"
                >
                  <div className="w-10 h-10 rounded-full bg-[var(--card-border)] overflow-hidden flex-shrink-0">
                    {conv.other_user?.avatar_url ? (
                      <img src={conv.other_user.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><AppLogo size={24} /></div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-[var(--foreground)] truncate">
                        {name}{suffix}
                      </p>
                      <p className="text-xs text-[var(--muted)] flex-shrink-0 ml-2">
                        {formatTime(conv.last_message_at)}
                      </p>
                    </div>
                    <p className="text-xs text-[var(--muted)] truncate mt-0.5">
                      {conv.last_message?.body ?? '대화를 시작하세요'}
                    </p>
                  </div>
                </Link>
              );
            });
          })()}
        </div>
      )}
    </div>
  );
}
