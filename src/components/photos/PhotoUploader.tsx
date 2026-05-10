'use client';

// 루틴포토 업로드 트리거 — 오늘 러닝 activity 가 있어야 등록 가능.
// 버튼 클릭 → 오늘 activity 조회 → ShareCard 열어서 공유카드(코스+거리 오버레이) 생성 후 등록.
// 일반 사진 업로드는 제거됨 (2026-04-21 피드백 #9, #13, #14).

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import type { Activity } from '@/types';
import ShareCard from '@/components/activity/ShareCard';

interface Props {
  children: React.ReactNode;
  className?: string;
  onUploaded?: () => void;
}

export default function PhotoUploader({ children, className, onUploaded }: Props) {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [shareActivity, setShareActivity] = useState<Activity | null>(null);
  const [toast, setToast] = useState<{ text: string; href?: string } | null>(null);

  const startFlow = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const supabase = getSupabase();
      const today = new Date().toISOString().slice(0, 10);
      // 6초 타임아웃 — 네트워크 지연 시 "확인 중..." 고정되는 문제 방지
      const queryPromise = supabase
        .from('activities')
        .select('*')
        .eq('user_id', user.id)
        .eq('activity_date', today)
        .order('created_at', { ascending: false })
        .limit(1);
      const timeoutPromise = new Promise<{ data: null }>((resolve) =>
        setTimeout(() => resolve({ data: null }), 6000)
      );
      const { data } = await Promise.race([queryPromise, timeoutPromise]) as { data: Activity[] | null };

      const act = (data?.[0] as Activity | undefined) ?? null;
      if (!act) {
        setToast({ text: '오늘 러닝 기록이 있어야 등록할 수 있어요.', href: '/history' });
        setTimeout(() => setToast(null), 3200);
        return;
      }
      setShareActivity(act);
    } catch (err) {
      console.warn('activity 조회 실패', err);
      setToast({ text: '불러오기 실패. 다시 시도해주세요.' });
      setTimeout(() => setToast(null), 2500);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={startFlow}
        disabled={loading}
        className={className ?? 'inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-emerald-500 text-white font-semibold text-base shadow-sm active:scale-[0.98] transition disabled:opacity-50'}
      >
        {loading ? (
          <>
            <span className="animate-spin w-4 h-4 border-2 border-white/70 border-t-transparent rounded-full" />
            <span>오늘 러닝 확인 중…</span>
          </>
        ) : (
          children
        )}
      </button>

      {shareActivity && (
        <ShareCard
          activity={shareActivity}
          displayName={profile?.display_name ?? '러너'}
          onClose={() => setShareActivity(null)}
          onRegistered={() => onUploaded?.()}
        />
      )}

      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-white border border-emerald-200 text-emerald-800 text-sm font-semibold px-4 py-2.5 rounded-2xl shadow-lg shadow-emerald-100/40 z-[80] flex items-center gap-3">
          <span>{toast.text}</span>
          {toast.href && (
            <Link href={toast.href} className="text-emerald-600 font-bold underline underline-offset-2">
              이동
            </Link>
          )}
        </div>
      )}
    </>
  );
}
