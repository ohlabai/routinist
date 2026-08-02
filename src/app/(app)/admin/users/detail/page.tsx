'use client';

// 어드민 — 회원 상세 (build 202 / Phase B).
// 활동·주문·마일리지·푸시·admin action 전체 history.
// 민감 액션: 푸시 발송 / 마일리지 지급 / 차단 / 영구 삭제. audit log 자동.

import { useEffect, useState, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, User, Send, Coins, ShieldOff, Trash2, AlertTriangle,
  Mail, MapPin, Calendar, Activity, Trophy, Bell, ShoppingBag,
  Loader2, Save, X, Eye, EyeOff,
} from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { isAdminEmail } from '@/lib/admin-emails';
import { getSupabase } from '@/lib/supabase';
import AppToast from '@/components/AppToast';

interface UserDetail {
  profile: {
    id: string; display_name: string | null; avatar_url: string | null;
    region_si: string | null; region_gu: string | null; region_dong: string | null;
    country_code: string | null; gender: string | null; birth_year: number | null;
    bio: string | null; is_public: boolean; mileage_balance: number;
    total_runs: number; total_distance_km: number; total_duration_seconds: number;
    created_at: string;
  } | null;
  auth_user: {
    email: string; email_confirmed_at: string | null;
    created_at: string; last_sign_in_at: string | null; provider: string;
  } | null;
  recent_activities: Array<{
    id: string; activity_date: string; distance_km: number;
    duration_seconds: number; source: string; activity_type: string | null;
  }>;
  recent_orders: Array<{
    id: string; order_no: string; status: string;
    total_krw: number; created_at: string; paid_at: string | null;
  }>;
  mileage_history: Array<{
    id: string; amount: number; tx_type: string; event_type: string;
    reason: string | null; created_at: string;
  }>;
  push_history: Array<{
    id: string; category: string; title: string; body: string;
    status: string; created_at: string; sent_at: string | null;
  }>;
  admin_action_log: Array<{
    id: string; actor_email: string; action: string;
    reason: string | null; payload: Record<string, unknown>; created_at: string;
  }>;
  personal_bests: Array<{ distance_meters: number; best_seconds: number; achieved_at: string }>;
}

type ActionKind = 'push' | 'mileage' | 'block' | 'delete' | null;

