'use client';

// 어드민 — UGC 콘텐츠 신고 처리 (build 100).
// content_reports 의 open 상태 신고를 admin 이 확인/제거.
// RLS: is_shop_admin() SELECT + UPDATE 허용 (이전 라운드 적용).

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Flag, Check, EyeOff, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { isAdminEmail } from '@/lib/admin-emails';
import AppToast from '@/components/AppToast';

const REASON_LABEL: Record<string, string> = {
  inappropriate: '부적절',
  spam: '스팸',
  harassment: '괴롭힘',
  copyright: '저작권',
  block: '차단 (자동)',
  other: '기타',
};

const TARGET_LABEL: Record<string, string> = {
  photo: '사진',
  user: '사용자',
  message: '쪽지',
  quote: '명언',
  feedback: '제안',
  photo_comment: '포토 댓글',
  activity_comment: '활동 댓글',
  club: '클럽',
};

interface Report {
  id: string;
  reporter_id: string;
  target_type: string;
  target_id: string;
  reason: string;
  detail: string | null;
  status: string;
  created_at: string;
}

/** 신고 대상 콘텐츠 미리보기 — UUID 만으론 24시간 내 판단 불가 (2026-08-10 감사 G11) */
interface Preview {
  text?: string;
  imageUrl?: string;
  authorId?: string;
}

