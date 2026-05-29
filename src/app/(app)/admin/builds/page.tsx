'use client';

// 어드민 — Build Dashboard 목록 (build 203 / Phase C).

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Package, CheckCircle, XCircle, Circle, Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { isAdminEmail } from '@/lib/admin-emails';
import { getSupabase } from '@/lib/supabase';

interface BuildRow {
  build_number: number;
  marketing_version: string | null;
  title: string;
  released_at: string;
  total_checks: number;
  passed: number;
  failed: number;
  pending: number;
}

export default function AdminBuildsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const [rows, setRows] = useState<BuildRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !isAdmin) { router.replace('/'); return; }
  }, [authLoading, user, isAdmin, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.rpc('admin_list_builds');
      if (error) throw error;
      setRows((data ?? []) as BuildRow[]);
    } catch (e) { console.warn(e); } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  if (!isAdmin) return null;

  return (
    <div className="bg-[var(--background)] min-h-screen pb-12">
      <header className="sticky top-0 z-30 bg-[var(--background)]/85 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="max-w-4xl mx-auto flex items-center gap-2 px-4 py-3">
          <Link href="/admin" className="w-10 h-10 flex items-center justify-center rounded-full active:bg-[var(--card-border)]/30">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-xl font-extrabold tracking-tight inline-flex items-center gap-1.5">
            <Package size={18} className="text-emerald-500" /> Build Dashboard
          </h1>
          <span className="ml-auto text-xs font-bold text-[var(--muted)]">{rows.length}건</span>
          <button onClick={load} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[var(--card-border)]/30">
            <RefreshCw size={14} />
          </button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 pt-4 space-y-2">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-emerald-500" /></div>
        ) : rows.length === 0 ? (
          <p className="text-center py-16 text-sm text-[var(--muted)]">아직 등록된 빌드가 없어요</p>
        ) : (
          rows.map(r => {
            const pct = r.total_checks > 0 ? Math.round((r.passed / r.total_checks) * 100) : 0;
            return (
              <Link key={r.build_number} href={`/admin/builds/detail?build=${r.build_number}`}
                className="card p-4 flex items-center gap-3 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/10 active:scale-[0.99] transition">
                <div className="w-14 text-center flex-shrink-0">
                  <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest">v{r.marketing_version}</p>
                  <p className="text-2xl font-extrabold tabular-nums text-emerald-600">{r.build_number}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-extrabold truncate">{r.title}</p>
                  <p className="text-[11px] text-[var(--muted)] mt-0.5">{r.released_at}</p>
                  {r.total_checks > 0 && (
                    <div className="mt-2 flex items-center gap-3 text-[11px]">
                      <span className="inline-flex items-center gap-0.5 text-emerald-600 font-bold">
                        <CheckCircle size={11} /> {r.passed}
                      </span>
                      {r.failed > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-rose-500 font-bold">
                          <XCircle size={11} /> {r.failed}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-0.5 text-[var(--muted)]">
                        <Circle size={11} /> {r.pending}
                      </span>
                      <span className="ml-auto font-extrabold text-[var(--muted)]">{pct}%</span>
                    </div>
                  )}
                </div>
                {r.total_checks > 0 && (
                  <div className="w-14 h-14 flex-shrink-0 relative">
                    <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                      <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeWidth="3" className="text-[var(--card-border)]/40" />
                      <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeWidth="3"
                        strokeDasharray={`${(pct / 100) * 2 * Math.PI * 16} ${2 * Math.PI * 16}`}
                        className="text-emerald-500" strokeLinecap="round" />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center text-[11px] font-extrabold">{pct}%</div>
                  </div>
                )}
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
