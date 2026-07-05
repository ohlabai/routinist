'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { fetchClubs } from '@/lib/social-data';
import { Users, Plus, ArrowLeft } from 'lucide-react';
import type { Club } from '@/types';
import { useI18n } from '@/lib/i18n';

export default function ClubsPage() {
  const { tt, locale } = useI18n();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);

  const [error, setError] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => { setLoading(false); setError(true); }, 10000);
    fetchClubs()
      .then(setClubs)
      .catch((err) => { console.warn('[Clubs] 클럽 목록 로드 실패:', err); setError(true); })
      .finally(() => { clearTimeout(timeout); setLoading(false); });
    return () => clearTimeout(timeout);
  }, []);

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/social" className="text-[var(--muted)]"><ArrowLeft size={24} /></Link>
        <h1 className="text-2xl font-bold text-[var(--foreground)] flex-1">{tt('러닝 클럽')}</h1>
        <Link href="/social/clubs/create" className="flex items-center gap-1 text-sm text-[var(--accent)] font-semibold">
          <Plus size={16} /> {tt('만들기')}
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
        </div>
      ) : error && clubs.length === 0 ? (
        <div className="text-center py-12">
          <Users size={48} className="mx-auto mb-4 text-[var(--muted)]" />
          <p className="text-xs text-[var(--muted)]">{tt('클럽 목록을 불러올 수 없습니다')}</p>
          <button
            onClick={() => { setError(false); setLoading(true); fetchClubs().then(setClubs).catch(() => setError(true)).finally(() => setLoading(false)); }}
            className="text-sm text-[var(--accent)] font-semibold mt-2 inline-block"
          >
            {tt('다시 시도')}
          </button>
        </div>
      ) : clubs.length === 0 ? (
        <div className="text-center py-12">
          <Users size={48} className="mx-auto mb-4 text-[var(--muted)]" />
          <p className="text-xs text-[var(--muted)]">{tt('아직 클럽이 없습니다')}</p>
          <Link href="/social/clubs/create" className="text-sm text-[var(--accent)] font-semibold mt-2 inline-block">
            {tt('첫 번째 클럽을 만들어보세요!')}
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {clubs.map((club) => (
            <Link key={club.id} href={`/social/clubs/detail?id=${club.id}`} className="card p-4 flex items-center gap-4 block">
              <div className="w-12 h-12 rounded-xl bg-[var(--accent)]/10 flex items-center justify-center flex-shrink-0">
                {club.logo_url ? (
                  <img src={club.logo_url} alt="" className="w-full h-full rounded-xl object-cover" />
                ) : (
                  <Users size={24} className="text-[var(--accent)]" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-base font-bold text-[var(--foreground)] truncate">{club.name}</p>
                {club.description && (
                  <p className="text-xs text-[var(--muted)] truncate mt-0.5">{club.description}</p>
                )}
                <p className="text-xs text-[var(--muted)] mt-1">{locale === 'en' ? `${club.member_count} members` : `멤버 ${club.member_count}명`}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
