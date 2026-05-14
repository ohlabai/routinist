'use client';

// 어드민 — 시리즈 메달 신청 관리 (build 134). /admin/medals 와 같은 패턴.

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Award, Phone, MapPin, Copy, Truck, Check, X, ChevronDown, ChevronUp, Trophy } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { isAdminEmail } from '@/lib/admin-emails';
import { getSupabase } from '@/lib/supabase';
import AppToast from '@/components/AppToast';

type Status = 'requested' | 'paid' | 'shipped' | 'delivered' | 'cancelled';

interface SeriesMedalRequest {
  user_id: string;
  series_id: string;
  user_email: string;
  user_name: string;
  user_avatar: string | null;
  series_name: string;
  series_emoji: string | null;
  awarded_at: string | null;
  requested_at: string;
  request_status: Status;
  shipping_name: string;
  shipping_phone: string;
  shipping_address: string;
  shipping_zipcode: string;
  payment_amount: number;
  tracking_carrier: string | null;
  tracking_number: string | null;
  admin_note: string | null;
}

const STATUS_OPTIONS: { id: Status; label: string; color: string }[] = [
  { id: 'requested', label: '접수', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  { id: 'paid', label: '결제', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  { id: 'shipped', label: '발송', color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
  { id: 'delivered', label: '완료', color: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200' },
  { id: 'cancelled', label: '취소', color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
];

const CARRIERS = ['CJ대한통운', '우체국택배', '한진택배', '롯데택배', '로젠택배', '기타'];

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 3600_000) return `${Math.max(1, Math.floor(ms / 60_000))}분`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}시간`;
  return `${Math.floor(ms / 86400_000)}일`;
}

export default function AdminSeriesMedalsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const [rows, setRows] = useState<SeriesMedalRequest[]>([]);
  const [filter, setFilter] = useState<Status | 'all'>('requested');
  const [loading, setLoading] = useState(true);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, { status: Status; carrier: string; tracking: string; note: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
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
      const { data, error } = await supabase.rpc('admin_list_series_medal_requests', {
        p_status: filter === 'all' ? null : filter,
        p_limit: 200,
      });
      if (error) throw error;
      setRows((data ?? []) as SeriesMedalRequest[]);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '조회 실패', 'warn');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const key = (r: SeriesMedalRequest) => `${r.user_id}:${r.series_id}`;

  const toggle = (r: SeriesMedalRequest) => {
    const k = key(r);
    setOpened(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else {
        next.add(k);
        if (!drafts[k]) setDrafts(d => ({ ...d, [k]: {
          status: r.request_status,
          carrier: r.tracking_carrier ?? '',
          tracking: r.tracking_number ?? '',
          note: r.admin_note ?? '',
        } }));
      }
      return next;
    });
  };

  const save = async (r: SeriesMedalRequest) => {
    const k = key(r);
    const d = drafts[k];
    if (!d) return;
    setSaving(k);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.rpc('admin_update_series_medal', {
        p_user_id: r.user_id,
        p_series_id: r.series_id,
        p_status: d.status,
        p_tracking_carrier: d.carrier || null,
        p_tracking_number: d.tracking || null,
        p_admin_note: d.note || null,
      });
      if (error) throw error;
      showToast('✨ 저장됨');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '저장 실패', 'warn');
    } finally {
      setSaving(null);
    }
  };

  const copyAddress = async (r: SeriesMedalRequest) => {
    const text = `${r.shipping_name} ${r.shipping_phone}\n(${r.shipping_zipcode}) ${r.shipping_address}`;
    try {
      await navigator.clipboard.writeText(text);
      showToast('주소 복사됨');
    } catch { /* ignore */ }
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
            <Trophy size={18} className="text-amber-500" /> 시리즈 메달 신청
          </h1>
          <span className="ml-auto text-xs text-[var(--muted)] font-bold">{rows.length}건</span>
        </div>
        <div className="px-4 pb-3 flex items-center gap-2 overflow-x-auto scrollbar-hide">
          {(['all', ...STATUS_OPTIONS.map(s => s.id)] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap active:scale-95 ${
                filter === s ? 'bg-amber-500 text-white shadow' : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
              }`}
            >
              {s === 'all' ? '전체' : STATUS_OPTIONS.find(o => o.id === s)?.label}
            </button>
          ))}
        </div>
      </header>

      <div className="p-4 space-y-2">
        {loading ? (
          [0, 1, 2].map(i => <div key={i} className="card p-4 h-24 animate-pulse" />)
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-sm text-[var(--muted)]">신청 없음</div>
        ) : (
          rows.map(r => {
            const k = key(r);
            const isOpen = opened.has(k);
            const d = drafts[k] ?? { status: r.request_status, carrier: r.tracking_carrier ?? '', tracking: r.tracking_number ?? '', note: r.admin_note ?? '' };
            const status = STATUS_OPTIONS.find(s => s.id === r.request_status);
            return (
              <article key={k} className="card p-4">
                <button onClick={() => toggle(r)} className="w-full text-left">
                  <div className="flex items-start gap-2.5">
                    <div className="w-11 h-11 rounded-full bg-[var(--card-border)]/40 overflow-hidden flex-shrink-0">
                      {r.user_avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.user_avatar} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-base font-bold text-[var(--muted)]">
                          {r.user_name.slice(0, 1)}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {status && <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${status.color}`}>{status.label}</span>}
                        <span className="text-xs font-extrabold inline-flex items-center gap-0.5 text-amber-600">
                          {r.series_emoji} {r.series_name}
                        </span>
                      </div>
                      <p className="text-sm font-extrabold mt-1 truncate">{r.user_name} <span className="text-[var(--muted)] font-normal">· {r.user_email}</span></p>
                      <p className="text-[11px] text-[var(--muted)] mt-0.5">신청 {timeAgo(r.requested_at)} 전 · {r.payment_amount.toLocaleString()}원</p>
                    </div>
                    {isOpen ? <ChevronUp size={16} className="text-[var(--muted)] flex-shrink-0" /> : <ChevronDown size={16} className="text-[var(--muted)] flex-shrink-0" />}
                  </div>
                </button>

                {isOpen && (
                  <div className="mt-3 pt-3 border-t border-[var(--card-border)]/40 space-y-3">
                    <div className="rounded-xl bg-[var(--card-border)]/20 p-3">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="text-[11px] font-extrabold text-[var(--muted)]">배송지</span>
                        <button onClick={() => copyAddress(r)} className="text-[11px] font-bold text-emerald-600 inline-flex items-center gap-0.5 active:scale-95">
                          <Copy size={10} /> 복사
                        </button>
                      </div>
                      <p className="text-sm font-bold">{r.shipping_name}</p>
                      <p className="text-xs text-[var(--muted)] inline-flex items-center gap-1 mt-0.5">
                        <Phone size={11} /> {r.shipping_phone}
                      </p>
                      <p className="text-xs text-[var(--muted)] inline-flex items-start gap-1 mt-0.5">
                        <MapPin size={11} className="mt-0.5 flex-shrink-0" />
                        <span>({r.shipping_zipcode}) {r.shipping_address}</span>
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-[var(--muted)] mb-1.5">상태</label>
                      <div className="grid grid-cols-5 gap-1">
                        {STATUS_OPTIONS.map(s => (
                          <button
                            key={s.id}
                            onClick={() => setDrafts(prev => ({ ...prev, [k]: { ...d, status: s.id } }))}
                            className={`py-2 rounded-lg text-[11px] font-bold active:scale-95 ${
                              d.status === s.id ? 'bg-amber-500 text-white shadow' : 'bg-[var(--card-border)]/30 text-[var(--muted)]'
                            }`}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-bold text-[var(--muted)] mb-1">택배사</label>
                        <select
                          value={d.carrier}
                          onChange={(e) => setDrafts(prev => ({ ...prev, [k]: { ...d, carrier: e.target.value } }))}
                          className="w-full px-3 py-2.5 rounded-xl border-2 border-[var(--card-border)] bg-[var(--background)] text-sm focus:outline-none focus:border-amber-500"
                        >
                          <option value="">선택</option>
                          {CARRIERS.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-[var(--muted)] mb-1">송장 번호</label>
                        <input
                          value={d.tracking}
                          onChange={(e) => setDrafts(prev => ({ ...prev, [k]: { ...d, tracking: e.target.value } }))}
                          placeholder="000000000000"
                          className="w-full px-3 py-2.5 rounded-xl border-2 border-[var(--card-border)] bg-[var(--background)] text-sm focus:outline-none focus:border-amber-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-[var(--muted)] mb-1">메모</label>
                      <input
                        value={d.note}
                        onChange={(e) => setDrafts(prev => ({ ...prev, [k]: { ...d, note: e.target.value } }))}
                        placeholder="결제 안내 / 재고 대기 등"
                        className="w-full px-3 py-2.5 rounded-xl border-2 border-[var(--card-border)] bg-[var(--background)] text-sm focus:outline-none focus:border-amber-500"
                      />
                    </div>

                    <button
                      onClick={() => save(r)}
                      disabled={saving === k}
                      className="w-full py-3 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 text-white font-extrabold text-sm disabled:opacity-50 active:scale-[0.98] inline-flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/30"
                    >
                      {saving === k ? '저장 중…' : <><Check size={16} /> 저장</>}
                    </button>
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2200} />}
    </div>
  );
}
