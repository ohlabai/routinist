'use client';

import Link from 'next/link';
import type { Profile } from '@/types';
import FollowButton from './FollowButton';
import AppLogo from '@/components/AppLogo';
import GenderBadge from '@/components/profile/GenderBadge';

interface UserRowProps {
  profile: Profile;
  currentUserId?: string;
  isFollowing?: boolean;
  showFollow?: boolean;
  onFollowToggle?: (userId: string, following: boolean) => void;
}

export default function UserRow({ profile, currentUserId, isFollowing = false, showFollow = true, onFollowToggle }: UserRowProps) {
  const isSelf = currentUserId === profile.id;

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
        </p>
        <p className="text-xs text-[var(--muted)]">{Number(profile.total_distance_km).toFixed(1)}km · {profile.total_runs}회</p>
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
