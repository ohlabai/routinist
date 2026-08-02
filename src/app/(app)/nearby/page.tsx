'use client';

// 동네 러너 검색 (build 116 A 패키지).
// 반경 4단계 (같은 동/구/시/전국). region 기반 매칭 (GPS 정확도 X — privacy).
// 친구 찾기 + 함께 달리기 모집판 진입점.

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, MapPin, Users, Activity, MessageCircle, Search, UserPlus, Zap, Globe, Share2, Clock } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import {
  fetchNearbyRunners,
  fetchPaceMatchedRunners,
  fetchActiveGlobalRunners,
  formatPace,
  scopeNeedsRegion,
  SCOPE_LABEL,
  SCOPE_DESC,
  type NearbyRunner,
  type NearbyScope,
  type PaceMatchedRunner,
} from '@/lib/nearby-data';
import { unfollowUser, fetchFollowing } from '@/lib/social-data';
// build 317 (2026-07-26 hans): 즉시 follow → 신청+수락 모델 통일 (FollowButton 과 동일)
import {
  sendFriendRequest, cancelFriendRequest,
  getMySentPendingMap, touchSentPendingCache,
} from '@/lib/friend-requests-data';
import { shareInvite } from '@/lib/referral-data';
import GenderBadge from '@/components/profile/GenderBadge';
import AppLogo from '@/components/AppLogo';
import AppToast from '@/components/AppToast';
import { track } from '@/lib/analytics';
import { useI18n } from '@/lib/i18n';

// build 293: 'country' (같은 나라) 스코프 추가 — 해외 유저 콜드스타트.
const SCOPES: NearbyScope[] = ['dong', 'gu', 'si', 'country', 'national'];

function ageOf(year: number | null, locale: string): string {
  if (!year) return '';
  const age = new Date().getFullYear() - year;
  if (age < 10 || age > 100) return '';
  const decade = Math.floor(age / 10) * 10;
  return locale === 'en' ? `${decade}s` : `${decade}대`;
}

