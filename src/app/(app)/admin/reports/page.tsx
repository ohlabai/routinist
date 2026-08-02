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
  other: '기타',
};

const TARGET_LABEL: Record<string, string> = {
  photo: '사진',
  user: '사용자',
  message: '쪽지',
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

export default function AdminReportsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const [filter, setFilter] = useState<'open' | 'reviewed' | 'removed'>('open');

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
      setReports((data ?? []) as Report[]);
    } catch (e) {
      console.warn('[admin/reports] load 실패', e);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, filter]);

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
  const hidePhoto = async (photoId: string, reportId: string) => {
    setBusy(reportId);
    try {
      const supabase = getSupabase();
      const { error } = await supabase
        .from('activity_photos')
        .update({ share_in_gallery: false })
        .eq('id', photoId);
      if (error) throw error;
      await updateStatus(reportId, 'removed');
      setToast({ text: '사진 비공개 처리 + 신고 닫음', tone: 'ok' });
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
