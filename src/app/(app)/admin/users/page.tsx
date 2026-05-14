'use client';

// 어드민 — 회원 관리 (build 110). 데모 러너 등 노출 불가 계정 관리.
// 감추기 토글 (profiles.is_public) + 영구 삭제 (auth.users CASCADE).

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Users, Search, Eye, EyeOff, Trash2, MapPin, Activity as ActivityIcon, X, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { isAdminEmail } from '@/lib/admin-emails';
import { getSupabase } from '@/lib/supabase';
import AppToast from '@/components/AppToast';

interface AdminUserRow {
  user_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  region_gu: string | null;
  is_public: boolean;
  total_runs: number;
  total_distance_km: number;
  created_at: string;
  last_activity_at: string | null;
}

export default function AdminUsersPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AdminUserRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !isAdmin) { router.replace('/'); return; }
  }, [authLoading, user, isAdmin, router]);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2200);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.rpc('admin_list_users', {
        p_search: search.trim() || null,
        p_limit: 100,
        p_offset: 0,
      });
      if (error) throw error;
      setRows((data ?? []) as AdminUserRow[]);
    } catch (e) {
      console.warn('[admin/users] fail', e);
      showToast(e instanceof Error ? e.message : '조회 실패', 'warn');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  // 검색 디바운스
  useEffect(() => {
    if (!isAdmin) return;
    const id = setTimeout(load, 300);
    return () => clearTimeout(id);
  }, [search, isAdmin, load]);

  const togglePublic = async (row: AdminUserRow) => {
    setBusy(row.user_id);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.rpc('admin_set_user_public', {
        p_user_id: row.user_id,
        p_is_public: !row.is_public,
      });
      if (error) throw error;
      setRows(prev => prev.map(r => r.user_id === row.user_id ? { ...r, is_public: !r.is_public } : r));
      showToast(row.is_public ? '감춤 처리됨' : '공개로 변경');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '실패', 'warn');
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.rpc('admin_delete_user', { p_user_id: confirmDelete.user_id });
      if (error) throw error;
      setRows(prev => prev.filter(r => r.user_id !== confirmDelete.user_id));
      showToast('영구 삭제됨');
      setConfirmDelete(null);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '삭제 실패', 'warn');
    } finally {
      setDeleting(false);
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
            <Users size={18} className="text-emerald-500" /> 회원 관리
          </h1>
          <span className="ml-auto text-xs text-[var(--muted)] font-bold">{rows.length}명</span>
        </div>
        <div className="px-4 pb-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="이메일 / 닉네임 검색"
              className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-sm focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>
      </header>

      <div className="p-4 space-y-2">
        {loading ? (
          [0, 1, 2, 3].map(i => <div key={i} className="card p-3 h-20 animate-pulse" />)
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-sm text-[var(--muted)]">검색 결과 없음</div>
        ) : (
          rows.map(r => {
            const hidden = !r.is_public;
            return (
              <article key={r.user_id} className={`card p-3.5 flex items-center gap-3 ${hidden ? 'opacity-70' : ''}`}>
                <div className="w-11 h-11 rounded-full bg-[var(--card-border)]/40 overflow-hidden flex-shrink-0">
                  {r.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-base font-bold text-[var(--muted)]">
                      {r.display_name?.slice(0, 1) ?? '?'}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-extrabold truncate">{r.display_name ?? '익명'}</p>
                    {hidden && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 inline-flex items-center gap-0.5"><EyeOff size={9} /> 감춤</span>}
                  </div>
                  <p className="text-[11px] text-[var(--muted)] truncate">{r.email}</p>
                  <p className="text-[11px] text-[var(--muted)] inline-flex items-center gap-2 mt-0.5">
                    {r.region_gu && <span className="inline-flex items-center gap-0.5"><MapPin size={9} /> {r.region_gu}</span>}
                    <span className="inline-flex items-center gap-0.5"><ActivityIcon size={9} /> {r.total_runs}회 · {Number(r.total_distance_km ?? 0).toFixed(1)}km</span>
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => togglePublic(r)}
                    disabled={busy === r.user_id}
                    aria-label={hidden ? '공개로 변경' : '감추기'}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center active:scale-95 transition disabled:opacity-50 ${
                      hidden
                        ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                        : 'bg-[var(--card-border)]/30 text-[var(--muted)]'
                    }`}
                  >
                    {hidden ? <Eye size={16} /> : <EyeOff size={16} />}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(r)}
                    aria-label="영구 삭제"
                    className="w-10 h-10 rounded-xl flex items-center justify-center bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 active:scale-95 transition"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>

      {/* 영구 삭제 확인 다이얼로그 */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[80] bg-black/65 flex items-center justify-center p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="w-full max-w-xs bg-[var(--background)] rounded-3xl p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col items-center gap-2 mb-4">
              <div className="w-14 h-14 rounded-2xl bg-rose-50 dark:bg-rose-950/40 flex items-center justify-center">
                <AlertTriangle size={26} className="text-rose-500" />
              </div>
              <h3 className="text-base font-bold text-center">정말 영구 삭제할까요?</h3>
              <p className="text-xs text-[var(--muted)] text-center leading-relaxed">
                <b>{confirmDelete.display_name ?? confirmDelete.email}</b> 의 모든 데이터<br />
                (활동·사진·러너 한 줄·주문·마일리지 등) 가 즉시 사라지며 복구할 수 없어요.
              </p>
              <p className="text-[11px] text-[var(--muted)] mt-1">감춤만 하려면 <Eye size={10} className="inline" /> 눈 버튼을 쓰세요.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(null)} disabled={deleting} className="flex-1 py-3 rounded-xl bg-[var(--card-border)]/30 font-semibold text-sm disabled:opacity-50">취소</button>
              <button onClick={handleDelete} disabled={deleting} className="flex-1 py-3 rounded-xl bg-rose-500 text-white font-extrabold text-sm disabled:opacity-50 active:scale-95">
                {deleting ? '삭제 중…' : '영구 삭제'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2000} />}
    </div>
  );
}
