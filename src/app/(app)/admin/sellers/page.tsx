'use client';

// build 205 #15: 어드민 — 판매자 신청 승인/반려.

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, X, Clock, Store, Phone, Mail, Building2 } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import AppToast from '@/components/AppToast';
import { isAdminEmail } from '@/lib/admin-emails';

interface Application {
  id: string;
  user_id: string;
  brand_name: string;
  business_no: string;
  business_name: string;
  owner_name: string;
  contact_phone: string;
  contact_email: string;
  payout_bank: string;
  payout_account: string;
  payout_holder: string;
  ship_zip: string;
  ship_address: string;
  ship_phone: string;
  status: 'pending' | 'approved' | 'rejected';
  submitted_at: string;
  rejection_reason: string | null;
}

type Filter = 'pending' | 'approved' | 'rejected';
const FILTER_LABELS: Record<Filter, string> = { pending: '심사 대기', approved: '승인됨', rejected: '반려' };

export default function AdminSellersPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const [filter, setFilter] = useState<Filter>('pending');
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    if (!isAdmin) { router.replace('/'); return; }
  }, [authLoading, user, isAdmin, router]);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2500);
  };

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const sb = getSupabase();
      const { data } = await sb.from('seller_applications')
        .select('*').eq('status', filter)
        .order('submitted_at', { ascending: false }).limit(100);
      setApps((data ?? []) as Application[]);
    } finally { setLoading(false); }
  }, [filter, isAdmin]);
  useEffect(() => { load(); }, [load]);

  const approve = async (id: string) => {
    if (!confirm('이 신청을 승인할까요?')) return;
    try {
      const sb = getSupabase();
      const { error } = await sb.rpc('approve_seller_application', { p_application_id: id });
      if (error) throw error;
      showToast('승인 완료');
      load();
    } catch (e) { showToast(e instanceof Error ? e.message : '실패', 'warn'); }
  };

  const reject = async (id: string) => {
    const reason = window.prompt('반려 사유 (셀러에게 전달됨)');
    if (!reason?.trim()) return;
    try {
      const sb = getSupabase();
      const { error } = await sb.rpc('reject_seller_application', { p_application_id: id, p_reason: reason });
      if (error) throw error;
      showToast('반려 완료');
      load();
    } catch (e) { showToast(e instanceof Error ? e.message : '실패', 'warn'); }
  };

  if (authLoading || !isAdmin) return <div className="flex justify-center py-20"><div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" /></div>;

  return (
    <div className="max-w-2xl mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-extrabold tracking-tight flex-1">판매자 신청</h1>
        </div>
        <div className="flex gap-1.5 px-3 pb-3 overflow-x-auto">
          {(Object.keys(FILTER_LABELS) as Filter[]).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition active:scale-95 ${
                filter === f ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30' : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
              }`}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>
      </header>

      <div className="px-4 pt-4 space-y-3">
        {loading ? (
          [0,1,2].map(i => <div key={i} className="card p-5 animate-pulse h-32" />)
        ) : apps.length === 0 ? (
          <div className="text-center py-16">
            <Store size={36} className="mx-auto text-[var(--muted)] opacity-40 mb-2" />
            <p className="text-sm text-[var(--muted)]">{FILTER_LABELS[filter]} 신청이 없어요</p>
          </div>
        ) : apps.map(app => (
          <div key={app.id} className="card p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-base font-extrabold">{app.brand_name}</p>
                <p className="text-xs text-[var(--muted)] truncate">
                  {app.business_name} · {app.business_no} · {app.owner_name}
                </p>
              </div>
              {filter === 'pending' && (
                <div className="flex gap-1.5 flex-shrink-0">
                  <button onClick={() => approve(app.id)} aria-label="승인"
                    className="w-9 h-9 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center active:scale-90">
                    <Check size={16} />
                  </button>
                  <button onClick={() => reject(app.id)} aria-label="반려"
                    className="w-9 h-9 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center active:scale-90">
                    <X size={16} />
                  </button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              <Info icon={<Phone size={11} />} value={app.contact_phone} />
              <Info icon={<Mail size={11} />} value={app.contact_email} />
              <Info icon={<Building2 size={11} />} value={`${app.payout_bank} ${app.payout_account}`} />
              <Info icon={<Clock size={11} />} value={new Date(app.submitted_at).toLocaleDateString('ko-KR')} />
            </div>
            <p className="text-[11px] text-[var(--muted)] break-keep">
              📦 ({app.ship_zip}) {app.ship_address} · {app.ship_phone}
            </p>
            {app.rejection_reason && (
              <p className="text-[11px] text-rose-500 bg-rose-50 dark:bg-rose-950/20 rounded-lg p-2 break-keep">
                반려 사유: {app.rejection_reason}
              </p>
            )}
          </div>
        ))}
      </div>

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2500} />}
    </div>
  );
}

function Info({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[var(--muted)]">
      <span className="opacity-60">{icon}</span>
      <span className="truncate">{value}</span>
    </div>
  );
}