export default function NearbyPage() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { t, tt, locale } = useI18n();
  const [scope, setScope] = useState<NearbyScope>('gu');
  const [mode, setMode] = useState<'region' | 'pace'>('region');
  const [runners, setRunners] = useState<NearbyRunner[]>([]);
  const [paceRunners, setPaceRunners] = useState<PaceMatchedRunner[]>([]);
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  // build 317: 내가 보낸 pending 신청 (receiverId → requestId) — 버튼 "신청 보냄" 상태용
  const [sentMap, setSentMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2200);
  };

  const search = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const followingPromise = fetchFollowing(user.id).catch(() => []);
      const sentPromise = getMySentPendingMap().catch(() => new Map<string, string>());
      if (mode === 'pace') {
        const [pace, following, sent] = await Promise.all([
          fetchPaceMatchedRunners(20).catch(() => []),
          followingPromise,
          sentPromise,
        ]);
        setPaceRunners(pace);
        setFollowingIds(new Set(following.map(f => f.id)));
        setSentMap(new Map(sent));
        track('nearby_search', { mode: 'pace', result_count: pace.length });
      } else {
        const [list, following, sent] = await Promise.all([
          fetchNearbyRunners(scope, 100),
          followingPromise,
          sentPromise,
        ]);
        setRunners(list);
        setFollowingIds(new Set(following.map(f => f.id)));
        setSentMap(new Map(sent));
        track('nearby_search', { mode: 'region', scope, result_count: list.length });
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : tt('검색 실패'), 'warn');
    } finally {
      setLoading(false);
    }
  }, [user, scope, mode]);

  // build 293: 지역 미설정 유저 초기 스코프 — country_code 있으면 '같은 나라', 없으면 '전 세계'.
  // (한국 행정구역이 없는 해외 유저도 빈 화면 대신 바로 결과를 보게.)
  const scopeInitRef = useRef(false);
  useEffect(() => {
    if (!profile || scopeInitRef.current) return;
    scopeInitRef.current = true;
    if (!profile.region_gu) {
      setScope(profile.country_code ? 'country' : 'national');
    }
  }, [profile]);

  // 첫 진입 + mode/scope 변경 시 자동 검색.
  // country/national 스코프는 지역 미설정이어도 검색 가능 (build 293).
  useEffect(() => {
    if (user && (mode === 'pace' || profile?.region_gu || !scopeNeedsRegion(scope))) {
      void search();
    }
  }, [user, profile?.region_gu, mode, scope, search]);

  // build 317: 즉시 follow → 신청 모델. none → 신청 / sent → 취소 confirm / friend → 해제 confirm.
  const handleFollow = async (target: NearbyRunner) => {
    if (busy === target.user_id) return;
    setBusy(target.user_id);
    const isFollowing = followingIds.has(target.user_id);
    const sentId = sentMap.get(target.user_id);
    try {
      if (isFollowing) {
        if (!window.confirm(locale === 'en' ? 'Remove this friend?' : '친구에서 해제할까요?')) return;
        await unfollowUser(target.user_id);
        setFollowingIds(prev => { const n = new Set(prev); n.delete(target.user_id); return n; });
        showToast(tt('친구에서 해제했어요'));
      } else if (sentId) {
        if (!window.confirm(locale === 'en' ? 'Cancel this friend request?' : '보낸 친구 신청을 취소할까요?')) return;
        await cancelFriendRequest(sentId);
        setSentMap(prev => { const n = new Map(prev); n.delete(target.user_id); return n; });
        touchSentPendingCache(target.user_id, null);
        showToast(tt('신청을 취소했어요'));
      } else {
        const rid = await sendFriendRequest(target.user_id);
        if (rid) {
          setSentMap(prev => new Map(prev).set(target.user_id, rid));
          touchSentPendingCache(target.user_id, rid);
        }
        showToast(tt('친구 신청을 보냈어요 💌'));
        track('nearby_follow', { target: target.user_id });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : tt('실패');
      // 서버 친근 안내 ("상대가 이미 친구 신청을 보냈어요!" / "이미 친구예요") 는 그대로
      if (msg.includes('이미 친구')) {
        setFollowingIds(prev => new Set(prev).add(target.user_id));
        showToast(msg);
      } else {
        showToast(msg, msg.includes('상대가') ? 'ok' : 'warn');
      }
    } finally {
      setBusy(null);
    }
  };

  // build 293: 빈 결과 empty state 의 친구 초대 — InviteFriendCard 와 같은 공유 로직 (referral-data).
  const [inviting, setInviting] = useState(false);
  const handleInvite = async () => {
    if (!user || inviting) return;
    setInviting(true);
    try {
      const r = await shareInvite(user.id, locale);
      if (r === 'copied') showToast(tt('초대 링크를 복사했어요'));
    } finally {
      setInviting(false);
    }
  };

  const noRegion = !profile?.region_gu;
  // 지역이 필요한 스코프(dong/gu/si)인데 지역 미설정 — 검색 불가, 지역 설정 유도.
  const regionBlocked = noRegion && scopeNeedsRegion(scope);

  return (
    <div className="max-w-lg mx-auto pb-20 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/85 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="px-3 py-3 flex items-center gap-2">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full active:bg-[var(--card-border)]/30">
            <ArrowLeft size={20} />
          </button>
          <AppLogo size={24} />
          <h1 className="text-xl font-extrabold tracking-tight">{t('nearby.title')}</h1>
        </div>

        {/* mode toggle — 동네 vs 페이스 */}
        <div className="px-4 pb-2 flex gap-1.5">
          <button
            onClick={() => setMode('region')}
            className={`flex-1 py-2 rounded-full text-xs font-extrabold active:scale-95 inline-flex items-center justify-center gap-1 ${
              mode === 'region' ? 'bg-emerald-500 text-white shadow' : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
            }`}
          >
            <MapPin size={12} /> {t('nearby.modeRegion')}
          </button>
          <button
            onClick={() => setMode('pace')}
            className={`flex-1 py-2 rounded-full text-xs font-extrabold active:scale-95 inline-flex items-center justify-center gap-1 ${
              mode === 'pace' ? 'bg-emerald-500 text-white shadow' : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
            }`}
          >
            <Zap size={12} /> {t('nearby.modePace')}
          </button>
        </div>

        {/* scope 칩 (region 모드에서만) + 검색 */}
        {mode === 'region' && (
          <div className="px-4 pb-3 flex items-center gap-2 overflow-x-auto scrollbar-hide">
            {SCOPES.map(s => (
              <button
                key={s}
                onClick={() => setScope(s)}
                disabled={loading || (noRegion && scopeNeedsRegion(s))}
                className={`flex-shrink-0 px-3.5 py-2 rounded-full text-sm font-bold whitespace-nowrap active:scale-95 transition disabled:opacity-40 ${
                  scope === s
                    ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-500/30'
                    : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
                }`}
              >
                {tt(SCOPE_LABEL[s])}
              </button>
            ))}
            <button
              onClick={search}
              disabled={loading || regionBlocked}
              className="flex-shrink-0 ml-auto px-3.5 py-2 rounded-full bg-emerald-500 text-white font-bold text-sm active:scale-95 disabled:opacity-50 inline-flex items-center gap-1"
            >
              <Search size={14} /> {t('nearby.searchCta')}
            </button>
          </div>
        )}
      </header>

      <div className="p-4 space-y-3">
        {mode === 'pace' ? (
          <PaceMatchedSection
            runners={paceRunners}
            loading={loading}
            followingIds={followingIds}
            sentMap={sentMap}
            busy={busy}
            onFollow={(r) => handleFollow({ ...r, region_si: null, region_dong: null, bio: null, birth_year: null, total_runs: 0, total_distance_km: 0, last_active: null } as NearbyRunner)}
          />
        ) : regionBlocked ? (
          <Link href="/profile/edit" className="block rounded-2xl bg-gradient-to-br from-emerald-100/80 to-emerald-50/40 dark:from-emerald-950/30 dark:to-emerald-950/10 border border-emerald-200/60 dark:border-emerald-900/40 p-5 active:scale-[0.99]">
            <p className="text-base font-extrabold text-[var(--foreground)] inline-flex items-center gap-1.5">
              <MapPin size={16} className="text-emerald-600" /> {tt('우리 동네부터 설정해주세요')}
            </p>
            <p className="text-sm text-[var(--muted)] mt-1.5 leading-relaxed">
              {tt('지역을 입력하면 같은 동·구·시의 러너를 찾을 수 있어요.')}
            </p>
            <p className="text-xs font-bold text-emerald-600 mt-2">{tt('프로필 편집')} →</p>
          </Link>
        ) : (
          <>
            {/* 안내 카드 */}
            <div className="rounded-2xl bg-gradient-to-br from-emerald-50/70 to-emerald-50/30 dark:from-emerald-950/30 dark:to-emerald-950/10 border border-emerald-200/50 dark:border-emerald-900/40 p-4">
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                {locale === 'en' ? (
                  <>Found runners in <span className="font-extrabold text-emerald-700 dark:text-emerald-300">{tt(SCOPE_LABEL[scope])}</span>. {tt(SCOPE_DESC[scope])}.</>
                ) : (
                  <><span className="font-extrabold text-emerald-700 dark:text-emerald-300">{SCOPE_LABEL[scope]}</span>의 러너를 찾았어요. {SCOPE_DESC[scope]}.</>
                )}
                <br />{tt('친구 추가하고 메시지로 함께 달리기 모임을 만들어 보세요.')}
              </p>
            </div>

            {/* 결과 */}
            {loading ? (
              <div className="space-y-2">
                {[0,1,2,3].map(i => <div key={i} className="card p-3 h-20 animate-pulse" />)}
              </div>
            ) : runners.length === 0 ? (
              <>
                <div className="text-center pt-12 pb-6 px-6">
                  <div className="w-16 h-16 rounded-full bg-emerald-50 dark:bg-emerald-950/30 mx-auto mb-3 flex items-center justify-center">
                    <Users size={28} className="text-emerald-500" />
                  </div>
                  <p className="text-base font-extrabold mb-1">
                    {locale === 'en' ? `No runners in ${tt(SCOPE_LABEL[scope])} yet` : `${SCOPE_LABEL[scope]}에 아직 러너가 없어요`}
                  </p>
                  <p className="text-sm text-[var(--muted)]">
                    {tt('범위를 더 넓혀 보거나 친구를 초대해서 함께 달려보세요')}
                  </p>
                  {/* build 293: 콜드스타트 — 빈 화면에서 곧장 초대 공유 */}
                  <button
                    onClick={handleInvite}
                    disabled={inviting}
                    className="mt-4 inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-sm font-extrabold shadow-md shadow-emerald-500/25 active:scale-95 disabled:opacity-50"
                  >
                    <Share2 size={14} /> {tt('친구 초대하기')}
                  </button>
                </div>
                {/* build 293: 글로벌 fallback — 이번 주 활동한 전 세계 러너 */}
                {scope !== 'national' && (
                  <GlobalRunnersFallback
                    followingIds={followingIds}
                    sentMap={sentMap}
                    busy={busy}
                    onFollow={handleFollow}
                  />
                )}
              </>
            ) : (
              runners.map(r => (
                <RunnerCard
                  key={r.user_id}
                  r={r}
                  following={followingIds.has(r.user_id)}
                  sent={sentMap.has(r.user_id)}
                  busy={busy === r.user_id}
                  onFollow={() => handleFollow(r)}
                />
              ))
            )}
          </>
        )}
      </div>

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2000} />}
    </div>
  );
}

