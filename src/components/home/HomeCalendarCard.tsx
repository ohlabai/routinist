'use client';

// 홈 inline 캘린더 카드 — build 68 신설.
// 이전: 클릭 시 시트 → 풀 페이지 이동. 사용자 피드백: "페이지 이동 자체가 부담".
// 이번: 홈 안에서 풀 캘린더 콘텐츠 (사진 썸네일, 거리, 전월 ←→). 셀 탭 → 활동 상세로만 점프.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Share2 } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/components/UserDataProvider';
import { getSupabase } from '@/lib/supabase';
import ShareCard from '@/components/activity/ShareCard';
import { useI18n } from '@/lib/i18n';
import { fetchWeekChartData, fetchMonthChartData } from '@/lib/period-share-data';
import type { PeriodChartData } from '@/lib/period-share-canvas';
import PeriodShareCard from '@/components/share/PeriodShareCard';

function distanceColor(km: number, dateStr: string): string {
  if (km <= 0) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cellDate = new Date(dateStr + 'T00:00:00');
    if (cellDate > today) return 'bg-green-50 dark:bg-green-950/20';
    return 'bg-gray-100 dark:bg-zinc-800/50';
  }
  if (km < 3) return 'bg-green-200 dark:bg-green-900/40';
  if (km < 7) return 'bg-green-400 dark:bg-green-700/60';
  if (km < 10) return 'bg-green-500 dark:bg-green-600/70';
  if (km < 15) return 'bg-green-600 dark:bg-green-500/80';
  return 'bg-green-800 dark:bg-green-400/90';
}

