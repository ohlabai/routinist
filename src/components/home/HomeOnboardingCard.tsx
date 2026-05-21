'use client';

// 신규 가입자 시작 가이드 (build 100 → 162). 가입 7일 이내 + 활동 5회 미만 사용자에게만.
// build 162 #6: 3 체크리스트 (프로필 / Apple Health / 친구). 루틴 사진은 제거.
//   - 프로필: 국가/시/구 3개 input + 출생연도/성별. GPS 가져오기 → 3개 input 에 즉시 반영.
//   - Apple Health: iOS 네이티브에서만 노출. 클릭 → 인라인 syncHealthData.
//   - 친구: /social 이동.
// build 162 #6b bug fix: gender check constraint 는 'male'/'female'/'other' 만 허용 — 폼에서 M/F/O 보냈었음.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/components/UserDataProvider';
import { Sparkles, Check, ChevronRight, ChevronDown, MapPin, Heart } from 'lucide-react';
import { detectRegion } from '@/lib/geo';
import { getSupabase } from '@/lib/supabase';
import { syncHealthData, isNativeApp, getPlatform } from '@/lib/health-sync';

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
  const [msgKind, setMsgKind] = useState<'info' | 'error'>('info');

  const handleDetect = async () => {
    setDetecting(true);
    setMsg('');
    try {
      const r = await detectRegion();
      setCountry(r.country_code);
      setSido(r.si ?? '');
      setGu(r.gu ?? '');
      setMsg(`감지: ${r.display}`);
      setMsgKind('info');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '위치 감지 실패');
      setMsgKind('error');
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
      setMsgKind('info');
      setTimeout(() => onSaved(), 600);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '저장 실패');
      setMsgKind('error');
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
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] text-[var(--muted)] block mb-1 px-0.5">국가</label>
          <input
            type="text"
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))}
            placeholder="KR"
            maxLength={2}
            className="w-full px-2.5 py-2.5 rounded-xl border border-[var(--card-border)] bg-[var(--background)] text-sm uppercase"
          />
        </div>
        <div>
          <label className="text-[10px] text-[var(--muted)] block mb-1 px-0.5">도시·시도</label>
          <input
            type="text"
            value={sido}
            onChange={(e) => setSido(e.target.value)}
            placeholder="서울"
            className="w-full px-2.5 py-2.5 rounded-xl border border-[var(--card-border)] bg-[var(--background)] text-sm"
          />
        </div>
        <div>
          <label className="text-[10px] text-[var(--muted)] block mb-1 px-0.5">구·군</label>
          <input
            type="text"
            value={gu}
            onChange={(e) => setGu(e.target.value)}
            placeholder="강남"
            className="w-full px-2.5 py-2.5 rounded-xl border border-[var(--card-border)] bg-[var(--background)] text-sm"
          />
        </div>
      </div>
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
          <option value="male">남성</option>
          <option value="female">여성</option>
          <option value="other">선택안함</option>
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
      {msg && (
        <p className={`text-[11px] text-center ${msgKind === 'error' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
          {msg}
        </p>
      )}
    </div>
  );
}

function InlineHealthConnect({ onSynced }: { onSynced: () => void }) {
  const { user } = useAuth();
  const { refresh } = useUserData();
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgKind, setMsgKind] = useState<'info' | 'error'>('info');

  const handleSync = async () => {
    if (!user || syncing) return;
    setSyncing(true);
    setMsg('');
    try {
      const ts = Date.now();
      window.localStorage.setItem('last_health_sync', new Date(ts).toISOString());
      window.localStorage.setItem(`first_sync_done:${user.id}`, String(ts));
      const r = await Promise.race([
        syncHealthData(user.id, { onProgress: (p) => setMsg(`${p.label} · ${p.percent}%`) }),
        new Promise<{ success: false; synced: 0; message: string }>((resolve) =>
          setTimeout(() => resolve({ success: false, synced: 0, message: '30초 초과' }), 30000)
        ),
      ]);
      if (r.success) {
        setMsg(r.synced > 0 ? `${r.synced}건 가져왔어요` : '동기화 완료');
        setMsgKind('info');
        if (r.synced > 0) refresh();
        setTimeout(() => onSynced(), 800);
      } else {
        setMsg(r.message || '연동 실패');
        setMsgKind('error');
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '연동 실패');
      setMsgKind('error');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="mt-2 p-3.5 rounded-2xl bg-white dark:bg-zinc-900 border border-emerald-200/60 dark:border-emerald-900/40 space-y-2.5">
      <p className="text-xs text-[var(--muted)] leading-relaxed">
        Apple 건강 앱과 연결해서 러닝·걷기·심박·GPS 를 자동으로 가져옵니다. 권한 팝업이 뜨면 허용해주세요.
      </p>
      <button
        type="button"
        onClick={handleSync}
        disabled={syncing}
        className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-sm font-extrabold disabled:opacity-50"
      >
        <Heart size={14} /> {syncing ? '동기화 중…' : 'Apple Health 연동하고 가져오기'}
      </button>
      {msg && (
        <p className={`text-[11px] text-center ${msgKind === 'error' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
          {msg}
        </p>
      )}
    </div>
  );
}

