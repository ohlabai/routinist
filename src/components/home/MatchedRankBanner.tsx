'use client';

// 메인 상단 한 줄 랭킹 배너.
// "***님은 강남구 50대 남성 중 13위입니다" 형태로 노출.
// 클릭 시 해당 스코프의 랭킹 리스트로 이동 (나보다 위 러너만 보여주는 뷰).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Trophy, UserPlus } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';

interface MatchedRank {
  scope_label: string;
  scope_type: string;
  rank_position: number;
  total_in_scope: number;
  monthly_km: number;
}

export default function MatchedRankBanner() {
  const { user, profile } = useAuth();
  const { tt, locale } = useI18n();
  const [rank, setRank] = useState<MatchedRank | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase.rpc('find_best_matched_rank', {
          target_user_id: user.id,
        });
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        if (row) setRank(row as MatchedRank);
      } catch (e) {
        console.warn('[MatchedRank] 조회 실패', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  if (loading) {
    return (
      <div className="mx-4 mt-3 rounded-2xl bg-gradient-to-br from-[var(--accent)]/10 to-emerald-500/10 border border-[var(--card-border)] p-4 h-[78px] animate-pulse" />
    );
  }

  // 인구통계 부족 (구/성별/생년 모두 없음) → 프로필 유도 CTA
  const hasDemographics = !!(profile?.region_gu || profile?.birth_year || profile?.gender);
  if (!rank || !hasDemographics) {
    return (
      <Link
        href="/profile/edit"
        className="mx-4 mt-3 block rounded-2xl bg-gradient-to-br from-[var(--accent)]/10 to-emerald-500/10 border border-[var(--card-border)] p-4 active:scale-[0.99] transition"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[var(--accent)]/15 flex items-center justify-center">
            <UserPlus size={18} className="text-[var(--accent)]" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-[var(--foreground)]">
              {tt('내 랭킹 보기')}
            </p>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              {tt('지역·나이·성별을 입력하면 비슷한 러너들 사이 내 순위를 보여드려요')}
            </p>
          </div>
          <ChevronRight size={18} className="text-[var(--muted)]" />
        </div>
      </Link>
    );
  }

  // Top 10 = 메달, 50 이내 = 축하, 그 이상 = 담백
  const isTop10 = rank.rank_position <= 10;
  const isTop3 = rank.rank_position <= 3;
  const name = profile?.display_name ?? (locale === 'en' ? 'You' : '나');

  return (
    <Link
      href={`/social/rankings?scope=${rank.scope_type}`}
      className="mx-4 mt-3 block rounded-2xl bg-gradient-to-br from-[var(--accent)]/15 to-emerald-500/10 border border-[var(--card-border)] p-4 active:scale-[0.99] transition shadow-sm"
    >
      <div className="flex items-center gap-3">
        <div
          className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${
            isTop3 ? 'bg-amber-100 dark:bg-amber-900/30' : isTop10 ? 'bg-[var(--accent)]/20' : 'bg-[var(--card)]'
          }`}
        >
          <Trophy
            size={20}
            className={isTop3 ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--accent)]'}
          />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] text-[var(--muted)]">
            {rank.scope_label}
          </p>
          <p className="text-base font-bold text-[var(--foreground)] leading-tight mt-0.5">
            {locale === 'en' ? (
              <>
                <span className="text-[var(--accent)]">{name}</span> is currently{' '}
                <span className={isTop10 ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--foreground)]'}>
                  #{rank.rank_position}
                </span>
                {' '}/ {rank.total_in_scope}
              </>
            ) : (
              <>
                <span className="text-[var(--accent)]">{name}</span>님은 현재{' '}
                <span className={isTop10 ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--foreground)]'}>
                  {rank.rank_position}위
                </span>
                {' '}/ {rank.total_in_scope}명
              </>
            )}
          </p>
        </div>
        <ChevronRight size={18} className="text-[var(--muted)] flex-shrink-0" />
      </div>
    </Link>
  );
}
