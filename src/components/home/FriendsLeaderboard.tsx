'use client';

// 이번 주 내 친구들 미니 리더보드.
// 친구(=내가 팔로우한 유저) + 나 포함 이번 주 km 합계 비교.
// build 104: 5명 초과 시 인라인 expand → bottom sheet 로 전환. 텍스트 위치도 정리.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import type { Profile } from '@/types';
import { Users, ChevronRight, X } from 'lucide-react';
import { startOfWeekStr } from '@/lib/kst';
import { useI18n, type Locale } from '@/lib/i18n';

interface Row {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  km: number;
  isMe: boolean;
}

function startOfWeek(): string {
  return startOfWeekStr();
}

function FriendRow({ row, rank, maxKm, locale }: { row: Row; rank: number; maxKm: number; locale: Locale }) {
  return (
    <Link
      href={row.isMe ? '/profile' : `/social/user?id=${row.user_id}`}
      className="flex items-center gap-2.5"
    >
      <span className={`w-7 h-7 inline-flex items-center justify-center text-xs font-extrabold rounded-full flex-shrink-0 tabular-nums ${
        rank === 1
          ? 'bg-gradient-to-br from-amber-300 to-yellow-500 text-white shadow-sm'
          : rank === 2
            ? 'bg-gradient-to-br from-slate-300 to-slate-500 text-white shadow-sm'
            : rank === 3
              ? 'bg-gradient-to-br from-orange-300 to-amber-600 text-white shadow-sm'
              : 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
      }`}>
        {rank}
      </span>
      <div className="w-8 h-8 rounded-full bg-[var(--card-border)] overflow-hidden flex-shrink-0">
        {row.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={row.avatar_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[11px] font-bold text-[var(--muted)]">
            {row.display_name.slice(0, 1)}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between">
          <span className={`text-sm truncate ${row.isMe ? 'font-bold text-emerald-700 dark:text-emerald-400' : 'font-semibold text-[var(--foreground)]'}`}>
            {row.display_name}{row.isMe ? (locale === 'en' ? ' (You)' : ' (나)') : ''}
          </span>
          <span className="text-xs text-[var(--muted)] ml-2 font-semibold tabular-nums">{row.km.toFixed(1)}km</span>
        </div>
        <div className="mt-1 h-1.5 bg-[var(--card-border)] rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${row.isMe ? 'bg-gradient-to-r from-emerald-400 to-emerald-600' : 'bg-emerald-400/70'}`}
            style={{ width: `${(row.km / maxKm) * 100}%` }}
          />
        </div>
      </div>
    </Link>
  );
}

export default function FriendsLeaderboard() {
  const { user, profile } = useAuth();
  const { tt, locale } = useI18n();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data: followingRows } = await supabase
          .from('follows')
          .select('following_id, profiles!follows_following_id_fkey(id, display_name, avatar_url)')
          .eq('follower_id', user.id);

        const friends: { id: string; display_name: string; avatar_url: string | null }[] = (followingRows ?? [])
          .map((r: { profiles: unknown }) => r.profiles as Profile | null)
          .filter((p): p is Profile => !!p);

        const userIds = [user.id, ...friends.map(f => f.id)];
        if (userIds.length <= 1) {
          setRows([]);
          return;
        }

        const weekStart = startOfWeek();
        const { data: acts } = await supabase
          .from('activities')
          .select('user_id, distance_km')
          .in('user_id', userIds)
          .gte('activity_date', weekStart);

        const kmByUser = new Map<string, number>();
        (acts ?? []).forEach(a => kmByUser.set(a.user_id, (kmByUser.get(a.user_id) ?? 0) + Number(a.distance_km)));

        const all: Row[] = [
          {
            user_id: user.id,
            display_name: profile?.display_name ?? (locale === 'en' ? 'You' : '나'),
            avatar_url: profile?.avatar_url ?? null,
            km: kmByUser.get(user.id) ?? 0,
            isMe: true,
          },
          ...friends.map(f => ({
            user_id: f.id,
            display_name: f.display_name,
            avatar_url: f.avatar_url,
            km: kmByUser.get(f.id) ?? 0,
            isMe: false,
          })),
        ];
        all.sort((a, b) => b.km - a.km);
        setRows(all);
      } catch (e) {
        console.warn('[FriendsLeaderboard] 조회 실패', e);
        setRows([]);
      }
    })();
  }, [user, profile]);

  // body 스크롤 락 (시트 열렸을 때)
  useEffect(() => {
    if (!sheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [sheetOpen]);

  if (!rows) return null;

  if (rows.length <= 1) {
    // build 138: 카드를 /nearby 진입 Link 로 감싸 친구 추가 흐름 직결 (사용자 피드백 #1B).
    return (
      <Link
        href="/nearby"
        className="mx-4 mt-3 block rounded-2xl border border-dashed border-emerald-300/60 dark:border-emerald-700/40 bg-emerald-50/30 dark:bg-emerald-950/15 p-4 text-center active:scale-[0.99] transition"
      >
        <Users size={22} className="mx-auto text-emerald-600 dark:text-emerald-400 mb-1" />
        <p className="text-sm font-bold text-[var(--foreground)]">{tt('친구와 함께 달려보세요')}</p>
        <p className="text-xs text-[var(--muted)] mt-1">{locale === 'en' ? 'Find runners near you with similar pace' : '동네·페이스 비슷한 러너 찾기'}</p>
        <p className="mt-2 inline-flex items-center gap-0.5 text-[11px] font-extrabold text-emerald-600">
          {locale === 'en' ? 'Find friends' : '친구 찾기'} <ChevronRight size={12} />
        </p>
      </Link>
    );
  }

  const maxKm = Math.max(...rows.map(r => r.km), 1);
  const COLLAPSED_LIMIT = 5;
  const hasMore = rows.length > COLLAPSED_LIMIT;
  const visibleRows = rows.slice(0, COLLAPSED_LIMIT);
  const remainingCount = rows.length - COLLAPSED_LIMIT;

  return (
    <>
      <div className="mx-4 mt-3 rounded-2xl bg-[var(--card)] border border-[var(--card-border)] p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-sm font-bold text-[var(--foreground)]">
            {tt('이번 주 친구 비교')}
            <span className="ml-1.5 text-[11px] font-semibold text-[var(--muted)]">
              · {locale === 'en' ? `${rows.length}` : `${rows.length}명`}
            </span>
          </h3>
          <span className="text-[10px] text-[var(--muted)]">{locale === 'en' ? 'Since Monday' : '월요일 기준'}</span>
        </div>
        <div className="space-y-2.5">
          {visibleRows.map((r, i) => (
            <FriendRow key={r.user_id} row={r} rank={i + 1} maxKm={maxKm} locale={locale} />
          ))}
        </div>

        {hasMore && (
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="mt-3 w-full inline-flex items-center justify-center gap-1 py-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 text-xs font-bold active:scale-95 transition"
          >
            {locale === 'en' ? `Show all friends (+${remainingCount})` : `친구 모두 보기 (+${remainingCount}명)`} <ChevronRight size={12} />
          </button>
        )}
      </div>

      {sheetOpen && (
        <div
          className="fixed inset-0 z-[80] bg-black/50 flex items-end animate-fade-in"
          onClick={() => setSheetOpen(false)}
        >
          <div
            className="w-full bg-[var(--background)] rounded-t-3xl shadow-2xl max-h-[85dvh] flex flex-col animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 핸들 + 헤더 */}
            <div className="flex-shrink-0 pt-2 pb-1">
              <div className="mx-auto w-10 h-1 rounded-full bg-[var(--card-border)]" />
            </div>
            <div className="flex-shrink-0 px-4 py-3 flex items-center justify-between border-b border-[var(--card-border)]/40">
              <div>
                <h2 className="text-base font-extrabold text-[var(--foreground)]">
                  {locale === 'en' ? `Friends · ${rows.length}` : `친구 비교 · ${rows.length}명`}
                </h2>
                <p className="text-[11px] text-[var(--muted)] mt-0.5">{locale === 'en' ? 'Since Monday · sorted by total km' : '월요일 기준 · km 합계 정렬'}</p>
              </div>
              <button
                onClick={() => setSheetOpen(false)}
                aria-label={locale === 'en' ? 'Close' : '닫기'}
                className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--card-border)]/30 active:scale-90 transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* 전체 리스트 */}
            <div
              className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 space-y-2.5"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 60px)' }}
            >
              {rows.map((r, i) => (
                <FriendRow key={r.user_id} row={r} rank={i + 1} maxKm={maxKm} locale={locale} />
              ))}
            </div>

            {/* 하단 친구 관리 CTA */}
            <div
              className="flex-shrink-0 border-t border-[var(--card-border)]/40 px-4 py-3 bg-[var(--background)]"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
            >
              <Link
                href="/social?tab=friends"
                onClick={() => setSheetOpen(false)}
                className="w-full inline-flex items-center justify-center gap-1 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-bold active:scale-95 transition"
              >
                {tt('친구 관리')} <ChevronRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
