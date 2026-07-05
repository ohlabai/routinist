'use client';

// build 291 (P2 #23): 차단 사용자 관리 — 내가 차단한 사용자 목록 + 차단 해제.
// user_blocks (blocker_id = 나, RLS select own) → profiles batch (PUBLIC_PROFILE_FIELDS).
// unblockUser 는 message-data 의 blockedIdsCache 도 즉시 갱신하므로 피드/쪽지 필터에 바로 반영됨.

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ShieldOff } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { unblockUser } from '@/lib/message-data';
import { PUBLIC_PROFILE_FIELDS } from '@/lib/profile-fields';
import AppToast from '@/components/AppToast';
import AppLogo from '@/components/AppLogo';
import { useI18n } from '@/lib/i18n';

type BlockedProfile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  region_si: string | null;
  region_gu: string | null;
  total_distance_km: number | null;
  total_runs: number | null;
};

export default function BlockedUsersPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { tt, locale } = useI18n();
  const [list, setList] = useState<BlockedProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 1800);
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
  }, [authLoading, user, router]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const supabase = getSupabase();
      // 캐시 (fetchMyBlockedIds) 대신 직접 조회 — 관리 화면은 최신 목록이 정확해야 함.
      const { data: blocks, error } = await supabase
        .from('user_blocks')
        .select('blocked_id')
        .eq('blocker_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const ids = (blocks ?? []).map((b: { blocked_id: string }) => b.blocked_id);
      if (ids.length === 0) { setList([]); return; }

      const { data: profiles } = await supabase
        .from('profiles')
        .select(PUBLIC_PROFILE_FIELDS)
        .in('id', ids);
      const byId = new Map<string, BlockedProfile>(
        ((profiles ?? []) as unknown as BlockedProfile[]).map(p => [p.id, p]),
      );
      // 차단 순서 유지 + 프로필 삭제된 계정은 placeholder 로 표시 (해제는 가능해야 함)
      setList(ids.map(id => byId.get(id) ?? ({
        id, display_name: null, avatar_url: null, region_si: null, region_gu: null,
        total_distance_km: null, total_runs: null,
      })));
    } catch (e) {
      console.warn('[blocked] load', e);
      showToast(tt('목록을 불러오지 못했어요'), 'warn');
    } finally {
      setLoading(false);
    }
  }, [user, tt]);

  useEffect(() => { load(); }, [load]);

  const handleUnblock = async (id: string) => {
    setUnblockingId(id);
    try {
      await unblockUser(id);
      setList(prev => prev.filter(p => p.id !== id));
      showToast(tt('차단을 해제했어요'));
    } catch (e) {
      showToast(e instanceof Error ? e.message : tt('차단 해제 실패'), 'warn');
    } finally {
      setUnblockingId(null);
    }
  };

  if (!user) return null;

  return (
    <div className="max-w-lg mx-auto pb-24 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/85 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <Link href="/profile" className="w-10 h-10 flex items-center justify-center rounded-full active:bg-[var(--card-border)]/30">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-xl font-extrabold tracking-tight inline-flex items-center gap-1.5">
            <ShieldOff size={18} className="text-emerald-500" /> {tt('차단한 사용자')}
          </h1>
        </div>
      </header>

      <div className="p-4 space-y-3">
        <p className="text-xs text-[var(--muted)] leading-relaxed px-1">
          {tt('차단한 사용자의 사진·댓글·쪽지가 보이지 않아요. 언제든 다시 해제할 수 있어요.')}
        </p>

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="card p-3 animate-pulse flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[var(--card-border)]/40" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-[var(--card-border)]/40 rounded w-1/2" />
                  <div className="h-2.5 bg-[var(--card-border)]/30 rounded w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="card p-8 text-center">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-emerald-100 to-emerald-50 dark:from-emerald-900/40 dark:to-emerald-950/40 flex items-center justify-center text-emerald-600 mb-3">
              <ShieldOff size={26} />
            </div>
            <p className="text-sm font-extrabold">{tt('차단한 사용자가 없어요')}</p>
            <p className="text-xs text-[var(--muted)] mt-1.5 leading-relaxed">
              {tt('모두와 기분 좋게 달리고 있다는 뜻이에요 🏃')}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {list.map(p => {
              const region = [p.region_si, p.region_gu].filter(Boolean).join(' ');
              const sub = region || (p.total_distance_km != null
                ? `${Number(p.total_distance_km).toFixed(1)}km · ${locale === 'en' ? `${p.total_runs ?? 0} runs` : `${p.total_runs ?? 0}회`}`
                : '');
              return (
                <div key={p.id} className="card flex items-center gap-3 p-3">
                  <div className="w-10 h-10 rounded-full bg-[var(--card-border)] overflow-hidden flex-shrink-0">
                    {p.avatar_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={p.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><AppLogo size={24} /></div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate">{p.display_name ?? tt('알 수 없음')}</p>
                    {sub && <p className="text-[11px] text-[var(--muted)] truncate">{sub}</p>}
                  </div>
                  <button
                    onClick={() => handleUnblock(p.id)}
                    disabled={unblockingId === p.id}
                    className="px-3 py-1.5 rounded-full text-xs font-extrabold bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-sm shadow-emerald-500/30 active:scale-95 disabled:opacity-50 flex-shrink-0"
                  >
                    {unblockingId === p.id ? tt('해제 중…') : tt('차단 해제')}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={1800} />}
    </div>
  );
}
