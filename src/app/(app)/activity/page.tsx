'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/components/UserDataProvider';
import { formatDuration, fetchActivityRoute, fetchActivityById } from '@/lib/routinist-data';
import { useDistanceUnit, toDisplayDistance, unitLabel, paceUnitLabel, formatPaceForUnit } from '@/lib/units';
import type { Activity } from '@/types';
import CommentSection from '@/components/social/CommentSection';
import CheerButton from '@/components/social/CheerButton';
import ShareCard from '@/components/activity/ShareCard';
import BestSplitsCard from '@/components/activity/BestSplitsCard';
import { Share2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import { useI18n } from '@/lib/i18n';

const RouteMap = dynamic(() => import('@/components/map/RouteMap'), { ssr: false });

function ActivityDetail() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, profile } = useAuth();
  const { activities, refresh } = useUserData();
  const { t, locale } = useI18n();
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
  const [fallbackActivity, setFallbackActivity] = useState<Activity | null>(null);
  const [fallbackTried, setFallbackTried] = useState(false);
  const cachedActivity = useMemo(() => activities.find(a => a.id === id), [activities, id]);
  const baseActivity = cachedActivity ?? fallbackActivity;

  // 캐시에 없으면 단건 DB fetch (저장 직후 race 회피). 백그라운드로 UserDataProvider refresh 도 트리거.
  useEffect(() => {
    if (!id) return;
    if (cachedActivity) return;
    if (fallbackTried) return;
    let cancelled = false;
    setFallbackTried(true);
    (async () => {
      const a = await fetchActivityById(id);
      if (!cancelled && a) setFallbackActivity(a);
      // 캐시 동기화 (다음 진입 빠르게)
      refresh().catch(() => {});
    })();
    return () => { cancelled = true; };
  }, [id, cachedActivity, fallbackTried, refresh]);

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

  if (!activity) {
    // 폴백 fetch 시도 중에는 로딩, 끝나도 못 찾으면 not found.
    if (id && !fallbackTried) {
      return (
        <div className="p-4 max-w-lg mx-auto text-center py-20">
          <p className="text-[var(--muted)]">{t('common.loading')}</p>
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
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-[var(--card-border)]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <h2 className="text-lg font-bold text-[var(--foreground)] flex-1">{t('activity.title')}</h2>
        <button onClick={() => setShowShare(true)} className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-[var(--card-border)] text-[var(--accent)]">
          <Share2 size={20} />
        </button>
      </div>

      {/* 공유 카드 모달 */}
      {showShare && (
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
            {new Date(activity.activity_date).toLocaleDateString(locale === 'en' ? 'en-US' : 'ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
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
            <p className="text-sm font-extrabold text-[var(--foreground)]">이 러너에게 응원 보내기</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">매주 한 번씩 이모지로 응원해보세요</p>
          </div>
          <CheerButton toUserId={activity.user_id} context="profile" />
        </div>
      )}

      {/* 응원 + 댓글 */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-[var(--foreground)] mb-3">{t('activity.commentsTitle')}</h3>
        <CommentSection activityId={activity.id} activityOwnerId={activity.user_id} />
      </div>

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
