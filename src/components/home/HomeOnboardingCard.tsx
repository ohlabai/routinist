'use client';

// 신규 가입자 시작 가이드 (build 100 → 161). 가입 7일 이내 + 활동 5회 미만 사용자에게만.
// 4개 체크리스트: 프로필 / 첫 러닝 / 사진 / 친구. 모두 완료되면 카드 숨김.
// build 161: 1번 "지역·생년·성별" 은 별도 페이지로 이동하지 않고 카드 안에서 인라인 저장.

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/components/UserDataProvider';
import { Sparkles, Check, ChevronRight, ChevronDown, MapPin } from 'lucide-react';
import { detectRegion } from '@/lib/geo';
import { getSupabase } from '@/lib/supabase';

const CURRENT_YEAR = new Date().getFullYear();
const BIRTH_YEARS = Array.from({ length: 80 }, (_, i) => CURRENT_YEAR - 14 - i);

function InlineProfileForm({ onSaved }: { onSaved: () => void }) {
  const { user, profile, refreshProfile } = useAuth();
  const [country, setCountry] = useState(profile?.country_code || 'KR');
  const [sido, setSido] = useState(profile?.region_si ?? '');
  const [gu, setGu] = useState(profile?.region_gu ?? '');
  const [birthYear, setBirthYear] = useState(profile?.birth_year?.toString() ?? '');
  const [gender, setGender] = useState(profile?.gender ?? '');
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const handleDetect = async () => {
    setDetecting(true);
    setMsg('');
    try {
      const r = await detectRegion();
      setCountry(r.country_code);
      if (r.country_code === 'KR') {
        if (r.si) setSido(r.si);
        if (r.gu) setGu(r.gu);
      }
      setMsg(`현재 위치: ${r.display}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '위치 감지 실패');
    } finally {
      setDetecting(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    setMsg('');
    try {
      const { error } = await getSupabase()
        .from('profiles')
        .update({
          country_code: country || null,
          region_si: sido || null,
          region_gu: gu || null,
          birth_year: birthYear ? parseInt(birthYear, 10) : null,
          gender: gender || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);
      if (error) throw error;
      await refreshProfile();
      setMsg('저장됐어요');
      setTimeout(() => onSaved(), 600);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 p-3.5 rounded-2xl bg-white dark:bg-zinc-900 border border-emerald-200/60 dark:border-emerald-900/40 space-y-3">
      <button
        type="button"
        onClick={handleDetect}
        disabled={detecting}
        className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-sm font-bold disabled:opacity-50"
      >
        <MapPin size={14} /> {detecting ? '감지 중…' : 'GPS 로 현재 지역 가져오기'}
      </button>
      {sido && (
        <p className="text-xs text-[var(--muted)] text-center">
          {country === 'KR' ? `${sido} ${gu || ''}` : sido}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <select
          value={birthYear}
          onChange={(e) => setBirthYear(e.target.value)}
          className="px-2.5 py-2.5 rounded-xl border border-[var(--card-border)] bg-[var(--background)] text-sm"
        >
          <option value="">출생연도</option>
          {BIRTH_YEARS.map(y => <option key={y} value={y}>{y}년</option>)}
        </select>
        <select
          value={gender}
          onChange={(e) => setGender(e.target.value)}
          className="px-2.5 py-2.5 rounded-xl border border-[var(--card-border)] bg-[var(--background)] text-sm"
        >
          <option value="">성별</option>
          <option value="M">남성</option>
          <option value="F">여성</option>
          <option value="O">선택안함</option>
        </select>
      </div>
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || (!sido && !birthYear && !gender)}
        className="w-full py-2.5 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-sm font-extrabold disabled:opacity-50"
      >
        {saving ? '저장 중…' : '저장하기'}
      </button>
      {msg && <p className="text-[11px] text-center text-emerald-600 dark:text-emerald-400">{msg}</p>}
    </div>
  );
}

export default function HomeOnboardingCard() {
  const { profile, user } = useAuth();
  const { activities } = useUserData();
  const [profileExpanded, setProfileExpanded] = useState(false);

  if (!profile || !user) return null;

  const createdAt = (profile as { created_at?: string }).created_at;
  if (!createdAt) return null;

  const signupDays = Math.floor((Date.now() - new Date(createdAt).getTime()) / (24 * 60 * 60 * 1000));
  const runCount = activities.length;

  if (signupDays > 7 || runCount >= 5) return null;

  const profileDone = !!(profile.region_gu && profile.birth_year && profile.gender);

  const items = [
    {
      id: 'profile',
      label: '지역·생년·성별 입력',
      done: profileDone,
      inline: true as const,
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
      done: runCount >= 2,
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
        {items.map((it, idx) => {
          const inner = (
            <>
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
              {!it.done && (
                'inline' in it && it.inline
                  ? <ChevronDown size={14} className={`text-[var(--muted)] transition-transform ${profileExpanded ? 'rotate-180' : ''}`} />
                  : <ChevronRight size={14} className="text-[var(--muted)]" />
              )}
            </>
          );
          const rowClass = `flex items-center gap-2.5 p-2.5 rounded-xl transition active:scale-[0.98] ${
            it.done
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-900/40'
              : 'bg-white dark:bg-zinc-900 border border-[var(--card-border)]'
          }`;

          if ('inline' in it && it.inline) {
            return (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => !it.done && setProfileExpanded(v => !v)}
                  className={`w-full ${rowClass}`}
                  disabled={it.done}
                >
                  {inner}
                </button>
                {!it.done && profileExpanded && (
                  <InlineProfileForm onSaved={() => setProfileExpanded(false)} />
                )}
              </li>
            );
          }
          return (
            <li key={it.id}>
              <Link href={it.href!} className={rowClass}>{inner}</Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
