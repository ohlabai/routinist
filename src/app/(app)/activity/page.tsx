'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/components/UserDataProvider';
import { formatDuration, fetchActivityRoute, fetchActivityById, startTimeLabel } from '@/lib/routinist-data';
import { getSupabase } from '@/lib/supabase';
import { startOfWeekStr, todayStr } from '@/lib/kst';
import { ttl } from '@/lib/i18n';
import { ACHIEVEMENTS } from '@/lib/achievements-data';
import BadgeCelebration from '@/components/home/BadgeCelebration';
import AppToast from '@/components/AppToast';
import { useDistanceUnit, toDisplayDistance, unitLabel, paceUnitLabel, formatPaceForUnit } from '@/lib/units';
import type { Activity } from '@/types';
import CommentSection from '@/components/social/CommentSection';
import CheerButton from '@/components/social/CheerButton';
import ShareCard from '@/components/activity/ShareCard';
import BestSplitsCard from '@/components/activity/BestSplitsCard';
import { Share2, Sparkles } from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import { useI18n } from '@/lib/i18n';

const RouteMap = dynamic(() => import('@/components/map/RouteMap'), { ssr: false });

function ActivityDetail() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, profile } = useAuth();
  const { activities, refresh } = useUserData();
  const { t, tt, locale } = useI18n();
  // build 293: 비로그인 게스트 read-only 모드 — /r/{id} 공유 랜딩 "웹으로 보기" 유입.
  // RLS 가 visibility=public 활동만 anon 에게 허용 → 조회 자체가 접근 제어.
  // 게스트에겐 댓글/응원/공유 UI 숨김 + 하단 "Routinist 시작하기" CTA.
  const isGuest = !user;
  const unit = useDistanceUnit(); // build 290: 표시 단위 (km/mi) — 저장·계산은 km 그대로
  const id = searchParams.get('id');
  const newPbRaw = searchParams.get('new_pb');
  const newPbDistances = useMemo<number[]>(() => {
    if (!newPbRaw) return [];
    try { return JSON.parse(decodeURIComponent(newPbRaw)) as number[]; } catch { return []; }
  }, [newPbRaw]);

  const [showShare, setShowShare] = useState(false);
  // build 161 #12-1: UserDataProvider 의 활동은 route_data 가 없는 lite 버전 (첫 로그인 가속).
  // 활동 상세 진입 시 단건 route_data 만 lazy fetch → 메인 fetch 부담은 그대로 둠.
  const [route, setRoute] = useState<import('@/types').GeoJSONLineString | null>(null);
  // build 222 #3: 캐시 miss (저장 직후 router.push) 폴백 — 단건 DB fetch.
  // 2026-07-12: fetch 시작과 동시에 tried=true 가 되어 응답 도착 전에 "찾을 수 없습니다" 가
  // 먼저 렌더되던 버그 fix (본인 활동은 캐시 hit 라 안 걸리고, Run of the Day 등 남의 활동만
  // 걸렸음) — done 은 fetch 완료 시점에만 세움.
  // 2026-07-15 리뷰 fix: boolean ref/state 는 마운트 중 ?id= 가 바뀌면 새 id 를 영원히
  // fetch 안 하고 이전 활동을 계속 보여줌 — 결과를 id 에 묶어 파생 (id 바뀌면 자동 리셋).
  const [fallbackResult, setFallbackResult] = useState<{ id: string; activity: Activity | null } | null>(null);
  const fallbackStartedForIdRef = useRef<string | null>(null);
  const fallbackActivity = fallbackResult && fallbackResult.id === id ? fallbackResult.activity : null;
  const fallbackDone = fallbackResult?.id === id;
  const cachedActivity = useMemo(() => activities.find(a => a.id === id), [activities, id]);
  const baseActivity = cachedActivity ?? fallbackActivity;

  // 캐시에 없으면 단건 DB fetch (저장 직후 race 회피). 백그라운드로 UserDataProvider refresh 도 트리거.
  useEffect(() => {
    if (!id) return;
    if (cachedActivity) return;
    if (fallbackStartedForIdRef.current === id) return;
    fallbackStartedForIdRef.current = id;
    (async () => {
      const a = await fetchActivityById(id);
      // id 가 그 사이 또 바뀌었으면 낡은 결과 폐기
      if (fallbackStartedForIdRef.current !== id) return;
      setFallbackResult({ id, activity: a });
      // 캐시 동기화 (다음 진입 빠르게)
      refresh().catch(() => {});
    })();
  }, [id, cachedActivity, refresh]);

  useEffect(() => {
    if (!id || !baseActivity) return;
    if (baseActivity.route_data) { setRoute(baseActivity.route_data); return; }
    let cancelled = false;
    (async () => {
      const r = await fetchActivityRoute(id);
      if (!cancelled && r?.route_data) setRoute(r.route_data);
    })();
    return () => { cancelled = true; };
  }, [id, baseActivity]);

  const activity = useMemo(
    () => baseActivity ? { ...baseActivity, route_data: route ?? baseActivity.route_data ?? null } : null,
    [baseActivity, route]
  );

  // ── build 299: 러닝 직후 보상 순간 (TrackSummarySheet 저장 → just_saved=1 로 진입) ──

  // 신규 배지 축하 — TrackSummarySheet 가 저장 직후 체크한 배지 코드를 query 로 전달받아
  // 그 자리에서 BadgeCelebration 모달. dashboard 와 같은 localStorage
  // `badge_celebrated:{code}` 계약 → 홈 복귀 시 이중 축하 없음.
  const justSaved = searchParams.get('just_saved') === '1';
  const newBadgesRaw = searchParams.get('new_badges');
  const [badgeQueue, setBadgeQueue] = useState<string[]>(() => {
    // lazy initializer — mount 시 1회만 평가 (query param 은 저장 직후 진입에서만 옴)
    if (!newBadgesRaw || typeof window === 'undefined') return [];
    try {
      return newBadgesRaw
        .split(',')
        .filter(code => ACHIEVEMENTS[code] && !localStorage.getItem(`badge_celebrated:${code}`));
    } catch { return []; /* localStorage 불가 환경 — 축하 생략 */ }
  });

  // 마일리지 적립 피드백 — 서버 트리거 (km당 1P + 보너스) 가 심은 mileage_transactions 를
  // activity_id (metadata) 로 1회 조회해서 "+NP 적립" 토스트. 트리거 지연 대비 1.5s 재시도 1번.
  const [mileageToast, setMileageToast] = useState<string | null>(null);
  const mileageCheckedRef = useRef(false);
  useEffect(() => {
    if (!justSaved || !id || !user || mileageCheckedRef.current) return;
    mileageCheckedRef.current = true;
    let cancelled = false;
    const fetchEarned = async (): Promise<number> => {
      const { data } = await getSupabase()
        .from('mileage_transactions')
        .select('amount')
        .eq('user_id', user.id)
        .eq('metadata->>activity_id', id);
      return ((data ?? []) as { amount: number | null }[])
        .reduce((sum, r) => sum + (r.amount ?? 0), 0);
    };
    (async () => {
      try {
        let total = await fetchEarned();
        if (total <= 0) {
          await new Promise(r => setTimeout(r, 1500));
          if (cancelled) return;
          total = await fetchEarned();
        }
        if (!cancelled && total > 0) {
          setMileageToast(ttl('마일리지 +{n}P 적립!').replace('{n}', String(total)));
        }
      } catch { /* 적립 조회 실패 — 토스트 생략 (저장 자체는 정상) */ }
    })();
    return () => { cancelled = true; };
  }, [justSaved, id, user]);

  // 이번 주 n번째 러닝 — KST(사용자 timezone) 월~일 기준 러닝 수 (걷기 제외).
  // 본인 활동 + 이번 주 활동일 때만 표시. (주간 스트릭 연동은 다음 빌드 — 여기선 이 한 줄만)
  const [weekRunCount, setWeekRunCount] = useState<number | null>(null);
  useEffect(() => {
    if (!user || !baseActivity) return;
    if (baseActivity.user_id !== user.id) return;
    if (baseActivity.activity_type === 'walking') return;
    const weekStart = startOfWeekStr();
    const today = todayStr();
    if (baseActivity.activity_date < weekStart || baseActivity.activity_date > today) return;
    let cancelled = false;
    (async () => {
      try {
        const { count } = await getSupabase()
          .from('activities')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('activity_type', 'running')
          .gte('activity_date', weekStart)
          .lte('activity_date', today);
        if (!cancelled && count != null && count > 0) setWeekRunCount(count);
      } catch { /* 조회 실패 — 라인 생략 */ }
    })();
    return () => { cancelled = true; };
  }, [user, baseActivity]);

  if (!activity) {
    // 폴백 fetch 시도 중에는 로딩, 끝나도 못 찾으면 not found.
    if (id && !fallbackDone) {
      return (
        <div className="p-4 max-w-lg mx-auto text-center py-20">
          <p className="text-[var(--muted)]">{t('common.loading')}</p>
        </div>
      );
    }
    // 게스트: 비공개/삭제된 활동 — RLS 에 걸려 조회 자체가 안 됨. 친근한 안내 + 시작 CTA.
    if (isGuest) {
      return (
        <div className="p-6 max-w-lg mx-auto text-center py-20">
          <div className="w-16 h-16 rounded-full bg-emerald-50 dark:bg-emerald-950/30 mx-auto mb-3 flex items-center justify-center">
            <Sparkles size={28} className="text-emerald-500" />
          </div>
          <p className="text-base font-extrabold text-[var(--foreground)]">{tt('지금은 볼 수 없는 기록이에요')}</p>
          <p className="text-sm text-[var(--muted)] mt-1.5">{tt('비공개이거나 삭제된 기록일 수 있어요')}</p>
          <Link
            href="/login"
            className="mt-6 inline-flex items-center justify-center gap-1.5 px-6 py-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-sm font-extrabold shadow-md shadow-emerald-500/25 active:scale-95"
          >
            {tt('Routinist 시작하기')}
          </Link>
        </div>
      );
    }
    return (
      <div className="p-4 max-w-lg mx-auto text-center py-20">
        <p className="text-[var(--muted)]">{t('activity.notFound')}</p>
        <button onClick={() => router.back()} className="text-[var(--accent)] text-sm mt-4">{t('common.back')}</button>
      </div>
    );
  }

  const sourceLabel = {
    manual: t('activity.sourceManual'),
    gps: t('activity.sourceGps'),
    health_kit: 'Apple Health',
    health_kit_walk: 'Apple Health',
    health_connect: 'Health Connect',
  }[activity.source];

  return (
    <div className="p-4 max-w-lg mx-auto space-y-4 pb-8">
      {/* build 299: 저장 직후 보상 순간 — 적립 토스트 + 신규 배지 축하 모달 */}
      {mileageToast && (
        <AppToast text={mileageToast} tone="ok" onClose={() => setMileageToast(null)} durationMs={3500} />
      )}
      {badgeQueue.length > 0 && (
        <BadgeCelebration
          key={badgeQueue[0]}
          code={badgeQueue[0]}
          onClose={() => {
            try { localStorage.setItem(`badge_celebrated:${badgeQueue[0]}`, '1'); } catch {}
            setBadgeQueue(q => q.slice(1));
          }}
        />
      )}

      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-[var(--card-border)]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <h2 className="text-lg font-bold text-[var(--foreground)] flex-1">{t('activity.title')}</h2>
        {!isGuest && (
          <button onClick={() => setShowShare(true)} className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-[var(--card-border)] text-[var(--accent)]">
            <Share2 size={20} />
          </button>
        )}
      </div>

      {/* build 299: 이번 주 n번째 러닝 — 완주 직후 "쌓이고 있다" 는 감각 한 줄 */}
      {weekRunCount !== null && (
        <div className="flex justify-center">
          <span className="inline-flex items-center px-5 py-2.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-800/40 text-base font-extrabold text-emerald-700 dark:text-emerald-300">
            {ttl('이번 주 {n}번째 러닝 🔥').replace('{n}', String(weekRunCount))}
          </span>
        </div>
      )}

      {/* 공유 카드 모달 */}
      {showShare && !isGuest && (
        <ShareCard activity={activity} displayName={profile?.display_name ?? t('profile.runner')} onClose={() => setShowShare(false)} />
      )}

      {/* 지도 (GPS 데이터가 있을 때) */}
      {activity.route_data && (
        <RouteMap routeData={activity.route_data} height="240px" />
      )}

      {/* 핵심 통계 */}
      <div className="card p-6">
        <p className="text-4xl font-extrabold text-[var(--accent)] text-center mb-4">
          {toDisplayDistance(activity.distance_km, unit).toFixed(2)} <span className="text-lg">{unitLabel(unit)}</span>
        </p>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-2xl font-extrabold text-[var(--foreground)]">
              {activity.duration_seconds ? formatDuration(activity.duration_seconds) : '-'}
            </p>
            <p className="text-xs text-[var(--muted)]">{t('activity.duration')}</p>
            {/* 2026-07-18 (hans): 시작 시각 — 새벽 러너의 "몇 시에 뛰었나" 동기부여. 시간 스탯 바로 아래. */}
            {startTimeLabel(activity.started_at, locale === 'en' ? 'en' : 'ko') && (
              <p className="text-[11px] font-bold text-[var(--muted)]/90 mt-0.5">
                {startTimeLabel(activity.started_at, locale === 'en' ? 'en' : 'ko')}
              </p>
            )}
          </div>
          <div>
            <p className="text-2xl font-extrabold text-[var(--foreground)]">
              {activity.pace_avg_sec_per_km ? formatPaceForUnit(activity.pace_avg_sec_per_km, unit) : '-'}
            </p>
            {/* i18n.ts 수정 금지 표면이라 기존 "페이스/km" 라벨의 단위 부분만 치환 */}
            <p className="text-xs text-[var(--muted)]">{t('activity.pacePerKm').replace('/km', paceUnitLabel(unit))}</p>
          </div>
          <div>
            <p className="text-2xl font-extrabold text-[var(--foreground)]">
              {activity.calories ?? activity.active_energy_kcal ?? '-'}
            </p>
            <p className="text-xs text-[var(--muted)]">{t('activity.kcal')}</p>
          </div>
        </div>
        {/* 심박수 (데이터 있을 때만) */}
        {(activity.heart_rate_avg || activity.heart_rate_max) && (
          <div className="grid grid-cols-2 gap-4 text-center mt-4 pt-4 border-t border-[var(--card-border)]">
            {activity.heart_rate_avg && (
              <div>
                <p className="text-2xl font-extrabold text-red-500">{activity.heart_rate_avg}</p>
                <p className="text-xs text-[var(--muted)]">{t('activity.heartRateAvg')}</p>
              </div>
            )}
            {activity.heart_rate_max && (
              <div>
                <p className="text-2xl font-extrabold text-red-400">{activity.heart_rate_max}</p>
                <p className="text-xs text-[var(--muted)]">{t('activity.heartRateMax')}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* build 197: Best Splits + PB. GPS route 있을 때만 노출. */}
      {activity.route_data && activity.activity_type === 'running' && activity.user_id === user?.id && (
        <BestSplitsCard
          userId={activity.user_id}
          activityId={activity.id}
          routeData={activity.route_data}
          newPBDistances={newPbDistances}
        />
      )}

      {/* 상세 정보 */}
      <div className="card p-5 space-y-3">
        {activity.activity_type && (
          <div className="flex justify-between">
            <span className="text-xs text-[var(--muted)]">{t('activity.exerciseType')}</span>
            <span className="text-sm text-[var(--foreground)] font-semibold">
              {activity.activity_type === 'walking' ? t('activity.walking') : t('activity.running')}
            </span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-xs text-[var(--muted)]">{t('activity.date')}</span>
          <span className="text-sm text-[var(--foreground)]">
            {(() => {
              // 2026-07-15 리뷰 fix: 'YYYY-MM-DD' 를 Date() 에 직접 넣으면 UTC 자정 파싱 —
              // 미국 등 음수 offset 에서 하루 전으로 표시됨. 로컬 파싱 (dashboard 와 동일 패턴).
              const [y, m, d] = activity.activity_date.split('-').map(Number);
              return new Date(y, m - 1, d).toLocaleDateString(locale === 'en' ? 'en-US' : 'ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
            })()}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-xs text-[var(--muted)]">{t('activity.source')}</span>
          <span className="text-sm text-[var(--foreground)]">{sourceLabel}</span>
        </div>
        {activity.memo && (
          <div className="pt-2 border-t border-[var(--card-border)]">
            <p className="text-xs text-[var(--muted)] mb-1">{t('activity.memo')}</p>
            <p className="text-sm text-[var(--foreground)]">{activity.memo}</p>
          </div>
        )}
      </div>

      {/* build 276: 활동 owner 에게 직접 응원 — user_cheers (emoji picker).
          activity_cheers (CommentSection 안 좋아요-식 응원) 와 별도. 본인 활동 X. */}
      {activity.user_id !== user?.id && user && (
        <div className="card p-4 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-extrabold text-[var(--foreground)]">{tt('이 러너에게 응원 보내기')}</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">{tt('매주 한 번씩 이모지로 응원해보세요')}</p>
          </div>
          <CheerButton toUserId={activity.user_id} context="profile" />
        </div>
      )}

      {/* 응원 + 댓글 — 게스트에겐 숨기고 가입 CTA 로 대체 (read-only) */}
      {!isGuest ? (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-[var(--foreground)] mb-3">{t('activity.commentsTitle')}</h3>
          <CommentSection activityId={activity.id} activityOwnerId={activity.user_id} />
        </div>
      ) : (
        <div className="card p-6 text-center bg-gradient-to-br from-emerald-50/80 to-teal-50/40 dark:from-emerald-950/30 dark:to-teal-950/10 border-emerald-200/60 dark:border-emerald-900/40">
          <p className="text-base font-extrabold text-[var(--foreground)]">{tt('이 러너의 기록이 마음에 드나요?')}</p>
          <p className="text-sm text-[var(--muted)] mt-1.5">{tt('가입하면 응원과 댓글을 남길 수 있어요')}</p>
          <Link
            href="/login"
            className="mt-4 inline-flex items-center justify-center gap-1.5 px-6 py-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-sm font-extrabold shadow-md shadow-emerald-500/25 active:scale-95"
          >
            <Sparkles size={14} /> {tt('Routinist 시작하기')}
          </Link>
        </div>
      )}

      {/* 공유카드 만들기 — 사용자 피드백 #11: Apple Health sync 데이터 정합성 위해
          기록 삭제는 제거. 활동 상세의 주된 동기는 공유이므로 큰 진입점으로 대체. */}
      {activity.user_id === user?.id && (
        <button
          onClick={() => setShowShare(true)}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-emerald-500 text-white font-bold text-base active:scale-95 transition shadow-sm"
        >
          <Share2 size={20} />
          {t('activity.createShareCard')}
        </button>
      )}
    </div>
  );
}

export default function ActivityPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
      </div>
    }>
      <ActivityDetail />
    </Suspense>
  );
}