function AdminUserDetailInner() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id') ?? '';
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const [data, setData] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<ActionKind>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  // 액션 폼 state
  const [pushTitle, setPushTitle] = useState('');
  const [pushBody, setPushBody] = useState('');
  const [pushReason, setPushReason] = useState('');
  const [mileageAmount, setMileageAmount] = useState('');
  const [mileageReason, setMileageReason] = useState('');
  const [blockReason, setBlockReason] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!user || !isAdmin) { router.replace('/'); return; }
  }, [authLoading, user, isAdmin, router]);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data: res, error } = await supabase.rpc('get_admin_user_detail', { p_user_id: id });
      if (error) throw error;
      setData(res as UserDetail);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '조회 실패', 'warn');
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const resetForm = () => {
    setPushTitle(''); setPushBody(''); setPushReason('');
    setMileageAmount(''); setMileageReason('');
    setBlockReason('');
  };

  const handlePush = async () => {
    if (!pushTitle.trim() || !pushBody.trim()) { showToast('제목/내용 필수', 'warn'); return; }
    setBusy(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.rpc('admin_send_push', {
        p_user_id: id, p_title: pushTitle, p_body: pushBody, p_reason: pushReason || null,
      });
      if (error) throw error;
      showToast('푸시 enqueue 완료');
      setAction(null); resetForm(); load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '실패', 'warn');
    } finally { setBusy(false); }
  };

  const handleMileage = async () => {
    const amt = Number(mileageAmount);
    if (!amt || isNaN(amt)) { showToast('금액 입력 필요', 'warn'); return; }
    if (!mileageReason.trim()) { showToast('사유 필수', 'warn'); return; }
    setBusy(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.rpc('admin_grant_mileage', {
        p_user_id: id, p_amount: amt, p_reason: mileageReason,
      });
      if (error) throw error;
      showToast(amt > 0 ? `${amt.toLocaleString()}P 지급 완료` : `${Math.abs(amt).toLocaleString()}P 차감 완료`);
      setAction(null); resetForm(); load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '실패', 'warn');
    } finally { setBusy(false); }
  };

  const handleBlock = async () => {
    if (!blockReason.trim()) { showToast('차단 사유 필수', 'warn'); return; }
    setBusy(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.rpc('admin_block_user', { p_user_id: id, p_reason: blockReason });
      if (error) throw error;
      showToast('차단 처리됨');
      setAction(null); resetForm(); load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '실패', 'warn');
    } finally { setBusy(false); }
  };

  const handleDelete = async () => {
    if (!confirm('정말 영구 삭제할까요? 모든 데이터 (활동·주문·마일리지·사진) 가 사라집니다.')) return;
    setBusy(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.rpc('admin_delete_user', { p_user_id: id });
      if (error) throw error;
      showToast('영구 삭제됨');
      setTimeout(() => router.replace('/admin/users'), 800);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '실패', 'warn');
    } finally { setBusy(false); }
  };

  if (!isAdmin) return null;

  if (loading || !data) {
    return <div className="flex justify-center py-20"><Loader2 size={20} className="animate-spin text-emerald-500" /></div>;
  }

  const p = data.profile;
  const au = data.auth_user;

  return (
    <div className="bg-[var(--background)] min-h-screen pb-16">
      <header className="sticky top-0 z-30 bg-[var(--background)]/85 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="max-w-4xl mx-auto flex items-center gap-2 px-4 py-3">
          <Link href="/admin/users" className="w-10 h-10 flex items-center justify-center rounded-full active:bg-[var(--card-border)]/30">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-xl font-extrabold tracking-tight inline-flex items-center gap-1.5">
            <User size={18} className="text-emerald-500" /> 회원 상세
          </h1>
          {p && !p.is_public && (
            <span className="ml-2 inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[12px] font-extrabold bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
              <EyeOff size={10} /> 감춤
            </span>
          )}
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 pt-4 space-y-4">
        {/* 프로필 hero */}
        {p && au && (
          <div className="card p-5 flex items-start gap-4">
            <div className="w-16 h-16 rounded-2xl bg-[var(--card-border)]/40 overflow-hidden flex-shrink-0">
              {p.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xl font-bold text-[var(--muted)]">
                  {p.display_name?.slice(0, 1) ?? '?'}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-lg font-extrabold">{p.display_name ?? '익명'}</p>
              <p className="text-xs text-[var(--muted)] inline-flex items-center gap-1"><Mail size={11} /> {au.email}</p>
              <p className="text-xs text-[var(--muted)] inline-flex items-center gap-1 mt-1">
                <Calendar size={11} /> {fmtDateTime(au.created_at)} 가입
                <span className="ml-2">· {au.provider ?? 'email'}</span>
              </p>
              {p.region_si && (
                <p className="text-xs text-[var(--muted)] inline-flex items-center gap-1 mt-0.5">
                  <MapPin size={11} /> {p.region_si} {p.region_gu ?? ''} {p.region_dong ?? ''}
                </p>
              )}
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-xs text-[var(--muted)]">마지막 로그인</p>
              <p className="text-xs font-bold">{au.last_sign_in_at ? fmtDateTime(au.last_sign_in_at) : '-'}</p>
            </div>
          </div>
        )}

        {/* 통계 카드 */}
        {p && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <StatChip icon={<Activity size={12} />} label="활동" value={`${p.total_runs}회`} color="emerald" />
            <StatChip icon={<Activity size={12} />} label="총 km" value={Number(p.total_distance_km ?? 0).toFixed(1)} color="emerald" />
            <StatChip icon={<Coins size={12} />} label="마일리지" value={`${p.mileage_balance.toLocaleString()}P`} color="amber" />
            <StatChip icon={<Trophy size={12} />} label="PB" value={`${data.personal_bests.length}개`} color="violet" />
          </div>
        )}

        {/* 액션 버튼 */}
        <div className="card p-3 grid grid-cols-2 md:grid-cols-4 gap-2">
          <ActionBtn icon={<Send size={14} />} label="푸시 발송" color="emerald" onClick={() => setAction('push')} />
          <ActionBtn icon={<Coins size={14} />} label="마일리지" color="amber" onClick={() => setAction('mileage')} />
          <ActionBtn icon={<ShieldOff size={14} />} label="차단" color="rose" onClick={() => setAction('block')} />
          <ActionBtn icon={<Trash2 size={14} />} label="영구 삭제" color="rose" onClick={handleDelete} />
        </div>

        {/* 액션 폼 (펼침) */}
        {action === 'push' && (
          <ActionForm title="푸시 발송" onCancel={() => { setAction(null); resetForm(); }}
            onSave={handlePush} busy={busy} icon={<Send size={14} className="text-emerald-500" />}>
            <FormInput label="제목 *" value={pushTitle} onChange={setPushTitle} />
            <FormInput label="내용 *" value={pushBody} onChange={setPushBody} multiline />
            <FormInput label="발송 사유 (내부 로그)" value={pushReason} onChange={setPushReason} />
          </ActionForm>
        )}

        {action === 'mileage' && (
          <ActionForm title="마일리지 지급 / 차감" onCancel={() => { setAction(null); resetForm(); }}
            onSave={handleMileage} busy={busy} icon={<Coins size={14} className="text-amber-500" />}>
            <FormInput label="금액 (양수=지급, 음수=차감) *" value={mileageAmount} onChange={setMileageAmount} type="number" />
            <FormInput label="사유 *" value={mileageReason} onChange={setMileageReason} placeholder="예: 행사 보상, 결제 오류 보전" />
          </ActionForm>
        )}

        {action === 'block' && (
          <ActionForm title="차단 (감춤 처리)" onCancel={() => { setAction(null); resetForm(); }}
            onSave={handleBlock} busy={busy} icon={<ShieldOff size={14} className="text-rose-500" />}>
            <p className="text-[13px] text-[var(--muted)] mb-1">랭킹·검색에서 노출 제외됩니다. 영구 삭제 아님.</p>
            <FormInput label="차단 사유 *" value={blockReason} onChange={setBlockReason} placeholder="예: 위반 신고 다수, 부정 활동" multiline />
          </ActionForm>
        )}

        {/* History 섹션들 */}
        <HistoryCard title="최근 활동" icon={<Activity size={14} />} count={data.recent_activities.length}>
          {data.recent_activities.length === 0 ? <Empty /> : (
            <ul className="divide-y divide-[var(--card-border)]/40 text-xs">
              {data.recent_activities.slice(0, 10).map(a => (
                <li key={a.id} className="py-2 flex items-center justify-between">
                  <span>{a.activity_date}</span>
                  <span className="tabular-nums">{Number(a.distance_km).toFixed(2)}km</span>
                  <span className="text-[var(--muted)]">{a.source}</span>
                </li>
              ))}
            </ul>
          )}
        </HistoryCard>

        <HistoryCard title="주문" icon={<ShoppingBag size={14} />} count={data.recent_orders.length}>
          {data.recent_orders.length === 0 ? <Empty /> : (
            <ul className="divide-y divide-[var(--card-border)]/40 text-xs">
              {data.recent_orders.map(o => (
                <li key={o.id} className="py-2 flex items-center justify-between">
                  <span className="font-mono text-[12px]">{o.order_no}</span>
                  <span className={`text-[12px] font-bold ${o.status === 'paid' ? 'text-emerald-600' : 'text-[var(--muted)]'}`}>{o.status}</span>
                  <span className="tabular-nums">{Number(o.total_krw).toLocaleString()}원</span>
                  <span className="text-[var(--muted)]">{fmtDate(o.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </HistoryCard>

        <HistoryCard title="마일리지" icon={<Coins size={14} />} count={data.mileage_history.length}>
          {data.mileage_history.length === 0 ? <Empty /> : (
            <ul className="divide-y divide-[var(--card-border)]/40 text-xs">
              {data.mileage_history.map(m => (
                <li key={m.id} className="py-2 flex items-center justify-between gap-2">
                  <span className="text-[12px] text-[var(--muted)]">{m.event_type}</span>
                  <span className={`tabular-nums font-bold ${m.amount > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {m.amount > 0 ? '+' : ''}{m.amount.toLocaleString()}P
                  </span>
                  <span className="flex-1 truncate text-[12px] text-[var(--muted)]">{m.reason ?? ''}</span>
                  <span className="text-[12px] text-[var(--muted)]">{fmtDate(m.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </HistoryCard>

        <HistoryCard title="푸시 발송" icon={<Bell size={14} />} count={data.push_history.length}>
          {data.push_history.length === 0 ? <Empty /> : (
            <ul className="divide-y divide-[var(--card-border)]/40 text-xs">
              {data.push_history.map(ph => (
                <li key={ph.id} className="py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-bold text-violet-600">{ph.category}</span>
                    <span className={`text-[12px] font-bold ${ph.status === 'sent' ? 'text-emerald-600' : 'text-[var(--muted)]'}`}>{ph.status}</span>
                    <span className="text-[12px] text-[var(--muted)] ml-auto">{fmtDate(ph.created_at)}</span>
                  </div>
                  <p className="font-bold mt-0.5">{ph.title}</p>
                  <p className="text-[var(--muted)] truncate">{ph.body}</p>
                </li>
              ))}
            </ul>
          )}
        </HistoryCard>

        {data.personal_bests.length > 0 && (
          <HistoryCard title="자기 기록 (PB)" icon={<Trophy size={14} />} count={data.personal_bests.length}>
            <ul className="divide-y divide-[var(--card-border)]/40 text-xs">
              {data.personal_bests.map(pb => {
                const label = pb.distance_meters === 42195 ? '풀' : pb.distance_meters === 21097 ? '하프' : `${pb.distance_meters / 1000}km`;
                const m = Math.floor(pb.best_seconds / 60);
                const s = Math.floor(pb.best_seconds % 60);
                return (
                  <li key={pb.distance_meters} className="py-2 flex items-center justify-between">
                    <span className="font-bold">{label}</span>
                    <span className="tabular-nums">{m}:{s.toString().padStart(2, '0')}</span>
                    <span className="text-[var(--muted)] text-[12px]">{fmtDate(pb.achieved_at)}</span>
                  </li>
                );
              })}
            </ul>
          </HistoryCard>
        )}

        <HistoryCard title="관리자 액션 로그" icon={<AlertTriangle size={14} />} count={data.admin_action_log.length}>
          {data.admin_action_log.length === 0 ? <Empty /> : (
            <ul className="divide-y divide-[var(--card-border)]/40 text-xs">
              {data.admin_action_log.map(l => (
                <li key={l.id} className="py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-bold text-rose-600">{l.action}</span>
                    <span className="text-[12px] text-[var(--muted)] ml-auto">{fmtDateTime(l.created_at)}</span>
                  </div>
                  <p className="text-[var(--muted)]">{l.actor_email} · {l.reason ?? '-'}</p>
                </li>
              ))}
            </ul>
          )}
        </HistoryCard>
      </div>

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2500} />}
    </div>
  );
}

function StatChip({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: 'emerald' | 'amber' | 'violet' }) {
  const cls = color === 'emerald' ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300'
    : color === 'amber' ? 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300'
    : 'bg-violet-50 dark:bg-violet-950/20 text-violet-700 dark:text-violet-300';
  return (
    <div className={`rounded-xl px-3 py-2 ${cls}`}>
      <div className="text-[12px] font-bold uppercase tracking-widest inline-flex items-center gap-1">{icon} {label}</div>
      <p className="text-lg font-extrabold tabular-nums">{value}</p>
    </div>
  );
}

function ActionBtn({ icon, label, color, onClick }: { icon: React.ReactNode; label: string; color: 'emerald' | 'amber' | 'rose'; onClick: () => void }) {
  const cls = color === 'emerald' ? 'bg-emerald-500 shadow-emerald-500/25'
    : color === 'amber' ? 'bg-amber-500 shadow-amber-500/25'
    : 'bg-rose-500 shadow-rose-500/25';
  return (
    <button onClick={onClick}
      className={`${cls} text-white py-2.5 rounded-xl font-extrabold text-xs active:scale-95 shadow-md inline-flex items-center justify-center gap-1.5`}>
      {icon} {label}
    </button>
  );
}

function ActionForm({ title, icon, children, onSave, onCancel, busy }:
  { title: string; icon: React.ReactNode; children: React.ReactNode; onSave: () => void; onCancel: () => void; busy: boolean }) {
  return (
    <div className="card p-4 border-emerald-200 dark:border-emerald-900/40 space-y-2.5">
      <div className="flex items-center gap-2"><span>{icon}</span><h3 className="text-sm font-extrabold">{title}</h3></div>
      {children}
      <div className="flex gap-2 pt-1">
        <button onClick={onCancel} disabled={busy}
          className="flex-1 py-2.5 rounded-xl border-2 border-[var(--card-border)] text-[var(--muted)] text-sm font-bold active:scale-95 disabled:opacity-50 inline-flex items-center justify-center gap-1">
          <X size={14} /> 취소
        </button>
        <button onClick={onSave} disabled={busy}
          className="flex-[2] py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-extrabold active:scale-95 disabled:opacity-50 shadow-md shadow-emerald-500/30 inline-flex items-center justify-center gap-1">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} 실행
        </button>
      </div>
    </div>
  );
}

function FormInput({ label, value, onChange, placeholder, multiline, type = 'text' }:
  { label: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; type?: string }) {
  return (
    <div>
      <label className="text-[13px] font-bold text-[var(--muted)] block mb-1">{label}</label>
      {multiline ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} rows={3} placeholder={placeholder}
          className="w-full px-3 py-2 rounded-xl bg-[var(--background)] border border-[var(--card-border)] text-sm focus:outline-none focus:border-emerald-500 resize-none" />
      ) : (
        <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          className="w-full px-3 py-2 rounded-xl bg-[var(--background)] border border-[var(--card-border)] text-sm focus:outline-none focus:border-emerald-500" />
      )}
    </div>
  );
}

function HistoryCard({ title, icon, count, children }: { title: string; icon: React.ReactNode; count: number; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-emerald-500">{icon}</span>
        <h3 className="text-sm font-extrabold">{title}</h3>
        <span className="ml-auto text-[12px] text-[var(--muted)] font-bold">{count}건</span>
      </div>
      {children}
    </div>
  );
}

function Empty() { return <p className="text-xs text-[var(--muted)] text-center py-3">기록 없음</p>; }
function fmtDate(iso: string): string { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; }
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function AdminUserDetailPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 size={20} className="animate-spin text-emerald-500" /></div>}>
      <AdminUserDetailInner />
    </Suspense>
  );
}
