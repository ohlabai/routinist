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
import { Sparkles, Check, ChevronRight, ChevronDown, MapPin, Heart, UserPlus } from 'lucide-react';
import { claimReferralCode, claimReasonMessage } from '@/lib/referral-data';
import { fetchNearbyRunners, type NearbyRunner } from '@/lib/nearby-data';
import { followUser, fetchFollowing } from '@/lib/social-data';
import { detectRegion } from '@/lib/geo';
import { getSupabase } from '@/lib/supabase';
import { syncHealthData, isNativeApp, getPlatform } from '@/lib/health-sync';
import { setMonthlyGoal } from '@/lib/routinist-data';
import { useI18n } from '@/lib/i18n';

const CURRENT_YEAR = new Date().getFullYear();
const BIRTH_YEARS = Array.from({ length: 80 }, (_, i) => CURRENT_YEAR - 14 - i);

function InlineProfileForm({ onSaved }: { onSaved: () => void }) {
  const { user, profile, refreshProfile } = useAuth();
  const { tt, locale } = useI18n();
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
      // build 164 #1: 사용자에게 더 큰 확인 — 어떤 값이 입력칸에 들어갔는지 명시.
      const detected = r.country_code === 'KR'
        ? `${r.si ?? ''} ${r.gu ?? ''}`.trim() || (locale === 'en' ? 'Korea' : '한국')
        : r.display;
      setMsg(locale === 'en'
        ? `✓ Filled with "${detected}". Tap Save if it's correct`
        : `✓ ${detected} (으)로 입력했어요. 맞으면 저장하기 눌러주세요`);
      setMsgKind('info');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : tt('위치 감지 실패'));
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
      setMsg(tt('저장됐어요'));
      setMsgKind('info');
      setTimeout(() => onSaved(), 600);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : tt('저장 실패'));
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
        <MapPin size={14} /> {detecting ? tt('감지 중...') : tt('GPS 로 현재 지역 가져오기')}
      </button>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-[12px] text-[var(--muted)] block mb-1 px-0.5">{locale === 'en' ? 'Country' : '국가'}</label>
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
          <label className="text-[12px] text-[var(--muted)] block mb-1 px-0.5">{locale === 'en' ? 'City' : '도시·시도'}</label>
          <input
            type="text"
            value={sido}
            onChange={(e) => setSido(e.target.value)}
            placeholder={locale === 'en' ? 'Seoul' : '서울'}
            className="w-full px-2.5 py-2.5 rounded-xl border border-[var(--card-border)] bg-[var(--background)] text-sm"
          />
        </div>
        <div>
          <label className="text-[12px] text-[var(--muted)] block mb-1 px-0.5">{locale === 'en' ? 'District' : '구·군'}</label>
          <input
            type="text"
            value={gu}
            onChange={(e) => setGu(e.target.value)}
            placeholder={locale === 'en' ? 'Gangnam' : '강남'}
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
          <option value="">{locale === 'en' ? 'Birth year' : '출생연도'}</option>
          {BIRTH_YEARS.map(y => <option key={y} value={y}>{locale === 'en' ? y : `${y}년`}</option>)}
        </select>
        <select
          value={gender}
          onChange={(e) => setGender(e.target.value)}
          className="px-2.5 py-2.5 rounded-xl border border-[var(--card-border)] bg-[var(--background)] text-sm"
        >
          <option value="">{locale === 'en' ? 'Gender' : '성별'}</option>
          <option value="male">{locale === 'en' ? 'Male' : '남성'}</option>
          <option value="female">{locale === 'en' ? 'Female' : '여성'}</option>
          <option value="other">{locale === 'en' ? 'Prefer not to say' : '선택안함'}</option>
        </select>
      </div>
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || (!sido && !birthYear && !gender)}
        className="w-full py-2.5 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-sm font-extrabold disabled:opacity-50"
      >
        {saving ? tt('저장 중…') : tt('저장하기')}
      </button>
      {msg && (
        <p className={`text-[13px] text-center ${msgKind === 'error' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
          {msg}
        </p>
      )}
    </div>
  );
}

// build 165 #1: 이달 목표 인라인 — /goals 페이지로 보내지 않고 시작 가이드에서 바로 저장.
const GOAL_PRESETS_KM = [30, 50, 100, 150, 200];
function InlineMonthlyGoalForm({ onSaved }: { onSaved: () => void }) {
  const { user } = useAuth();
  const { refresh } = useUserData();
  const { tt, locale } = useI18n();
  const [goalKm, setGoalKm] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgKind, setMsgKind] = useState<'info' | 'error'>('info');

  const handleSave = async () => {
    if (!user) return;
    const km = parseFloat(goalKm);
    if (isNaN(km) || km <= 0) {
      setMsg(tt('목표 거리를 입력해주세요'));
      setMsgKind('error');
      return;
    }
    setSaving(true);
    setMsg('');
    try {
      const now = new Date();
      await setMonthlyGoal(user.id, now.getFullYear(), now.getMonth() + 1, km);
      await refresh();
      setMsg(tt('🎯 이달 목표를 설정했어요!'));
      setMsgKind('info');
      setTimeout(() => onSaved(), 700);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : tt('저장 실패'));
      setMsgKind('error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 p-3.5 rounded-2xl bg-white dark:bg-zinc-900 border border-emerald-200/60 dark:border-emerald-900/40 space-y-2.5">
      <p className="text-[13px] text-[var(--muted)] leading-relaxed">
        {locale === 'en'
          ? 'Set your distance goal for this month. Filling it up day by day is the fun part.'
          : '이번 달에 달릴 거리를 정해봐요. 매일 조금씩 채워가는 재미가 쏠쏠해요.'}
      </p>
      <div className="flex gap-1.5 flex-wrap">
        {GOAL_PRESETS_KM.map(km => (
          <button
            key={km}
            type="button"
            onClick={() => setGoalKm(String(km))}
            className={`px-3 py-1.5 rounded-full text-xs font-extrabold transition active:scale-95 ${
              goalKm === String(km)
                ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-500/30'
                : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
            }`}
          >
            {km}km
          </button>
        ))}
      </div>
      <input
        type="number"
        step="1"
        min="1"
        value={goalKm}
        onChange={(e) => setGoalKm(e.target.value)}
        placeholder={locale === 'en' ? 'Custom (km)' : '직접 입력 (km)'}
        className="w-full px-3 py-2.5 rounded-xl border border-[var(--card-border)] bg-[var(--background)] text-sm"
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !goalKm}
        className="w-full py-2.5 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-sm font-extrabold disabled:opacity-50"
      >
        {saving ? tt('저장 중…') : (locale === 'en' ? 'Save goal' : '목표 저장하기')}
      </button>
      {msg && (
        <p className={`text-[13px] text-center ${msgKind === 'error' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
          {msg}
        </p>
      )}
    </div>
  );
}

