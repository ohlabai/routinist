'use client';

// 홈 inline 캘린더 카드 — build 68 신설.
// 이전: 클릭 시 시트 → 풀 페이지 이동. 사용자 피드백: "페이지 이동 자체가 부담".
// 이번: 홈 안에서 풀 캘린더 콘텐츠 (사진 썸네일, 거리, 전월 ←→). 셀 탭 → 활동 상세로만 점프.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/components/UserDataProvider';
import { getSupabase } from '@/lib/supabase';

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
  const { user } = useAuth();
  const { activities } = useUserData();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [photos, setPhotos] = useState<Map<string, string>>(new Map());
  const [customPhotos, setCustomPhotos] = useState<Map<string, string>>(new Map());

  const monthlyActivities = useMemo(
    () =>
      activities.filter((a) => {
        const d = new Date(a.activity_date);
        return d.getFullYear() === year && d.getMonth() + 1 === month;
      }),
    [activities, year, month],
  );

  const dateDistanceMap = useMemo(() => {
    const map = new Map<string, number>();
    monthlyActivities.forEach((a) => {
      map.set(a.activity_date, (map.get(a.activity_date) || 0) + Number(a.distance_km));
    });
    return map;
  }, [monthlyActivities]);

  const dateActivityMap = useMemo(() => {
    const map = new Map<string, string>();
    monthlyActivities.forEach((a) => {
      if (!map.has(a.activity_date)) map.set(a.activity_date, a.id);
    });
    return map;
  }, [monthlyActivities]);

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

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);
  useEffect(() => {
    loadCustomPhotos();
  }, [loadCustomPhotos]);

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
          aria-label="이전 달"
          className="w-9 h-9 rounded-xl flex items-center justify-center active:bg-[var(--card-border)] transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="flex items-baseline gap-2">
          <span className="text-base font-bold text-[var(--foreground)]">{year}년 {month}월</span>
          <span className="text-xs text-[var(--muted)]">
            {totalKm.toFixed(1)}km · {runDays}일
          </span>
        </div>
        <button
          onClick={next}
          aria-label="다음 달"
          className="w-9 h-9 rounded-xl flex items-center justify-center active:bg-[var(--card-border)] transition-colors"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs mb-1">
        {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
          <span
            key={d}
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
          const photoUrl = customPhotos.get(dateStr) || photos.get(dateStr);
          const hasPhoto = !!photoUrl;
          const bg = distanceColor(km, dateStr);
          const activityId = dateActivityMap.get(dateStr);
          const textWhite = km >= 7 || hasPhoto;

          const inner = (
            <div
              className={`aspect-square rounded-md relative overflow-hidden flex flex-col items-center justify-center ${
                hasPhoto ? '' : bg
              } ${km > 0 ? 'ring-1 ring-green-300/50' : ''}`}
            >
              {hasPhoto && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photoUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                </>
              )}
              <span className={`relative text-xs font-semibold ${textWhite ? 'text-white' : 'text-[var(--foreground)]'}`}>
                {day}
              </span>
              {km > 0 && (
                <span className={`relative text-[9px] font-medium ${textWhite ? 'text-white/90' : 'text-[var(--muted)]'}`}>
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

      {/* 범례 + 풀 페이지 링크 */}
      <div className="flex items-center justify-between mt-3 text-[10px] text-[var(--muted)]">
        <div className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded bg-green-200" />
          <span className="w-2.5 h-2.5 rounded bg-green-400" />
          <span className="w-2.5 h-2.5 rounded bg-green-500" />
          <span className="w-2.5 h-2.5 rounded bg-green-600" />
          <span className="w-2.5 h-2.5 rounded bg-green-800" />
          <span className="ml-1">3 · 7 · 10 · 15+</span>
        </div>
        <Link href="/calendar" className="text-[var(--accent)] font-semibold">사진 등록 →</Link>
      </div>
    </div>
  );
}