// 러너 카드 — 지역 결과 / 글로벌 fallback 공용 (build 293 추출).
function RunnerCard({ r, following, sent, busy, onFollow }: {
  r: NearbyRunner;
  following: boolean;
  /** build 317: 친구 신청 보냄 (pending) 상태 */
  sent: boolean;
  busy: boolean;
  onFollow: () => void;
}) {
  const { tt, locale } = useI18n();
  const isActive30d = (r.runs_30d ?? 0) > 0;
  return (
    <article className="rounded-2xl bg-[var(--card)] border border-[var(--card-border)] p-4">
      <div className="flex items-start gap-3">
        <Link href={`/social/user?id=${r.user_id}`} className="flex-shrink-0">
          <div className="w-12 h-12 rounded-full bg-[var(--card-border)]/40 overflow-hidden">
            {r.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-base font-bold text-[var(--muted)]">
                {r.display_name.slice(0, 1)}
              </div>
            )}
          </div>
        </Link>
        <div className="flex-1 min-w-0">
          <Link href={`/social/user?id=${r.user_id}`} className="inline-flex items-center gap-1.5">
            <p className="text-base font-extrabold truncate">{r.display_name}</p>
            <GenderBadge gender={r.gender} show={r.show_gender} size={13} />
          </Link>
          <p className="text-xs text-[var(--muted)] inline-flex items-center gap-1 mt-0.5">
            <MapPin size={11} />
            {[r.region_si, r.region_gu, r.region_dong].filter(Boolean).join(' ') || tt('지역 미설정')}
            {ageOf(r.birth_year, locale) && <span className="ml-1">· {ageOf(r.birth_year, locale)}</span>}
          </p>
          {r.bio && <p className="text-xs text-[var(--muted)] mt-1 line-clamp-2 italic">{r.bio}</p>}
          <p className="text-[13px] text-[var(--muted)] inline-flex items-center gap-2 mt-1.5">
            <span className="inline-flex items-center gap-0.5 font-bold">
              <Activity size={10} className="text-emerald-500" />
              {isActive30d
                ? (locale === 'en' ? `30d ${r.runs_30d} runs · ${r.km_30d.toFixed(1)}km` : `30일 ${r.runs_30d}회·${r.km_30d.toFixed(1)}km`)
                : tt('최근 비활성')}
            </span>
          </p>
        </div>
        <button
          onClick={onFollow}
          disabled={busy}
          aria-label={following ? tt('친구 끊기') : sent ? tt('신청 보냄 · 탭하면 취소') : tt('친구 신청')}
          className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 active:scale-95 disabled:opacity-50 transition ${
            following
              ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
              : sent
                ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-300'
                : 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-500/25'
          }`}
        >
          {sent && !following ? <Clock size={16} /> : <UserPlus size={16} />}
        </button>
      </div>
      {/* 친선런 초대 버튼 제거 (단순화 B) — contest 기능 삭제. 쪽지만 유지. */}
      <div className="mt-3 flex items-center gap-2">
        <Link
          href={`/messages?to=${r.user_id}`}
          className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-xl bg-[var(--card-border)]/30 text-sm font-bold active:scale-95"
        >
          <MessageCircle size={13} /> {tt('쪽지')}
        </Link>
      </div>
    </article>
  );
}

// build 293: 지역 결과 0명일 때 "전 세계 러너" fallback — 이번 주 활동한 공개 러너 상위 N.
// 해외 신규 시장에서 nearby 가 완전히 빈 화면이 되는 콜드스타트 방지.
function GlobalRunnersFallback({ followingIds, sentMap, busy, onFollow }: {
  followingIds: Set<string>;
  sentMap: Map<string, string>;
  busy: string | null;
  onFollow: (r: NearbyRunner) => void;
}) {
  const { tt } = useI18n();
  const [runners, setRunners] = useState<NearbyRunner[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchActiveGlobalRunners(8)
      .then(list => { if (!cancelled) setRunners(list); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map(i => <div key={i} className="card p-3 h-20 animate-pulse" />)}
      </div>
    );
  }
  if (runners.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-gradient-to-br from-emerald-50/70 to-teal-50/40 dark:from-emerald-950/30 dark:to-teal-950/10 border border-emerald-200/50 dark:border-emerald-900/40 p-4">
        <p className="text-sm font-extrabold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1.5 mb-1">
          <Globe size={14} /> {tt('전 세계 러너')}
        </p>
        <p className="text-xs text-[var(--muted)] leading-relaxed">
          {tt('이번 주에 달린 전 세계 러너들이에요. 먼저 친구를 걸어보세요!')}
        </p>
      </div>
      {runners.map(r => (
        <RunnerCard
          key={r.user_id}
          r={r}
          following={followingIds.has(r.user_id)}
          sent={sentMap.has(r.user_id)}
          busy={busy === r.user_id}
          onFollow={() => onFollow(r)}
        />
      ))}
    </div>
  );
}

// 페이스 매칭 결과 — 30일 평균 페이스 ±20초 범위 러너
function PaceMatchedSection({ runners, loading, followingIds, sentMap, busy, onFollow }: {
  runners: PaceMatchedRunner[];
  loading: boolean;
  followingIds: Set<string>;
  sentMap: Map<string, string>;
  busy: string | null;
  onFollow: (r: PaceMatchedRunner) => void;
}) {
  const { tt, locale } = useI18n();
  if (loading) {
    return (
      <div className="space-y-2">
        {[0,1,2,3].map(i => <div key={i} className="card p-3 h-20 animate-pulse" />)}
      </div>
    );
  }
  if (runners.length === 0) {
    return (
      <div className="text-center py-16 px-6">
        <div className="w-16 h-16 rounded-full bg-emerald-50 dark:bg-emerald-950/30 mx-auto mb-3 flex items-center justify-center">
          <Zap size={28} className="text-emerald-500" />
        </div>
        <p className="text-base font-extrabold mb-1">{tt('비슷한 페이스의 러너가 아직 없어요')}</p>
        <p className="text-sm text-[var(--muted)]">{tt('최근 30일 페이스 데이터가 쌓이면 더 정확하게 추천돼요')}</p>
      </div>
    );
  }
  return (
    <>
      <div className="rounded-2xl bg-gradient-to-br from-emerald-50/70 to-emerald-50/30 dark:from-emerald-950/30 dark:to-emerald-950/10 border border-emerald-200/50 dark:border-emerald-900/40 p-4">
        <p className="text-sm font-extrabold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1.5 mb-1">
          <Zap size={14} /> {tt('비슷한 페이스의 러너')}
        </p>
        <p className="text-xs text-[var(--muted)] leading-relaxed">
          {tt('30일 평균 페이스가 ±20초 차이 안 러너입니다. 함께 달리면 페이스 유지에 도움돼요.')}
        </p>
      </div>

      {/* 페이스 그룹 진입점 제거 (단순화 B) — 멤버 0명, /pace-groups 라우트 삭제. */}

      {runners.map(r => {
        const following = followingIds.has(r.user_id);
        return (
          <article key={r.user_id} className="rounded-2xl bg-[var(--card)] border border-[var(--card-border)] p-4">
            <div className="flex items-start gap-3">
              <Link href={`/social/user?id=${r.user_id}`} className="flex-shrink-0">
                <div className="w-12 h-12 rounded-full bg-[var(--card-border)]/40 overflow-hidden">
                  {r.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-base font-bold text-[var(--muted)]">
                      {r.display_name.slice(0, 1)}
                    </div>
                  )}
                </div>
              </Link>
              <div className="flex-1 min-w-0">
                <Link href={`/social/user?id=${r.user_id}`} className="inline-flex items-center gap-1.5">
                  <p className="text-base font-extrabold truncate">{r.display_name}</p>
                  <GenderBadge gender={r.gender} show={r.show_gender} size={13} />
                </Link>
                <p className="text-xs text-[var(--muted)] inline-flex items-center gap-1 mt-0.5">
                  <MapPin size={11} /> {r.region_gu ?? tt('지역 미설정')}
                </p>
                <div className="mt-1.5 flex items-center gap-3 text-[13px]">
                  <span className="inline-flex items-center gap-0.5 font-bold text-emerald-600">
                    <Zap size={11} /> {formatPace(r.avg_pace_sec)}/km
                  </span>
                  <span className="text-[var(--muted)] font-bold">
                    {locale === 'en' ? `±${Math.round(r.pace_diff_sec)}s vs my pace` : `내 페이스와 ±${Math.round(r.pace_diff_sec)}초`}
                  </span>
                  <span className="text-[var(--muted)] font-bold">
                    {locale === 'en' ? `· 30d ${r.runs_30d} runs` : `· 30일 ${r.runs_30d}회`}
                  </span>
                </div>
              </div>
              <button
                onClick={() => onFollow(r)}
                disabled={busy === r.user_id}
                aria-label={following ? tt('친구 끊기') : sentMap.has(r.user_id) ? tt('신청 보냄 · 탭하면 취소') : tt('친구 신청')}
                className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 active:scale-95 disabled:opacity-50 transition ${
                  following
                    ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                    : sentMap.has(r.user_id)
                      ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-300'
                      : 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-500/25'
                }`}
              >
                {sentMap.has(r.user_id) && !following ? <Clock size={16} /> : <UserPlus size={16} />}
              </button>
            </div>
          </article>
        );
      })}
    </>
  );
}
