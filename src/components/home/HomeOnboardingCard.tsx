'use client';

// 신규 가입자 시작 가이드 (build 100). 가입 7일 이내 + 활동 5회 미만 사용자에게만.
// 4개 체크리스트: 프로필 / 첫 러닝 / 사진 / 친구. 모두 완료되면 카드 숨김.

import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/components/UserDataProvider';
import { Sparkles, Check, ChevronRight } from 'lucide-react';

export default function HomeOnboardingCard() {
  const { profile, user } = useAuth();
  const { activities } = useUserData();

  if (!profile || !user) return null;

  const createdAt = (profile as { created_at?: string }).created_at;
  if (!createdAt) return null;

  const signupDays = Math.floor((Date.now() - new Date(createdAt).getTime()) / (24 * 60 * 60 * 1000));
  const runCount = activities.length;

  // 가입 7일 초과 OR 5회 이상 러닝하면 노출 X
  if (signupDays > 7 || runCount >= 5) return null;

  const items = [
    {
      id: 'profile',
      label: '지역·생년·성별 입력',
      done: !!(profile.region_gu && profile.birth_year && profile.gender),
      href: '/profile/edit',
    },
    {
      id: 'first_run',
      label: '첫 러닝 기록',
      done: runCount >= 1,
      href: '/connect',
    },
    {
      id: 'photo',
      label: '루틴 사진 한 장',
      done: runCount >= 2, // approximation — 정확한 photo 카운트는 별도 query 필요
      href: '/log',
    },
    {
      id: 'friend',
      label: '친구 1명 추가',
      done: false,
      href: '/social',
    },
  ];

  const doneCount = items.filter(i => i.done).length;
  if (doneCount === items.length) return null;

  return (
    <div className="mx-4 mt-3 rounded-3xl bg-gradient-to-br from-amber-50 via-orange-50/40 to-emerald-50 dark:from-amber-950/30 dark:via-orange-950/20 dark:to-emerald-950/20 border border-amber-200/60 dark:border-amber-900/30 p-5 shadow-sm">
      <div className="mb-3">
        <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide inline-flex items-center gap-1">
          <Sparkles size={11} /> 가입 {signupDays + 1}일째
        </p>
        <h3 className="text-lg font-extrabold text-[var(--foreground)] mt-0.5">시작 가이드</h3>
        <p className="text-xs text-[var(--muted)] mt-0.5">
          {doneCount}/{items.length} 완료 · 모두 채우면 마일리지 보너스!
        </p>
      </div>
      <ul className="space-y-2">
        {items.map((it, idx) => (
          <li key={it.id}>
            <Link
              href={it.href}
              className={`flex items-center gap-2.5 p-2.5 rounded-xl transition active:scale-[0.98] ${
                it.done
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-900/40'
                  : 'bg-white dark:bg-zinc-900 border border-[var(--card-border)]'
              }`}
            >
              <span className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                it.done ? 'bg-emerald-500 text-white shadow-sm' : 'bg-[var(--card-border)]/40 text-[var(--muted)]'
              }`}>
                {it.done ? <Check size={14} strokeWidth={3} /> : <span className="text-[10px] font-extrabold">{idx + 1}</span>}
              </span>
              <span className={`flex-1 text-sm font-bold ${
                it.done ? 'text-emerald-700 dark:text-emerald-400 line-through' : 'text-[var(--foreground)]'
              }`}>
                {it.label}
              </span>
              {!it.done && <ChevronRight size={14} className="text-[var(--muted)]" />}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