export default function HomeCalendarCard() {
  const { user, profile } = useAuth();
  const { activities } = useUserData();
  const { tt, locale } = useI18n();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [photos, setPhotos] = useState<Map<string, string>>(new Map());
  const [customPhotos, setCustomPhotos] = useState<Map<string, string>>(new Map());
  // build 288: 같은 날 여러 활동 중 route_data 있는 id 우선 link. lite cache 엔 route_data 없으므로
  // 별도 id-only query 로 set 만 확보 (페이로드 가벼움). 없으면 거리 큰 활동 fallback.
  const [routeIds, setRouteIds] = useState<Set<string>>(new Set());
  // build 170 #2: storage object 가 사라져 broken URL 인 셀은 거리 기반 초록 fallback 으로 복귀.
  // 한 번 onError 발생한 URL 은 set 에 저장 → 같은 URL 재시도 안 함 (무한 onError 루프 방지).
  const [brokenUrls, setBrokenUrls] = useState<Set<string>>(new Set());
  // build 136: 캘린더 셀 탭 없이 바로 공유카드 만들기 — 최근 활동으로 진입.
  // build 207 #15: 공유카드 진입점 통합 — 옵션 선택 시트 (오늘 / 이번 주 / 이번 달).
  const [shareCardOpen, setShareCardOpen] = useState(false);
  const [periodPickerOpen, setPeriodPickerOpen] = useState(false);
  const [periodData, setPeriodData] = useState<PeriodChartData | null>(null);
  const [periodLoading, setPeriodLoading] = useState<'week' | 'month' | null>(null);

  const openPeriod = async (period: 'week' | 'month') => {
    if (!user || periodLoading) return;
    setPeriodLoading(period);
    try {
      const fn = period === 'week' ? fetchWeekChartData : fetchMonthChartData;
      const userName = profile?.display_name ?? user.email?.split('@')[0] ?? tt('러너');
      const { data } = await fn(user.id, userName);
      setPeriodData(data);
      setPeriodPickerOpen(false);
    } catch (e) {
      console.warn('[share-period] fetch fail', e);
    } finally {
      setPeriodLoading(null);
    }
  };

  const monthlyActivities = useMemo(
    () =>
      // activity_date 'YYYY-MM-DD' 는 문자열 prefix 비교 (UTC 파싱 시 서쪽 timezone 하루 밀림)
      activities.filter((a) => a.activity_date.slice(0, 7) === `${year}-${String(month).padStart(2, '0')}`),
    [activities, year, month],
  );

  const dateDistanceMap = useMemo(() => {
    const map = new Map<string, number>();
    monthlyActivities.forEach((a) => {
      map.set(a.activity_date, (map.get(a.activity_date) || 0) + Number(a.distance_km));
    });
    return map;
  }, [monthlyActivities]);

  // build 288: 같은 날 활동 여러 개면 (1) route_data 있는 활동 우선, (2) 같은 그룹 내 거리 큰 것.
  // 이전엔 첫 번째(시각 늦은) 활동만 link → 사용자가 6-25 22:00 짧은 2.58km 를 link 하고 메인 운동
  // (05:36 6.26km)의 지도 진입을 못 했음. hans 2026-06-26 신고 케이스.
  const dateActivityMap = useMemo(() => {
    const byDate = new Map<string, typeof monthlyActivities>();
    monthlyActivities.forEach((a) => {
      const arr = byDate.get(a.activity_date) ?? [];
      arr.push(a);
      byDate.set(a.activity_date, arr);
    });
    const out = new Map<string, string>();
    byDate.forEach((arr, date) => {
      const withRoute = arr.filter((a) => routeIds.has(a.id));
      const pool = withRoute.length > 0 ? withRoute : arr;
      const pick = pool.reduce((best, cur) =>
        Number(cur.distance_km) > Number(best.distance_km) ? cur : best,
      );
      out.set(date, pick.id);
    });
    return out;
  }, [monthlyActivities, routeIds]);

  const loadPhotos = useCallback(async () => {
    if (!user || monthlyActivities.length === 0) {
      setPhotos(new Map());
      return;
    }
    try {
      const supabase = getSupabase();
      const ids = monthlyActivities.map((a) => a.id);
      const { data } = await supabase
        .from('activity_photos')
        .select('activity_id, photo_url')
        .in('activity_id', ids)
        .order('sort_order', { ascending: true });
      if (!data?.length) {
        setPhotos(new Map());
        return;
      }
      const dateMap = new Map<string, string>();
      monthlyActivities.forEach((a) => dateMap.set(a.id, a.activity_date));
      const out = new Map<string, string>();
      data.forEach((p) => {
        const date = dateMap.get(p.activity_id);
        if (date && !out.has(date)) out.set(date, p.photo_url);
      });
      setPhotos(out);
    } catch (err) {
      console.warn('[HomeCalendar] photos 실패', err);
    }
  }, [user, monthlyActivities]);

  const loadCustomPhotos = useCallback(async () => {
    if (!user) return;
    try {
      const supabase = getSupabase();
      const start = `${year}-${String(month).padStart(2, '0')}-01`;
      const end = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`;
      const { data } = await supabase
        .from('calendar_photos')
        .select('date, photo_url')
        .eq('user_id', user.id)
        .gte('date', start)
        .lte('date', end);
      if (data?.length) {
        const map = new Map<string, string>();
        data.forEach((p) => map.set(p.date, p.photo_url));
        setCustomPhotos(map);
      } else {
        setCustomPhotos(new Map());
      }
    } catch (err) {
      console.warn('[HomeCalendar] custom photos 실패', err);
    }
  }, [user, year, month]);

  // build 288: 이달 활동 중 route_data 있는 id 만 가져옴. 페이로드 가벼움 (id 컬럼만).
  // 셀 클릭 시 같은 날 여러 활동 중 지도 있는 것을 우선 link 하기 위한 데이터.
  const loadRouteIds = useCallback(async () => {
    if (!user || monthlyActivities.length === 0) {
      setRouteIds(new Set());
      return;
    }
    try {
      const supabase = getSupabase();
      const ids = monthlyActivities.map((a) => a.id);
      const { data } = await supabase
        .from('activities')
        .select('id')
        .in('id', ids)
        .not('route_data', 'is', null);
      setRouteIds(new Set((data ?? []).map((d) => d.id)));
    } catch (err) {
      console.warn('[HomeCalendar] routeIds 실패', err);
    }
  }, [user, monthlyActivities]);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);
  useEffect(() => {
    loadCustomPhotos();
  }, [loadCustomPhotos]);
  useEffect(() => {
    loadRouteIds();
  }, [loadRouteIds]);

  // 사용자 변경 시 month/year 를 현재로 reset — 이전 계정의 달이 stale 하게 남는 문제 방지.
  useEffect(() => {
    const n = new Date();
    setYear(n.getFullYear());
    setMonth(n.getMonth() + 1);
    // user.id 변경에만 반응. eslint 의 exhaustive-deps 는 의도적으로 무시.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const prevMonthLastDay = new Date(year, month - 1, 0).getDate();
  const prevMonthFillDays = Array.from(
    { length: firstDay },
    (_, i) => prevMonthLastDay - firstDay + i + 1,
  );

  const totalKm = monthlyActivities.reduce((s, a) => s + Number(a.distance_km), 0);
  const runDays = new Set(monthlyActivities.map((a) => a.activity_date)).size;

  const prev = () => {
    if (month === 1) {
      setYear((y) => y - 1);
      setMonth(12);
    } else setMonth((m) => m - 1);
  };
  const next = () => {
    if (month === 12) {
      setYear((y) => y + 1);
      setMonth(1);
    } else setMonth((m) => m + 1);
  };

  return (
    <div className="card p-4">
      {/* 월 선택 헤더 — 전월/익월 nav */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={prev}
          aria-label={locale === 'en' ? 'Previous month' : '이전 달'}
          className="w-9 h-9 rounded-xl flex items-center justify-center active:bg-[var(--card-border)] transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="flex items-baseline gap-2">
          <span className="text-base font-bold text-[var(--foreground)]">
            {locale === 'en'
              ? new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
              : `${year}년 ${month}월`}
          </span>
          <span className="text-xs text-[var(--muted)]">
            {locale === 'en' ? `${totalKm.toFixed(1)}km · ${runDays} days` : `${totalKm.toFixed(1)}km · ${runDays}일`}
          </span>
        </div>
        <button
          onClick={next}
          aria-label={locale === 'en' ? 'Next month' : '다음 달'}
          className="w-9 h-9 rounded-xl flex items-center justify-center active:bg-[var(--card-border)] transition-colors"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs mb-1">
        {(locale === 'en'
          ? ['S', 'M', 'T', 'W', 'T', 'F', 'S']
          : ['일', '월', '화', '수', '목', '금', '토']
        ).map((d, i) => (
          <span
            key={`${i}-${d}`}
            className={`py-1 font-semibold ${
              i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-[var(--muted)]'
            }`}
          >
            {d}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {prevMonthFillDays.map((d) => (
          <div
            key={`p-${d}`}
            className="aspect-square rounded-md flex items-center justify-center bg-gray-50 dark:bg-zinc-900/40 opacity-40"
          >
            <span className="text-[10px] text-[var(--muted)]">{d}</span>
          </div>
        ))}

        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const km = dateDistanceMap.get(dateStr) || 0;
          const rawPhotoUrl = customPhotos.get(dateStr) || photos.get(dateStr);
          // build 170 #2: broken URL 은 fallback (거리 기반 초록셀).
          const photoUrl = rawPhotoUrl && !brokenUrls.has(rawPhotoUrl) ? rawPhotoUrl : undefined;
          const hasPhoto = !!photoUrl;
          const bg = distanceColor(km, dateStr);
          const activityId = dateActivityMap.get(dateStr);
          const textWhite = km >= 7 || hasPhoto;

          // build 169 #12: day 숫자 + km 숫자 겹침 fix — 두 span 을 절대 위치로 분리.
          // day 는 top, km 은 bottom 에 고정 → 좁은 화면에서도 line-height 충돌 없음.
          const inner = (
            <div
              className={`aspect-square rounded-md relative overflow-hidden ${
                hasPhoto ? '' : bg
              } ${km > 0 ? 'ring-1 ring-green-300/50' : ''}`}
            >
              {hasPhoto && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photoUrl}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                    onError={() => {
                      if (photoUrl) setBrokenUrls(prev => {
                        if (prev.has(photoUrl)) return prev;
                        const next = new Set(prev); next.add(photoUrl); return next;
                      });
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                </>
              )}
              <span className={`absolute top-0.5 left-1/2 -translate-x-1/2 text-[11px] font-bold leading-none ${textWhite ? 'text-white drop-shadow' : 'text-[var(--foreground)]'}`}>
                {day}
              </span>
              {km > 0 && (
                <span className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[8px] font-semibold leading-none whitespace-nowrap ${textWhite ? 'text-white/95 drop-shadow' : 'text-[var(--muted)]'}`}>
                  {km.toFixed(1)}
                </span>
              )}
            </div>
          );

          // 활동 있으면 셀 탭 시 활동 상세로 직접 이동.
          return activityId ? (
            <Link key={day} href={`/activity?id=${activityId}`} className="active:scale-95 transition">
              {inner}
            </Link>
          ) : (
            <div key={day}>{inner}</div>
          );
        })}
      </div>

      {/* 범례 — build 152: "사진 등록 →" 링크 제거 (사용자 피드백, 별도 페이지에서 돌아오는 메뉴 없음). */}
      <div className="flex items-center gap-1 mt-3 text-[10px] text-[var(--muted)]">
        <span className="w-2.5 h-2.5 rounded bg-green-200" />
        <span className="w-2.5 h-2.5 rounded bg-green-400" />
        <span className="w-2.5 h-2.5 rounded bg-green-500" />
        <span className="w-2.5 h-2.5 rounded bg-green-600" />
        <span className="w-2.5 h-2.5 rounded bg-green-800" />
        <span className="ml-1">3 · 7 · 10 · 15+</span>
      </div>

      {/* 공유카드 만들기 — build 207 #15: 옵션 선택 시트 (오늘 / 이번 주 / 이번 달) 통합 진입점. */}
      {activities.length > 0 && (
        <button
          onClick={() => setPeriodPickerOpen(true)}
          className="mt-3 w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-base shadow-md shadow-emerald-500/30 active:scale-[0.98] transition"
        >
          <Share2 size={18} />
          {locale === 'en' ? 'Make share card' : '공유카드 만들기'}
        </button>
      )}

      {/* 옵션 선택 시트 */}
      {periodPickerOpen && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/55 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]"
          onClick={() => !periodLoading && setPeriodPickerOpen(false)}>
          <div className="bg-[var(--background)] w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-5 pb-8 sm:pb-5 shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full bg-[var(--card-border)] mx-auto mb-4 sm:hidden" />
            <h3 className="text-lg font-extrabold text-center mb-1">
              {locale === 'en' ? 'Share card' : '공유카드 만들기'}
            </h3>
            <p className="text-xs text-[var(--muted)] text-center mb-5">
              {locale === 'en' ? 'Pick a period to share' : '기간을 골라주세요'}
            </p>
            <div className="space-y-3">
              <button
                onClick={() => { setPeriodPickerOpen(false); setShareCardOpen(true); }}
                disabled={periodLoading !== null}
                className="w-full py-5 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-lg shadow-md shadow-emerald-500/30 active:scale-[0.98] disabled:opacity-50 inline-flex items-center justify-center gap-2.5"
              >
                <Share2 size={20} />
                {locale === 'en' ? 'Today' : '오늘'}
              </button>
              <button
                onClick={() => openPeriod('week')}
                disabled={periodLoading !== null}
                className="w-full py-5 rounded-2xl bg-[var(--card)] border-2 border-emerald-500/50 text-[var(--foreground)] font-extrabold text-lg active:scale-[0.98] disabled:opacity-50 inline-flex items-center justify-center gap-2.5"
              >
                {periodLoading === 'week' ? <span className="animate-spin text-xl">⏳</span> : null}
                {locale === 'en' ? 'This week' : '이번 주'}
              </button>
              <button
                onClick={() => openPeriod('month')}
                disabled={periodLoading !== null}
                className="w-full py-5 rounded-2xl bg-[var(--card)] border-2 border-emerald-500/50 text-[var(--foreground)] font-extrabold text-lg active:scale-[0.98] disabled:opacity-50 inline-flex items-center justify-center gap-2.5"
              >
                {periodLoading === 'month' ? <span className="animate-spin text-xl">⏳</span> : null}
                {locale === 'en' ? 'This month' : '이번 달'}
              </button>
            </div>
          </div>
        </div>
      )}

      {shareCardOpen && activities.length > 0 && (
        <ShareCard
          activity={activities[0]}
          displayName={profile?.display_name ?? tt('러너')}
          onClose={() => setShareCardOpen(false)}
        />
      )}

      {periodData && <PeriodShareCard data={periodData} onClose={() => setPeriodData(null)} />}
    </div>
  );
}
