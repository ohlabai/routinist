'use client';

import { useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/components/UserDataProvider';
import { formatPace, formatDuration } from '@/lib/routinist-data';
import CommentSection from '@/components/social/CommentSection';
import ShareCard from '@/components/activity/ShareCard';
import { Share2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import { Suspense } from 'react';

const RouteMap = dynamic(() => import('@/components/map/RouteMap'), { ssr: false });

function ActivityDetail() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, profile } = useAuth();
  const { activities } = useUserData();
  const id = searchParams.get('id');

  const [showShare, setShowShare] = useState(false);
  const activity = useMemo(() => activities.find(a => a.id === id), [activities, id]);

  if (!activity) {
    return (
      <div className="p-4 max-w-lg mx-auto text-center py-20">
        <p className="text-[var(--muted)]">활동을 찾을 수 없습니다.</p>
        <button onClick={() => router.back()} className="text-[var(--accent)] text-sm mt-4">뒤로가기</button>
      </div>
    );
  }

  const sourceLabel = {
    manual: '수동 입력',
    gps: 'GPS 트래킹',
    health_kit: 'Apple Health',
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
        <h2 className="text-lg font-bold text-[var(--foreground)] flex-1">활동 상세</h2>
        <button onClick={() => setShowShare(true)} className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-[var(--card-border)] text-[var(--accent)]">
          <Share2 size={20} />
        </button>
      </div>

      {/* 공유 카드 모달 */}
      {showShare && (
        <ShareCard activity={activity} displayName={profile?.display_name ?? '러너'} onClose={() => setShowShare(false)} />
      )}

      {/* 지도 (GPS 데이터가 있을 때) */}
      {activity.route_data && (
        <RouteMap routeData={activity.route_data} height="240px" />
      )}

      {/* 핵심 통계 */}
      <div className="card p-6">
        <p className="text-4xl font-extrabold text-[var(--accent)] text-center mb-4">
          {activity.distance_km.toFixed(2)} <span className="text-lg">km</span>
        </p>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-2xl font-extrabold text-[var(--foreground)]">
              {activity.duration_seconds ? formatDuration(activity.duration_seconds) : '-'}
            </p>
            <p className="text-xs text-[var(--muted)]">시간</p>
          </div>
          <div>
            <p className="text-2xl font-extrabold text-[var(--foreground)]">
              {activity.pace_avg_sec_per_km ? formatPace(activity.pace_avg_sec_per_km) : '-'}
            </p>
            <p className="text-xs text-[var(--muted)]">페이스/km</p>
          </div>
          <div>
            <p className="text-2xl font-extrabold text-[var(--foreground)]">
              {activity.calories ?? activity.active_energy_kcal ?? '-'}
            </p>
            <p className="text-xs text-[var(--muted)]">kcal</p>
          </div>
        </div>
        {/* 심박수 (데이터 있을 때만) */}
        {(activity.heart_rate_avg || activity.heart_rate_max) && (
          <div className="grid grid-cols-2 gap-4 text-center mt-4 pt-4 border-t border-[var(--card-border)]">
            {activity.heart_rate_avg && (
              <div>
                <p className="text-2xl font-extrabold text-red-500">{activity.heart_rate_avg}</p>
                <p className="text-xs text-[var(--muted)]">평균 심박수</p>
              </div>
            )}
            {activity.heart_rate_max && (
              <div>
                <p className="text-2xl font-extrabold text-red-400">{activity.heart_rate_max}</p>
                <p className="text-xs text-[var(--muted)]">최대 심박수</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 상세 정보 */}
      <div className="card p-5 space-y-3">
        {activity.activity_type && (
          <div className="flex justify-between">
            <span className="text-xs text-[var(--muted)]">운동 종류</span>
            <span className="text-sm text-[var(--foreground)] font-semibold">
              {activity.activity_type === 'walking' ? '걷기 🚶' : '러닝 🏃'}
            </span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-xs text-[var(--muted)]">날짜</span>
          <span className="text-sm text-[var(--foreground)]">
            {new Date(activity.activity_date).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-xs text-[var(--muted)]">기록 방식</span>
          <span className="text-sm text-[var(--foreground)]">{sourceLabel}</span>
        </div>
        {activity.memo && (
          <div className="pt-2 border-t border-[var(--card-border)]">
            <p className="text-xs text-[var(--muted)] mb-1">메모</p>
            <p className="text-sm text-[var(--foreground)]">{activity.memo}</p>
          </div>
        )}
      </div>

      {/* 응원 + 댓글 */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-[var(--foreground)] mb-3">응원 & 댓글</h3>
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
          공유카드 만들기
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