function InlineHealthConnect({ onSynced }: { onSynced: () => void }) {
  const { user } = useAuth();
  const { refresh } = useUserData();
  const { tt, locale } = useI18n();
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
          setTimeout(() => resolve({ success: false, synced: 0, message: tt('30초 초과') }), 30000)
        ),
      ]);
      if (r.success) {
        setMsg(r.synced > 0
          ? (locale === 'en' ? `Imported ${r.synced} records` : `${r.synced}건 가져왔어요`)
          : (locale === 'en' ? 'Sync complete' : '동기화 완료'));
        setMsgKind('info');
        if (r.synced > 0) refresh();
        setTimeout(() => onSynced(), 800);
      } else {
        setMsg(r.message || (locale === 'en' ? 'Connection failed' : '연동 실패'));
        setMsgKind('error');
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : (locale === 'en' ? 'Connection failed' : '연동 실패'));
      setMsgKind('error');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="mt-2 p-3.5 rounded-2xl bg-white dark:bg-zinc-900 border border-emerald-200/60 dark:border-emerald-900/40 space-y-2.5">
      <p className="text-xs text-[var(--muted)] leading-relaxed">
        {locale === 'en'
          ? 'Connect with Apple Health to auto-import runs, walks, heart rate, and GPS. Please allow when the permission prompt appears.'
          : 'Apple 건강 앱과 연결해서 러닝·걷기·심박·GPS 를 자동으로 가져옵니다. 권한 팝업이 뜨면 허용해주세요.'}
      </p>
      <button
        type="button"
        onClick={handleSync}
        disabled={syncing}
        className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-sm font-extrabold disabled:opacity-50"
      >
        <Heart size={14} /> {syncing ? (locale === 'en' ? 'Syncing…' : '동기화 중…') : (locale === 'en' ? 'Connect Apple Health and import' : 'Apple Health 연동하고 가져오기')}
      </button>
      {msg && (
        <p className={`text-[13px] text-center ${msgKind === 'error' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
          {msg}
        </p>
      )}
    </div>
  );
}

// build 292: 초대 코드 입력 인라인 폼 — claim_referral_code RPC.
// 명시적 액션이므로 실패 사유는 친근한 문구로 노출 (자동 claim 과 달리 조용히 넘기지 않음).
function InlineInviteCodeForm({ onClaimed }: { onClaimed: () => void }) {
  const { user } = useAuth();
  const { tt, locale } = useI18n();
  const [code, setCode] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgKind, setMsgKind] = useState<'info' | 'error'>('info');

  const handleClaim = async () => {
    if (!user || claiming || !code.trim()) return;
    setClaiming(true);
    setMsg('');
    try {
      const r = await claimReferralCode(code);
      if (r.ok) {
        try { window.localStorage.setItem(`referral_claimed:${user.id}`, String(Date.now())); } catch {}
        setMsg(tt('100P 적립! 🎉 친구와 함께 달려봐요'));
        setMsgKind('info');
        setTimeout(() => onClaimed(), 900);
      } else {
        setMsg(claimReasonMessage(r.reason));
        setMsgKind('error');
      }
    } catch {
      setMsg(locale === 'en'
        ? "Couldn't register the code right now. Please try again later"
        : '지금은 등록할 수 없어요. 잠시 후 다시 시도해주세요');
      setMsgKind('error');
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="mt-2 p-3.5 rounded-2xl bg-white dark:bg-zinc-900 border border-emerald-200/60 dark:border-emerald-900/40 space-y-2.5">
      <p className="text-[13px] text-[var(--muted)] leading-relaxed">
        {locale === 'en'
          ? 'Got a 6-letter code from a friend? Enter it and you both get 100P 🎁'
          : '친구에게 받은 6자리 초대 코드를 입력하면 서로 100P 를 받아요 🎁'}
      </p>
      <input
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, '').slice(0, 6))}
        placeholder="ABC123"
        maxLength={6}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        className="w-full px-3 py-2.5 rounded-xl border border-[var(--card-border)] bg-[var(--background)] text-base font-extrabold text-center tracking-[0.25em] uppercase"
      />
      <button
        type="button"
        onClick={handleClaim}
        disabled={claiming || code.trim().length === 0}
        className="w-full py-2.5 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-sm font-extrabold disabled:opacity-50"
      >
        {claiming ? tt('등록 중…') : tt('코드 등록하기')}
      </button>
      {msg && (
        <p className={`text-[13px] text-center ${msgKind === 'error' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
          {msg}
        </p>
      )}
    </div>
  );
}

