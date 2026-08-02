'use client';

// 마일리지 선물 — 모던 모바일 UX/UI (에메랄드 그린).

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { fetchMileageBalance, giftMileage } from '@/lib/mileage-data';
import { searchUsers } from '@/lib/social-data';
import { ArrowLeft, Search, Gift, X, Coins, Heart } from 'lucide-react';
import type { Profile } from '@/types';
import AppLogo from '@/components/AppLogo';

export default function GiftMileagePage() {
  const router = useRouter();
  const { user } = useAuth();
  const [balance, setBalance] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);
  const [amount, setAmount] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (user) fetchMileageBalance(user.id).then(setBalance);
  }, [user]);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) { setSearchResults([]); return; }
    const results = await searchUsers(query);
    setSearchResults(results.filter((u) => u.id !== user?.id));
  };

  const handleGift = async () => {
    if (!user || !selectedUser || !amount) return;
    const pts = parseInt(amount);
    if (isNaN(pts) || pts <= 0) { setMessage('올바른 금액을 입력하세요'); return; }
    if (pts > balance) { setMessage('마일리지가 부족합니다'); return; }

    setSending(true);
    setMessage('');
    try {
      await giftMileage(user.id, selectedUser.id, pts);
      setBalance((b) => b - pts);
      setMessage(`${selectedUser.display_name}님에게 ${pts.toLocaleString()}P 를 선물했어요 🎁`);
      setSelectedUser(null); setAmount(''); setSearchQuery('');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '선물 실패');
    } finally { setSending(false); }
  };

  const isError = message.includes('실패') || message.includes('부족') || message.includes('올바른');

  return (
    <div className="max-w-lg mx-auto pb-56 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-extrabold tracking-tight">마일리지 선물</h1>
        </div>
      </header>

      {/* 잔액 — 컴팩트 카드 */}
      <section className="px-4 pt-4">
        <div className="card p-4 flex items-center gap-3 bg-gradient-to-br from-emerald-50/30 to-transparent dark:from-emerald-950/15">
          <div className="w-11 h-11 rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
            <Coins size={20} className="text-emerald-600" />
          </div>
          <div>
            <p className="text-[12px] text-[var(--muted)] font-bold uppercase tracking-wider">보유 마일리지</p>
            <p className="text-xl font-extrabold text-[var(--foreground)]">
              {balance.toLocaleString()}<span className="text-sm ml-0.5 text-emerald-600">P</span>
            </p>
          </div>
        </div>
      </section>

      {/* 받을 사람 */}
      <section className="px-4 mt-5">
        <h2 className="text-sm font-extrabold mb-2.5 inline-flex items-center gap-1.5">
          <Heart size={14} className="text-emerald-500" /> 받는 사람
        </h2>

        {!selectedUser ? (
          <div className="space-y-2">
            <div className="relative">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-500" />
              <input
                type="text"
                placeholder="닉네임으로 검색"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                className="w-full pl-11 pr-4 py-3 rounded-2xl bg-[var(--card)] border-2 border-[var(--card-border)] text-sm font-medium focus:outline-none focus:border-emerald-500 transition placeholder:text-[var(--muted)]"
              />
            </div>
            {searchResults.length > 0 && (
              <div className="card overflow-hidden divide-y divide-[var(--card-border)]/40">
                {searchResults.map(u => (
                  <button
                    key={u.id}
                    onClick={() => { setSelectedUser(u); setSearchResults([]); setSearchQuery(''); }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left active:scale-[0.99] hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 transition"
                  >
                    <div className="w-9 h-9 rounded-full bg-[var(--card-border)] overflow-hidden flex-shrink-0">
                      {u.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={u.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center"><AppLogo size={20} /></div>
                      )}
                    </div>
                    <span className="text-sm font-semibold">{u.display_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="card p-4 flex items-center gap-3 border-2 border-emerald-200 dark:border-emerald-900/40 bg-gradient-to-br from-emerald-50/30 to-transparent dark:from-emerald-950/15">
            <div className="w-12 h-12 rounded-full bg-[var(--card-border)] overflow-hidden flex-shrink-0">
              {selectedUser.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selectedUser.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center"><AppLogo size={24} /></div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-extrabold truncate">{selectedUser.display_name}</p>
              <p className="text-[12px] text-emerald-600 font-bold uppercase tracking-wider mt-0.5">받는 사람</p>
            </div>
            <button
              onClick={() => setSelectedUser(null)}
              className="w-8 h-8 rounded-full bg-[var(--card-border)]/50 flex items-center justify-center active:scale-90"
              aria-label="변경"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </section>

      {/* 금액 */}
      <section className="px-4 mt-5">
        <h2 className="text-sm font-extrabold mb-2.5 inline-flex items-center gap-1.5">
          <Gift size={14} className="text-emerald-500" /> 선물할 마일리지
        </h2>
        <div className="card p-5 space-y-4 bg-gradient-to-br from-emerald-50/30 to-transparent dark:from-emerald-950/15">
          <div className="relative">
            <input
              type="number" min={1} max={balance}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="w-full pl-4 pr-14 py-4 rounded-2xl bg-[var(--background)] border-2 border-[var(--card-border)] text-3xl font-extrabold text-center focus:outline-none focus:border-emerald-500 transition"
            />
            <span className="absolute right-5 top-1/2 -translate-y-1/2 text-xl font-extrabold text-emerald-600">P</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[100, 500, 1000].map(v => (
              <button
                key={v}
                onClick={() => setAmount(String(v))}
                className="py-2 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-xs font-bold text-[var(--foreground)] active:scale-95 hover:border-emerald-200"
              >
                {v >= 1000 ? `${v/1000}K` : v}P
              </button>
            ))}
            <button
              onClick={() => setAmount(String(balance))}
              className="py-2 rounded-xl bg-emerald-500 text-white text-xs font-extrabold active:scale-95 shadow-sm shadow-emerald-500/25"
            >
              전액
            </button>
          </div>
        </div>
      </section>

      {message && (
        <div className="px-4 mt-4">
          <div className={`card p-3.5 ${
            isError ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/40 text-red-600' :
                     'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-300'
          }`}>
            <p className={`text-center text-sm font-bold ${isError ? '' : ''}`}>{message}</p>
          </div>
        </div>
      )}

      {/* Sticky CTA — build 169 #15 + build 171 #3:
          fixed bottom:0 + z-30 은 layout 의 5탭 nav(z-40, h-14=56px) 에 가려 안 보이는 회귀.
          fix: bottom 을 nav 높이만큼 띄우고 z 를 nav 보다 높게(z-50). */}
      <div
        className="fixed left-1/2 -translate-x-1/2 max-w-lg w-full bg-[var(--background)]/95 backdrop-blur-lg border-t border-[var(--card-border)]/30 z-50"
        style={{ bottom: 'calc(56px + env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="p-3">
          <button
            onClick={handleGift}
            disabled={!selectedUser || !amount || sending}
            className="w-full py-4 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-base active:scale-[0.98] disabled:opacity-50 inline-flex items-center justify-center gap-2 shadow-md shadow-emerald-500/30"
          >
            <Gift size={18} />
            {sending
              ? '전송 중…'
              : !selectedUser
                ? '받는 사람을 선택하세요'
                : !amount
                  ? '선물할 마일리지를 입력하세요'
                  : `${Number(amount || 0).toLocaleString()}P 선물 보내기`}
          </button>
        </div>
      </div>
    </div>
  );
}