export default function HomeOnboardingCard() {
  const { profile, user } = useAuth();
  const { activities } = useUserData();
  const [profileExpanded, setProfileExpanded] = useState(false);
  const [healthExpanded, setHealthExpanded] = useState(false);
  const [iosNative, setIosNative] = useState(false);

  useEffect(() => {
    setIosNative(isNativeApp() && getPlatform() === 'ios');
  }, []);

  if (!profile || !user) return null;

  const createdAt = (profile as { created_at?: string }).created_at;
  if (!createdAt) return null;

  // eslint-disable-next-line react-hooks/purity
  const signupDays = Math.floor((Date.now() - new Date(createdAt).getTime()) / (24 * 60 * 60 * 1000));

  const runCount = activities.length;

  if (signupDays > 7 || runCount >= 5) return null;

  const profileDone = !!(profile.region_gu && profile.birth_year && profile.gender);

  const healthFlag = typeof window !== 'undefined'
    ? !!window.localStorage.getItem(`first_sync_done:${user.id}`)
    : false;
  const hasHealthActivity = activities.some(a => a.source === 'health_kit' || a.source === 'health_connect');
  const healthDone = !iosNative || healthFlag || hasHealthActivity || runCount >= 1;

  type Item =
    | { id: string; label: string; done: boolean; inline: 'profile' | 'health' }
    | { id: string; label: string; done: boolean; href: string };

  const items: Item[] = [
    { id: 'profile', label: '지역·생년·성별 입력', done: profileDone, inline: 'profile' },
  ];
  if (iosNative) {
    items.push({ id: 'health', label: 'Apple Health 와 연동해서 러닝 가져오기', done: healthDone, inline: 'health' });
  } else {
    items.push({ id: 'first_run', label: '첫 러닝 기록', done: runCount >= 1, href: '/connect' });
  }
  items.push({ id: 'friend', label: '친구 1명 추가', done: false, href: '/social' });

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
          const isInline = 'inline' in it;
          const expanded = isInline && it.inline === 'profile' ? profileExpanded : isInline && it.inline === 'health' ? healthExpanded : false;
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
                isInline
                  ? <ChevronDown size={14} className={`text-[var(--muted)] transition-transform ${expanded ? 'rotate-180' : ''}`} />
                  : <ChevronRight size={14} className="text-[var(--muted)]" />
              )}
            </>
          );
          const rowClass = `flex items-center gap-2.5 p-2.5 rounded-xl transition active:scale-[0.98] ${
            it.done
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-900/40'
              : 'bg-white dark:bg-zinc-900 border border-[var(--card-border)]'
          }`;

          if (isInline) {
            const toggle = () => {
              if (it.done) return;
              if (it.inline === 'profile') setProfileExpanded(v => !v);
              else setHealthExpanded(v => !v);
            };
            return (
              <li key={it.id}>
                <button type="button" onClick={toggle} className={`w-full ${rowClass}`} disabled={it.done}>
                  {inner}
                </button>
                {!it.done && expanded && it.inline === 'profile' && (
                  <InlineProfileForm onSaved={() => setProfileExpanded(false)} />
                )}
                {!it.done && expanded && it.inline === 'health' && (
                  <InlineHealthConnect onSynced={() => setHealthExpanded(false)} />
                )}
              </li>
            );
          }
          return (
            <li key={it.id}>
              <Link href={it.href} className={rowClass}>{inner}</Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