// build 293: 추천 팔로우 — 최근 7일 활동한 공개 러너 미니 카드 줄 (같은 나라 우선, 없으면 글로벌).
// 체크리스트 '친구' 항목 바로 아래. 이미 팔로잉 3명 이상이면 숨김.
// country 스코프 RPC 미배포 환경에선 빈 결과 → national fallback 이 자연 대응 (에러 없음).
function RecommendedRunnersRow({ onFollowed }: { onFollowed: () => void }) {
  const { user } = useAuth();
  const { tt, locale } = useI18n();
  const [runners, setRunners] = useState<NearbyRunner[]>([]);
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const following = await fetchFollowing(user.id).catch(() => []);
        if (following.length >= 3) return; // 이미 친구가 충분 — 추천 줄 숨김
        const followingIds = new Set(following.map(f => f.id));
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const activeOnly = (list: NearbyRunner[]) => list.filter(r =>
          !followingIds.has(r.user_id) && r.last_active && new Date(r.last_active).getTime() >= weekAgo);
        // 같은 나라 우선 → 부족하면 글로벌로 채움
        let picks = activeOnly(await fetchNearbyRunners('country', 20).catch(() => []));
        if (picks.length < 3) {
          const global = activeOnly(await fetchNearbyRunners('national', 20).catch(() => []));
          const seen = new Set(picks.map(p => p.user_id));
          picks = [...picks, ...global.filter(g => !seen.has(g.user_id))];
        }
        if (!cancelled) setRunners(picks.slice(0, 5));
      } catch { /* 조용히 — 추천 줄은 없어도 체크리스트는 정상 */ }
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (runners.length === 0) return null;

  const handleFollow = async (r: NearbyRunner) => {
    if (!user || busy || followed.has(r.user_id)) return;
    setBusy(r.user_id);
    setFollowed(prev => new Set(prev).add(r.user_id)); // optimistic
    try {
      await followUser(r.user_id);
      try { window.localStorage.setItem(`first_friend_added:${user.id}`, String(Date.now())); } catch {}
      onFollowed();
    } catch {
      setFollowed(prev => { const n = new Set(prev); n.delete(r.user_id); return n; });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-2 p-3 rounded-2xl bg-white dark:bg-zinc-900 border border-emerald-200/60 dark:border-emerald-900/40">
      <p className="text-[13px] font-bold text-emerald-700 dark:text-emerald-300 mb-2 inline-flex items-center gap-1">
        <Sparkles size={11} /> {tt('요즘 달리고 있는 러너들이에요')}
      </p>
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5">
        {runners.map(r => {
          const isFollowed = followed.has(r.user_id);
          return (
            <div key={r.user_id} className="flex-shrink-0 w-[104px] p-2.5 rounded-xl border border-[var(--card-border)] bg-[var(--background)] text-center">
              <Link href={`/social/user?id=${r.user_id}`} className="block">
                <div className="w-11 h-11 rounded-full bg-[var(--card-border)]/40 overflow-hidden mx-auto">
                  {r.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-sm font-bold text-[var(--muted)]">
                      {r.display_name.slice(0, 1)}
                    </div>
                  )}
                </div>
                <p className="text-[13px] font-extrabold truncate mt-1.5 text-[var(--foreground)]">{r.display_name}</p>
              </Link>
              <p className="text-[12px] text-[var(--muted)] font-bold mt-0.5">
                {locale === 'en' ? `${r.km_30d.toFixed(1)}km · 30d` : `30일 ${r.km_30d.toFixed(1)}km`}
              </p>
              <button
                type="button"
                onClick={() => handleFollow(r)}
                disabled={busy === r.user_id || isFollowed}
                className={`mt-1.5 w-full inline-flex items-center justify-center gap-1 py-1.5 rounded-lg text-[13px] font-extrabold active:scale-95 transition disabled:opacity-70 ${
                  isFollowed
                    ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                    : 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-sm shadow-emerald-500/25'
                }`}
              >
                {isFollowed ? <Check size={11} strokeWidth={3} /> : <UserPlus size={11} />}
                {isFollowed ? tt('추가됨') : tt('팔로우')}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function HomeOnboardingCard() {
  const { profile, user } = useAuth();
  const { activities, goals } = useUserData();
  const { locale } = useI18n();
  const [profileExpanded, setProfileExpanded] = useState(false);
  const [healthExpanded, setHealthExpanded] = useState(false);
  const [goalExpanded, setGoalExpanded] = useState(false);
  const [inviteExpanded, setInviteExpanded] = useState(false);
  // build 292: 이 세션에서 초대 코드 등록 성공 — profile 캐시(invited_by)는 stale 이라 별도 state.
  const [inviteClaimed, setInviteClaimed] = useState(false);
  // build 293: 추천 팔로우 줄에서 이 세션에 팔로우 성공 — localStorage flag 는 렌더 트리거가 아니라 별도 state.
  const [friendJustAdded, setFriendJustAdded] = useState(false);
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

  // build 164 #1: 생년·성별만 필수. 지역은 권장이되 강제 아님 (KR 국가만 채우고 시·구 비워둔
  // 사용자도 "저장 완료" 로 인식되어야 자연스러움).
  const profileDone = !!(profile.birth_year && profile.gender);

  const healthFlag = typeof window !== 'undefined'
    ? !!window.localStorage.getItem(`first_sync_done:${user.id}`)
    : false;
  const hasHealthActivity = activities.some(a => a.source === 'health_kit' || a.source === 'health_connect');
  const healthDone = !iosNative || healthFlag || hasHealthActivity || runCount >= 1;

  // build 165 #1: 이달 목표도 시작 가이드에 인라인.
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const goalDone = goals.some(g => g.year === curYear && g.month === curMonth && g.goal_km > 0);

  type Item =
    | { id: string; label: string; done: boolean; inline: 'profile' | 'health' | 'goal' | 'invite' }
    | { id: string; label: string; done: boolean; href: string };

  const items: Item[] = [
    { id: 'profile', label: locale === 'en' ? 'Enter region, birth year, gender' : '지역·생년·성별 입력', done: profileDone, inline: 'profile' },
  ];
  // 2026-08-09: 광고 전환 이벤트(첫 러닝)를 온보딩 최상단 액션으로. 이전엔 iOS 에 첫 러닝
  // 항목이 아예 없었고, 안드로이드는 '첫 러닝 기록' 이 /connect(건강 연동) 로 가서 정작
  // 앱에서 달리기를 시작하는 진입점이 체크리스트에 없었다. → 전 플랫폼 /track 로 통일.
  items.push({ id: 'first_run', label: locale === 'en' ? 'Start your first run' : '첫 러닝 시작하기', done: runCount >= 1, href: '/track' });
  if (iosNative) {
    items.push({ id: 'health', label: locale === 'en' ? 'Connect Apple Health' : 'Apple 건강 앱 연동하기', done: healthDone, inline: 'health' });
  }
  // build 166 #2: 사용자 요청 — 친구 1명 추가 → 5월 목표 정하기 순서.
  // (마지막 항목이 완료되면 시작 가이드 카드 자체가 사라지므로, 목표 정하기를 마지막에 둠.)
  const friendDone = friendJustAdded || (typeof window !== 'undefined'
    ? !!window.localStorage.getItem(`first_friend_added:${user.id}`)
    : false);
  items.push({ id: 'friend', label: locale === 'en' ? 'Add 1 friend' : '친구 1명 추가', done: friendDone, href: '/social' });
  // build 292: 초대 코드 입력 — 이미 invited_by 가 있으면 항목 자체 숨김.
  // getProfile 은 select('*') 라 컬럼 배포 후엔 profile 에 invited_by 가 실려 옴
  // (컬럼 미배포면 undefined → 항목 노출, claim 시도에서 사유 안내).
  // claim 직후엔 profile 이 stale (invited_by null) — localStorage flag 로 done 표시.
  const invitedByVal = (profile as { invited_by?: string | null }).invited_by;
  const inviteDone = inviteClaimed || (typeof window !== 'undefined'
    ? !!window.localStorage.getItem(`referral_claimed:${user.id}`)
    : false);
  if (!invitedByVal) {
    items.push({ id: 'invite', label: locale === 'en' ? 'Enter invite code' : '초대 코드 입력', done: inviteDone, inline: 'invite' });
  }
  const monthShort = locale === 'en'
    ? new Date(curYear, curMonth - 1, 1).toLocaleString('en-US', { month: 'long' })
    : `${curMonth}월`;
  items.push({ id: 'goal', label: locale === 'en' ? `Set ${monthShort} goal` : `${monthShort} 목표 정하기`, done: goalDone, inline: 'goal' });

  const doneCount = items.filter(i => i.done).length;
  if (doneCount === items.length) return null;

  return (
    <div className="mx-4 mt-3 rounded-3xl bg-gradient-to-br from-emerald-100/80 via-emerald-50/40 to-teal-50 dark:from-emerald-950/40 dark:via-emerald-950/20 dark:to-teal-950/20 border border-emerald-200/60 dark:border-emerald-900/40 p-5 shadow-sm">
      <div className="mb-3">
        <p className="text-[12px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide inline-flex items-center gap-1">
          <Sparkles size={11} /> {locale === 'en' ? `Day ${signupDays + 1}` : `가입 ${signupDays + 1}일째`}
        </p>
        <h3 className="text-lg font-extrabold text-[var(--foreground)] mt-0.5">{locale === 'en' ? 'Getting started' : '시작 가이드'}</h3>
        <p className="text-xs text-[var(--muted)] mt-0.5">
          {/* 2026-08-09: "마일리지 보너스" 는 온보딩 완료 이벤트가 없어 지키지 못하는 약속이었다.
              진행 격려 카피로 교체 (허위 인센티브 제거). */}
          {locale === 'en'
            ? `${doneCount}/${items.length} done · Set up your running home`
            : `${doneCount}/${items.length} 완료 · 나만의 러닝 홈을 완성해요`}
        </p>
      </div>
      <ul className="space-y-2">
        {items.map((it, idx) => {
          const isInline = 'inline' in it;
          const expanded = isInline && it.inline === 'profile'
            ? profileExpanded
            : isInline && it.inline === 'health'
            ? healthExpanded
            : isInline && it.inline === 'goal'
            ? goalExpanded
            : isInline && it.inline === 'invite'
            ? inviteExpanded
            : false;
          const inner = (
            <>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                it.done ? 'bg-emerald-500 text-white shadow-sm' : 'bg-[var(--card-border)]/40 text-[var(--muted)]'
              }`}>
                {it.done ? <Check size={14} strokeWidth={3} /> : <span className="text-[12px] font-extrabold">{idx + 1}</span>}
              </span>
              <span className={`flex-1 text-center text-sm font-bold ${
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
              else if (it.inline === 'health') setHealthExpanded(v => !v);
              else if (it.inline === 'goal') setGoalExpanded(v => !v);
              else if (it.inline === 'invite') setInviteExpanded(v => !v);
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
                {!it.done && expanded && it.inline === 'goal' && (
                  <InlineMonthlyGoalForm onSaved={() => setGoalExpanded(false)} />
                )}
                {!it.done && expanded && it.inline === 'invite' && (
                  <InlineInviteCodeForm onClaimed={() => { setInviteClaimed(true); setInviteExpanded(false); }} />
                )}
              </li>
            );
          }
          return (
            <li key={it.id}>
              <Link href={it.href} className={rowClass}>{inner}</Link>
              {/* build 293: '친구' 항목 아래 추천 팔로우 미니 카드 줄 */}
              {it.id === 'friend' && !it.done && (
                <RecommendedRunnersRow onFollowed={() => setFriendJustAdded(true)} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
