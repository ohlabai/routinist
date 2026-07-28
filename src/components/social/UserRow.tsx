'use client';

import Link from 'next/link';
import type { Profile } from '@/types';
import FollowButton from './FollowButton';
import AppLogo from '@/components/AppLogo';
import GenderBadge from '@/components/profile/GenderBadge';
import { useI18n } from '@/lib/i18n';

interface UserRowProps {
  profile: Profile;
  currentUserId?: string;
  isFollowing?: boolean;
  showFollow?: boolean;
  onFollowToggle?: (userId: string, following: boolean) => void;
  /** build 327: 추천 이유 칩 (예: "우리 동네") — 있으면 이름 옆에 표시 */
  badge?: string;
}

export default function UserRow({ profile, currentUserId, isFollowing = false, showFollow = true, onFollowToggle, badge }: UserRowProps) {
  const isSelf = currentUserId === profile.id;
  const { t } = useI18n();

  return (
    <div className="flex items-center gap-3 py-3">
      <Link href={`/profile/view?id=${profile.id}`} className="flex-shrink-0">
        <div className="w-10 h-10 rounded-full bg-[var(--card-border)] overflow-hidden">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center"><AppLogo size={24} /></div>
          )}
        </div>
      </Link>
      <Link href={`/profile/view?id=${profile.id}`} className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[var(--foreground)] truncate inline-flex items-center gap-1">
          {profile.display_name}
          <GenderBadge
            gender={profile.gender as 'male' | 'female' | null | undefined}
            show={(profile as { show_gender?: boolean }).show_gender ?? true}
            size={11}
          />
          {badge && (
            <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full bg-emerald-100/80 dark:bg-emerald-900/30 text-[9px] font-extrabold text-emerald-700 dark:text-emerald-300">
              {badge}
            </span>
          )}
        </p>
        <p className="text-xs text-[var(--muted)]">{Number(profile.total_distance_km).toFixed(1)}km · {t('home.summaryRuns').replace('{n}', String(profile.total_runs))}</p>
      </Link>
      {showFollow && !isSelf && (
        <FollowButton
          userId={profile.id}
          initialFollowing={isFollowing}
          onToggle={(f) => onFollowToggle?.(profile.id, f)}
        />
      )}
    </div>
  );
}
