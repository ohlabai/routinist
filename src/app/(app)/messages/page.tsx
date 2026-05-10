'use client';

// 쪽지 — 모던 모바일 UX/UI (에메랄드 그린).

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { fetchConversations } from '@/lib/message-data';
import { ArrowLeft, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import type { Conversation } from '@/types';
import AppLogo from '@/components/AppLogo';

export default function MessagesPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const timer = setTimeout(() => { if (!cancelled) setLoading(false); }, 8000);
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
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-extrabold tracking-tight">쪽지</h1>
        </div>
      </header>

      {loading ? (
        <div className="px-4 pt-4 space-y-2">
          {[0,1,2].map(i => (
            <div key={i} className="card p-3 flex items-center gap-3 animate-pulse">
              <div className="w-11 h-11 rounded-full bg-[var(--card-border)]/50" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-1/3 bg-[var(--card-border)]/50 rounded" />
                <div className="h-3 w-2/3 bg-[var(--card-border)]/50 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : conversations.length === 0 ? (
        <div className="text-center py-24 px-6">
          <div className="w-24 h-24 rounded-full bg-emerald-50 dark:bg-emerald-950/30 mx-auto mb-5 flex items-center justify-center">
            <MessageCircle size={42} className="text-emerald-500" />
          </div>
          <p className="text-lg font-extrabold mb-1.5">아직 쪽지가 없어요</p>
          <p className="text-sm text-[var(--muted)] mb-7">다른 러너의 프로필에서 쪽지를 보내보세요</p>
          <Link
            href="/social"
            className="inline-flex items-center gap-1.5 px-6 py-3 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-bold shadow-md shadow-emerald-500/30 active:scale-95"
          >
            러너 찾기
          </Link>
        </div>
      ) : (
        <div className="px-4 pt-4 space-y-2">
          {(() => {
            // 같은 display_name 으로 두 명 이상이면 region/id suffix
            const nameCount = new Map<string, number>();
            conversations.forEach(c => {
              const n = c.other_user?.display_name ?? '러너';
              nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
            });
            return conversations.map(conv => {
              const name = conv.other_user?.display_name ?? '러너';
              const ambiguous = (nameCount.get(name) ?? 0) > 1;
              const suffix = ambiguous
                ? (conv.other_user?.region_gu ? ` · ${conv.other_user.region_gu}` :
                   conv.other_user?.id ? ` · ${conv.other_user.id.slice(0, 4)}` : '')
                : '';
              return (
                <Link
                  key={conv.id}
                  href={`/messages/chat?id=${conv.id}`}
                  className="card p-3 flex items-center gap-3 active:scale-[0.98] transition group"
                >
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-emerald-100 to-emerald-50 dark:from-emerald-900/40 dark:to-emerald-950/30 overflow-hidden flex-shrink-0">
                    {conv.other_user?.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={conv.other_user.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><AppLogo size={22} /></div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-extrabold text-[var(--foreground)] truncate">
                        {name}{suffix}
                      </p>
                      <p className="text-[10px] text-[var(--muted)] flex-shrink-0 font-medium">
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