export default function AdminReportsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const [filter, setFilter] = useState<'open' | 'reviewed' | 'removed'>('open');
  const [previews, setPreviews] = useState<Record<string, Preview>>({});

  useEffect(() => {
    if (authLoading) return;
    if (!user || !isAdmin) {
      router.replace('/');
    }
  }, [authLoading, user, isAdmin, router]);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('content_reports')
        .select('*')
        .eq('status', filter)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      const rows = (data ?? []) as Report[];
      setReports(rows);
      void loadPreviews(rows);
    } catch (e) {
      console.warn('[admin/reports] load 실패', e);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, filter]);

  // 대상 콘텐츠 미리보기 배치 로드 — 타입별로 IN 쿼리 1회씩
  const loadPreviews = async (rows: Report[]) => {
    const supabase = getSupabase();
    const byType = (t: string) => rows.filter(r => r.target_type === t).map(r => r.target_id);
    const next: Record<string, Preview> = {};
    const key = (t: string, id: string) => `${t}:${id}`;
    try {
      const photoIds = byType('photo');
      if (photoIds.length) {
        const { data } = await supabase.from('activity_photos')
          .select('id, photo_url, caption, user_id').in('id', photoIds);
        data?.forEach(p => { next[key('photo', p.id)] = { imageUrl: p.photo_url, text: p.caption ?? undefined, authorId: p.user_id }; });
      }
      const pcIds = byType('photo_comment');
      if (pcIds.length) {
        const { data } = await supabase.from('photo_comments').select('id, body, user_id').in('id', pcIds);
        data?.forEach(c => { next[key('photo_comment', c.id)] = { text: c.body, authorId: c.user_id }; });
      }
      const acIds = byType('activity_comment');
      if (acIds.length) {
        const { data } = await supabase.from('activity_comments').select('id, body, user_id').in('id', acIds);
        data?.forEach(c => { next[key('activity_comment', c.id)] = { text: c.body, authorId: c.user_id }; });
      }
      const quoteIds = byType('quote').filter(id => /^\d+$/.test(id) || id.length > 10);
      if (quoteIds.length) {
        const { data } = await supabase.from('quotes').select('id, text, user_id').in('id', quoteIds);
        data?.forEach(q => { next[key('quote', String(q.id))] = { text: q.text, authorId: q.user_id ?? undefined }; });
      }
      const userIds = byType('user');
      if (userIds.length) {
        const { data } = await supabase.from('profiles').select('id, display_name, bio').in('id', userIds);
        data?.forEach(p => { next[key('user', p.id)] = { text: [p.display_name, p.bio].filter(Boolean).join(' — '), authorId: p.id }; });
      }
    } catch (e) {
      console.warn('[admin/reports] preview 로드 실패', e);
    }
    setPreviews(next);
  };

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (id: string, status: 'reviewed' | 'removed') => {
    setBusy(id);
    try {
      const supabase = getSupabase();
      const { error } = await supabase
        .from('content_reports')
        .update({ status })
        .eq('id', id);
      if (error) throw error;
      setToast({ text: status === 'reviewed' ? '확인 완료로 표시했어요' : '삭제 처리로 표시했어요', tone: 'ok' });
      setReports(rs => rs.filter(r => r.id !== id));
    } catch (e) {
      const msg = e instanceof Error ? e.message : '실패';
      setToast({ text: msg, tone: 'warn' });
    } finally {
      setBusy(null);
    }
  };

  // photo 신고일 때 해당 사진 hide (실제 삭제는 admin 이 별도 결정)
  // 2026-08-10: .select() 로 실제 갱신 행 검증 — 이전엔 UPDATE RLS 정책 부재로 0행 갱신이
  // 조용히 성공 토스트를 띄웠다 (감사 G18). 마이그로 정책 추가 + 여기선 결과 확인.
  const hidePhoto = async (photoId: string, reportId: string) => {
    setBusy(reportId);
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('activity_photos')
        .update({ share_in_gallery: false })
        .eq('id', photoId)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('갱신된 행이 없어요 — RLS/대상 확인 필요');
      await updateStatus(reportId, 'removed');
      setToast({ text: '사진 비공개 처리 + 신고 닫음', tone: 'ok' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '실패';
      setToast({ text: msg, tone: 'warn' });
      setBusy(null);
    }
  };

  // 신고된 댓글 삭제 (photo_comment / activity_comment) — RLS delete 에 is_shop_admin 포함
  const deleteComment = async (table: 'photo_comments' | 'activity_comments', commentId: string, reportId: string) => {
    setBusy(reportId);
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.from(table).delete().eq('id', commentId).select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('삭제된 행이 없어요 — 이미 삭제됐거나 RLS 확인 필요');
      await updateStatus(reportId, 'removed');
      setToast({ text: '댓글 삭제 + 신고 닫음', tone: 'ok' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '실패';
      setToast({ text: msg, tone: 'warn' });
      setBusy(null);
    }
  };

  if (authLoading) return null;
  if (!user || !isAdmin) return null;

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/85 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="px-3 py-3 flex items-center gap-2">
          <Link href="/admin" className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--card-border)]/30 active:scale-90 transition">
            <ArrowLeft size={18} />
          </Link>
          <h1 className="text-base font-extrabold tracking-tight">콘텐츠 신고</h1>
        </div>
      </header>

      <div className="px-4 pt-4">
        <div className="flex gap-1.5 mb-3">
          {(['open', 'reviewed', 'removed'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition ${
                filter === f
                  ? 'bg-emerald-500 text-white shadow-sm'
                  : 'bg-[var(--card)] text-[var(--muted)] border border-[var(--card-border)]'
              }`}
            >
              {f === 'open' ? '미처리' : f === 'reviewed' ? '확인됨' : '제거됨'}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
          </div>
        ) : reports.length === 0 ? (
          <div className="card p-6 text-center">
            <Check size={28} className="mx-auto text-emerald-500 mb-2" />
            <p className="text-sm font-semibold text-[var(--foreground)]">
              {filter === 'open' ? '처리할 신고가 없어요' : '항목이 없어요'}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {reports.map(r => (
              <li key={r.id} className="card p-4">
                <div className="flex items-start gap-2 mb-2">
                  <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-950/30 flex items-center justify-center flex-shrink-0">
                    <Flag size={16} className="text-amber-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                        {TARGET_LABEL[r.target_type] ?? r.target_type}
                      </span>
                      <span className="text-[12px] text-[var(--muted)]">·</span>
                      <span className="text-xs font-semibold text-[var(--foreground)]">
                        {REASON_LABEL[r.reason] ?? r.reason}
                      </span>
                    </div>
                    <p className="text-[13px] text-[var(--muted)] mt-0.5">
                      {new Date(r.created_at).toLocaleString('ko-KR')}
                    </p>
                  </div>
                </div>
                {r.detail && (
                  <p className="text-xs text-[var(--foreground)] bg-[var(--card-border)]/30 rounded-lg p-2 mb-2">
                    {r.detail}
                  </p>
                )}
                {/* 대상 콘텐츠 미리보기 — 어드민이 내용을 보고 판단 (G11) */}
                {(() => {
                  const pv = previews[`${r.target_type}:${r.target_id}`];
                  if (!pv) return null;
                  return (
                    <div className="mb-2 rounded-lg border border-amber-200/60 dark:border-amber-800/40 bg-amber-50/50 dark:bg-amber-950/20 p-2">
                      {pv.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={pv.imageUrl} alt="" className="w-full max-h-40 object-cover rounded-md mb-1.5" />
                      )}
                      {pv.text && (
                        <p className="text-xs text-[var(--foreground)] whitespace-pre-wrap break-words">{pv.text}</p>
                      )}
                      {pv.authorId && (
                        <Link href={`/admin/users/detail?id=${pv.authorId}`} className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-400 underline">
                          작성자 상세 (정지/삭제) →
                        </Link>
                      )}
                    </div>
                  );
                })()}
                <p className="text-[12px] text-[var(--muted)] font-mono mb-3 break-all">
                  ID: {r.target_id}
                </p>
                {filter === 'open' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => updateStatus(r.id, 'reviewed')}
                      disabled={busy === r.id}
                      className="flex-1 py-2 rounded-xl bg-[var(--card-border)]/30 text-xs font-bold text-[var(--foreground)] disabled:opacity-50 inline-flex items-center justify-center gap-1"
                    >
                      <Check size={12} /> 확인
                    </button>
                    {r.target_type === 'photo' && (
                      <button
                        onClick={() => hidePhoto(r.target_id, r.id)}
                        disabled={busy === r.id}
                        className="flex-1 py-2 rounded-xl bg-amber-500 text-white text-xs font-bold disabled:opacity-50 inline-flex items-center justify-center gap-1"
                      >
                        <EyeOff size={12} /> 사진 비공개
                      </button>
                    )}
                    {(r.target_type === 'photo_comment' || r.target_type === 'activity_comment') && (
                      <button
                        onClick={() => deleteComment(
                          r.target_type === 'photo_comment' ? 'photo_comments' : 'activity_comments',
                          r.target_id, r.id,
                        )}
                        disabled={busy === r.id}
                        className="flex-1 py-2 rounded-xl bg-amber-500 text-white text-xs font-bold disabled:opacity-50 inline-flex items-center justify-center gap-1"
                      >
                        <EyeOff size={12} /> 댓글 삭제
                      </button>
                    )}
                    {r.target_type === 'user' && (
                      <Link
                        href={`/admin/users/detail?id=${r.target_id}`}
                        className="flex-1 py-2 rounded-xl bg-amber-500 text-white text-xs font-bold inline-flex items-center justify-center gap-1"
                      >
                        회원 상세
                      </Link>
                    )}
                    <button
                      onClick={() => updateStatus(r.id, 'removed')}
                      disabled={busy === r.id}
                      className="flex-1 py-2 rounded-xl bg-rose-500 text-white text-xs font-bold disabled:opacity-50 inline-flex items-center justify-center gap-1"
                    >
                      <AlertTriangle size={12} /> 제거
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2500} />}
    </div>
  );
}
