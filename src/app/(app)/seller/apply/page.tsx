'use client';

// build 205 #15: 셀러(판매자) 신청 페이지.
// 입력: 브랜드, 사업자번호, 정산 계좌, 출고지. 제출 후 어드민 승인 대기.

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Clock, XCircle, Store } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import AppToast from '@/components/AppToast';
import { useI18n } from '@/lib/i18n';

interface ApplicationRow {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  brand_name: string;
  submitted_at: string;
  rejection_reason: string | null;
}

export default function SellerApplyPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { tt } = useI18n();
  const [form, setForm] = useState({
    brand_name: '', business_no: '', business_name: '', owner_name: '',
    contact_phone: '', contact_email: '',
    payout_bank: '', payout_account: '', payout_holder: '',
    ship_zip: '', ship_address: '', ship_phone: '',
  });
  const [latest, setLatest] = useState<ApplicationRow | null>(null);
  const [isSeller, setIsSeller] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login?redirect=/seller/apply');
  }, [authLoading, user, router]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const sb = getSupabase();
      const [apps, sellers] = await Promise.all([
        sb.from('seller_applications').select('id, status, brand_name, submitted_at, rejection_reason')
          .eq('user_id', user.id).order('submitted_at', { ascending: false }).limit(1),
        sb.from('sellers').select('id, status').eq('user_id', user.id).maybeSingle(),
      ]);
      setLatest(apps.data?.[0] ?? null);
      setIsSeller(sellers.data?.status === 'active');
      // 이메일 기본값
      if (user.email) setForm(f => ({ ...f, contact_email: f.contact_email || user.email! }));
    } finally { setLoading(false); }
  }, [user]);
  useEffect(() => { load(); }, [load]);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 3500);
  };

  const submit = async () => {
    if (!user) return;
    for (const v of Object.values(form)) {
      if (!v.trim()) { showToast(tt('모든 항목을 입력해주세요'), 'warn'); return; }
    }
    setSubmitting(true);
    try {
      const sb = getSupabase();
      const { error } = await sb.from('seller_applications').insert({ ...form, user_id: user.id });
      if (error) throw error;
      showToast(tt('신청이 접수되었어요. 영업일 기준 1~3일 안에 검토됩니다.'));
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : tt('실패'), 'warn');
    } finally { setSubmitting(false); }
  };

  if (loading || authLoading) {
    return <div className="flex justify-center py-20"><div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" /></div>;
  }

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-extrabold tracking-tight flex-1">{tt('판매자 신청')}</h1>
        </div>
      </header>

      <div className="px-4 pt-4 space-y-4">
        {isSeller ? (
          <div className="card p-5 bg-emerald-50/40 dark:bg-emerald-950/15 border-emerald-200/50 dark:border-emerald-900/40">
            <div className="flex items-center gap-3 mb-2">
              <CheckCircle2 className="text-emerald-500" size={28} />
              <h2 className="font-extrabold text-lg">{tt('이미 판매자세요!')}</h2>
            </div>
            <p className="text-sm text-[var(--muted)] mb-3">{tt('상품을 직접 등록하고 매출 정산을 받아볼 수 있어요.')}</p>
            <Link href="/seller/products" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-emerald-500 text-white text-sm font-extrabold active:scale-95">
              <Store size={14} /> {tt('셀러 콘솔로 가기')}
            </Link>
          </div>
        ) : latest?.status === 'pending' ? (
          <div className="card p-5 bg-amber-50/40 dark:bg-amber-950/15 border-amber-200/50 dark:border-amber-900/40">
            <div className="flex items-center gap-3 mb-2">
              <Clock className="text-amber-500" size={28} />
              <h2 className="font-extrabold text-lg">{tt('심사 중이에요')}</h2>
            </div>
            <p className="text-sm text-[var(--muted)]">
              <strong>{latest.brand_name}</strong> 신청서가 접수되었어요. 영업일 기준 1~3일 안에 결과를 알려드릴게요.
            </p>
          </div>
        ) : latest?.status === 'rejected' ? (
          <div className="card p-5 bg-rose-50/40 dark:bg-rose-950/15 border-rose-200/50 dark:border-rose-900/40">
            <div className="flex items-center gap-3 mb-2">
              <XCircle className="text-rose-500" size={28} />
              <h2 className="font-extrabold text-lg">{tt('반려되었어요')}</h2>
            </div>
            {latest.rejection_reason && <p className="text-sm text-[var(--muted)] mb-3 break-keep">{latest.rejection_reason}</p>}
            <p className="text-xs text-[var(--muted)]">아래 정보를 다시 입력하시면 재신청할 수 있어요.</p>
          </div>
        ) : null}

        {!isSeller && latest?.status !== 'pending' && (
          <>
            <Section title="브랜드 정보">
              <FormRow label="브랜드명 *"><input value={form.brand_name} onChange={e => setForm(f => ({ ...f, brand_name: e.target.value }))} /></FormRow>
              <FormRow label="사업자등록번호 *"><input value={form.business_no} onChange={e => setForm(f => ({ ...f, business_no: e.target.value }))} placeholder="000-00-00000" /></FormRow>
              <FormRow label="상호 *"><input value={form.business_name} onChange={e => setForm(f => ({ ...f, business_name: e.target.value }))} /></FormRow>
              <FormRow label="대표자명 *"><input value={form.owner_name} onChange={e => setForm(f => ({ ...f, owner_name: e.target.value }))} /></FormRow>
            </Section>

            <Section title="연락처">
              <FormRow label="연락 전화 *"><input value={form.contact_phone} onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))} placeholder="010-0000-0000" /></FormRow>
              <FormRow label="이메일 *"><input value={form.contact_email} onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))} type="email" /></FormRow>
            </Section>

            <Section title="정산 계좌">
              <FormRow label="은행명 *"><input value={form.payout_bank} onChange={e => setForm(f => ({ ...f, payout_bank: e.target.value }))} placeholder="국민은행" /></FormRow>
              <FormRow label="계좌번호 *"><input value={form.payout_account} onChange={e => setForm(f => ({ ...f, payout_account: e.target.value }))} /></FormRow>
              <FormRow label="예금주명 *"><input value={form.payout_holder} onChange={e => setForm(f => ({ ...f, payout_holder: e.target.value }))} /></FormRow>
            </Section>

            <Section title="출고지">
              <FormRow label="우편번호 *"><input value={form.ship_zip} onChange={e => setForm(f => ({ ...f, ship_zip: e.target.value }))} /></FormRow>
              <FormRow label="주소 *"><input value={form.ship_address} onChange={e => setForm(f => ({ ...f, ship_address: e.target.value }))} /></FormRow>
              <FormRow label="출고지 전화 *"><input value={form.ship_phone} onChange={e => setForm(f => ({ ...f, ship_phone: e.target.value }))} /></FormRow>
            </Section>

            <button
              onClick={submit}
              disabled={submitting}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-sm font-extrabold shadow-md shadow-emerald-500/30 active:scale-95 disabled:opacity-60"
            >
              {submitting ? tt('제출 중...') : tt('판매자 신청 제출')}
            </button>

            <p className="text-[11px] text-[var(--muted)] text-center break-keep">
              개인사업자/법인 모두 가능합니다. 신청 후 영업일 기준 1~3일 내 검토되며, 결과는 이메일로 알려드려요.
              수수료는 매출의 10%이며, 정산은 매주 월요일에 지급됩니다.
            </p>
          </>
        )}
      </div>

      <style jsx>{`
        :global(input) {
          width: 100%;
          padding: 0.625rem 0.75rem;
          border-radius: 0.75rem;
          border: 1px solid var(--card-border);
          background: var(--background);
          font-size: 0.875rem;
        }
        :global(input:focus) { outline: none; border-color: #10b981; }
      `}</style>

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={3500} />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4 space-y-2.5">
      <h3 className="text-xs font-extrabold text-[var(--muted)] uppercase tracking-wider mb-1">{title}</h3>
      {children}
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-bold text-[var(--foreground)]">{label}</span>
      {children}
    </label>
  );
}
