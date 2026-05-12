'use client';

// 클럽 마일리지 후원 (build 100). /mileage/donate?club_id=X 진입.
// donate_mileage_to_club RPC — 100 P 부터 가능. mileage_transactions 자동 로그.

import { useEffect, useState, Suspense, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Heart, Gift, Users } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { fetchMileageBalance } from '@/lib/mileage-data';
import AppLogo from '@/components/AppLogo';
import AppToast from '@/components/AppToast';

interface ClubInfo {
  id: string;
  name: string;
  description: string | null;
  member_count?: number;
  total_donated?: number;
}

const PRESET_AMOUNTS = [100, 500, 1000, 3000, 10000];

function DonateInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const clubIdParam = searchParams.get('club_id');

  const [clubs, setClubs] = useState<ClubInfo[]>([]);
  const [selectedClubId, setSelectedClubId] = useState<string | null>(clubIdParam);
  const [amount, setAmount] = useState(500);
  const [message, setMessage] = useState('');
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const supabase = getSupabase();
      // 내가 멤버인 클럽 목록
      const { data: memberRows } = await supabase
        .from('club_members')
        .select('club_id, clubs!inner(id, name, description)')
        .eq('user_id', user.id);
      const rows: ClubInfo[] = (memberRows ?? []).map((r: {
        clubs: { id: string; name: string; description: string | null } | { id: string; name: string; description: string | null }[];
      }) => {
        const c = Array.isArray(r.clubs) ? r.clubs[0] : r.clubs;
        return { id: c.id, name: c.name, description: c.description };
      });
      setClubs(rows);

      // 잔액
      const bal = await fetchMileageBalance(user.id);
      setBalance(bal);

      // URL param 의 club 이 멤버가 아니면 첫 클럽으로
      if (clubIdParam && !rows.find(c => c.id === clubIdParam)) {
        setSelectedClubId(rows[0]?.id ?? null);
      } else if (!selectedClubId && rows.length > 0) {
        setSelectedClubId(rows[0].id);
      }
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, clubIdParam]);

  useEffect(() => { load(); }, [load]);

  const handleDonate = async () => {
    if (!user || !selectedClubId) return;
    if (amount < 100) {
      setToast({ text: '최소 100 P 부터 후원 가능', tone: 'warn' });
      return;
    }
    if (amount > balance) {
      setToast({ text: `잔액 부족 — 보유 ${balance.toLocaleString()} P`, tone: 'warn' });
      return;
    }

    setSubmitting(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.rpc('donate_mileage_to_club', {
        p_club_id: selectedClubId,
        p_amount: amount,
        p_message: message.trim() || null,
      });
      if (error) throw error;
      setToast({ text: `✅ ${amount.toLocaleString()} P 후원 완료!`, tone: 'ok' });
      setBalance(b => b - amount);
      setMessage('');
      setTimeout(() => router.push('/mileage'), 1500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '실패';
      setToast({ text: msg, tone: 'warn' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-lg mx-auto p-8 flex justify-center">
        <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/85 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="px-3 py-3 flex items-center gap-2">
          <button
            onClick={() => router.back()}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--card-border)]/30 active:scale-90 transition"
            aria-label="뒤로"
          >
            <ArrowLeft size={18} />
          </button>
          <AppLogo size={24} />
          <h1 className="text-base font-extrabold tracking-tight">클럽 후원</h1>
        </div>
      </header>

      <div className="px-4 pt-4 space-y-4">
        {clubs.length === 0 ? (
          <div className="card p-6 text-center">
            <Users size={28} className="mx-auto text-[var(--muted)] opacity-40 mb-2" />
            <p className="text-sm font-semibold text-[var(--foreground)]">가입한 클럽이 없어요</p>
            <p className="text-xs text-[var(--muted)] mt-1 mb-3">클럽 가입 후 후원할 수 있어요</p>
            <Link href="/social/clubs" className="inline-block px-4 py-2 rounded-full bg-emerald-500 text-white text-xs font-bold">
              클럽 둘러보기 →
            </Link>
          </div>
        ) : (
          <>
            {/* 잔액 + 후원 안내 */}
            <div className="rounded-3xl bg-gradient-to-br from-pink-50 via-white to-rose-50/30 dark:from-pink-950/30 dark:via-zinc-900 dark:to-rose-950/10 border border-pink-200/40 dark:border-pink-900/30 p-5">
              <div className="flex items-center gap-2 mb-1">
                <Heart size={16} className="text-pink-500" />
                <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wide">마일리지 후원</p>
              </div>
              <p className="text-xs text-[var(--muted)] mt-2">내 마일리지를 클럽 활동에 후원해보세요. 클럽장이 운영비로 사용하거나 멤버 보상에 쓸 수 있어요.</p>
              <div className="mt-3 inline-flex items-center gap-1 bg-white/80 dark:bg-zinc-900/60 backdrop-blur-sm px-3 py-1.5 rounded-full">
                <span className="text-[10px] text-[var(--muted)] font-bold">잔액</span>
                <span className="text-sm font-extrabold text-emerald-600 tabular-nums">{balance.toLocaleString()} P</span>
              </div>
            </div>

            {/* 클럽 선택 */}
            <div className="card p-4">
              <label className="block text-xs font-bold text-[var(--muted)] mb-2">후원할 클럽</label>
              <div className="space-y-1.5">
                {clubs.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedClubId(c.id)}
                    className={`w-full flex items-center gap-3 p-3 rounded-2xl border transition active:scale-[0.98] ${
                      selectedClubId === c.id
                        ? 'bg-pink-50 dark:bg-pink-950/40 border-pink-300 dark:border-pink-700 shadow-sm'
                        : 'bg-[var(--card)] border-[var(--card-border)]'
                    }`}
                  >
                    <div className="w-9 h-9 rounded-xl bg-pink-100 dark:bg-pink-900/30 flex items-center justify-center flex-shrink-0">
                      <Users size={16} className="text-pink-600" />
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <p className={`text-sm font-bold truncate ${selectedClubId === c.id ? 'text-pink-700 dark:text-pink-400' : 'text-[var(--foreground)]'}`}>
                        {c.name}
                      </p>
                      {c.description && (
                        <p className="text-[11px] text-[var(--muted)] truncate">{c.description}</p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* 금액 선택 */}
            <div className="card p-4">
              <label className="block text-xs font-bold text-[var(--muted)] mb-2">금액 (P)</label>
              <div className="grid grid-cols-3 gap-2 mb-2">
                {PRESET_AMOUNTS.map(p => (
                  <button
                    key={p}
                    onClick={() => setAmount(p)}
                    className={`py-2 rounded-xl text-sm font-bold transition ${
                      amount === p
                        ? 'bg-pink-500 text-white shadow-sm'
                        : 'bg-[var(--card-border)]/30 text-[var(--foreground)]'
                    }`}
                  >
                    {p.toLocaleString()}
                  </button>
                ))}
              </div>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
                min={100}
                step={100}
                className="w-full px-3 py-2 rounded-xl border border-[var(--card-border)] bg-[var(--background)] text-sm tabular-nums text-right font-bold"
              />
              <p className="text-[10px] text-[var(--muted)] mt-1 text-center">최소 100 P · 보유 {balance.toLocaleString()} P</p>
            </div>

            {/* 메시지 */}
            <div className="card p-4">
              <label className="block text-xs font-bold text-[var(--muted)] mb-2">한 줄 응원 (선택)</label>
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 100))}
                placeholder="예: 함께 달려요!"
                className="w-full px-3 py-2 rounded-xl border border-[var(--card-border)] bg-[var(--background)] text-sm"
              />
              <p className="text-[10px] text-[var(--muted)] mt-1 text-right">{message.length}/100</p>
            </div>

            <button
              onClick={handleDonate}
              disabled={submitting || !selectedClubId || amount < 100 || amount > balance}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-br from-pink-500 to-rose-500 text-white font-extrabold text-sm disabled:opacity-50 active:scale-[0.98] inline-flex items-center justify-center gap-1.5 shadow-md shadow-pink-500/25"
            >
              <Gift size={16} />
              {submitting ? '후원 중…' : `${amount.toLocaleString()} P 후원하기`}
            </button>
          </>
        )}
      </div>

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2500} />}
    </div>
  );
}

export default function DonatePage() {
  return (
    <Suspense fallback={<div className="p-8 flex justify-center"><div className="animate-spin w-6 h-6 border-2 border-pink-500 border-t-transparent rounded-full" /></div>}>
      <DonateInner />
    </Suspense>
  );
}
