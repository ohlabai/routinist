'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { fetchComments, addComment, deleteComment } from '@/lib/comment-data';
import { Send, Trash2 } from 'lucide-react';
import Link from 'next/link';
import type { ActivityComment } from '@/types';
import AppLogo from '@/components/AppLogo';
import CheerButton from '@/components/social/CheerButton';

interface CommentSectionProps {
  activityId: string;
  activityOwnerId: string;
}

export default function CommentSection({ activityId, activityOwnerId }: CommentSectionProps) {
  const { user } = useAuth();
  const [comments, setComments] = useState<ActivityComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [sending, setSending] = useState(false);

  const loadData = useCallback(async () => {
    setComments(await fetchComments(activityId));
  }, [activityId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSubmit = async () => {
    if (!newComment.trim() || sending) return;
    setSending(true);
    try {
      const comment = await addComment(activityId, newComment.trim());
      setComments((prev) => [...prev, comment]);
      setNewComment('');
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    await deleteComment(commentId);
    setComments((prev) => prev.filter((c) => c.id !== commentId));
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return '방금';
    if (mins < 60) return `${mins}분 전`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}시간 전`;
    const days = Math.floor(hours / 24);
    return `${days}일 전`;
  };

  return (
    <div className="space-y-4">
      {/* 응원 버튼 — 통일 폼 (2026-07-30 hans): 원탭 무제한 + 픽셀 하트 버스트.
          이전의 activity_cheers 좋아요 토글은 사람 응원(user_cheers)으로 단일화. */}
      {user && user.id !== activityOwnerId && (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-extrabold text-[var(--foreground)]">이 러너에게 응원 보내기</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">하트는 몇 번이든 눌러도 돼요</p>
          </div>
          <CheerButton toUserId={activityOwnerId} context="activity" />
        </div>
      )}

      {/* 댓글 목록 */}
      {comments.length > 0 && (
        <div className="space-y-3">
          {comments.map((comment) => (
            <div key={comment.id} className="flex gap-2.5">
              <Link href={`/profile/view?id=${comment.user_id}`} className="flex-shrink-0">
                <div className="w-8 h-8 rounded-full bg-[var(--card-border)] overflow-hidden">
                  {comment.profile?.avatar_url ? (
                    <img src={comment.profile.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center"><AppLogo size={18} /></div>
                  )}
                </div>
              </Link>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Link href={`/profile/view?id=${comment.user_id}`} className="text-sm font-semibold text-[var(--foreground)]">
                    {comment.profile?.display_name ?? '러너'}
                  </Link>
                  <span className="text-xs text-[var(--muted)]">{formatTime(comment.created_at)}</span>
                  {comment.user_id === user?.id && (
                    <button onClick={() => handleDelete(comment.id)} className="text-[var(--muted)] hover:text-red-500 ml-auto">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                <p className="text-sm text-[var(--foreground)] mt-0.5">{comment.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 댓글 입력 */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="응원 댓글을 남겨보세요"
          maxLength={500}
          className="flex-1 px-4 py-2.5 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
        <button
          onClick={handleSubmit}
          disabled={!newComment.trim() || sending}
          className="px-3 py-2.5 rounded-xl bg-[var(--accent)] text-white disabled:opacity-30"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
