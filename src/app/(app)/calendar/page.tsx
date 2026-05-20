'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/components/UserDataProvider';
import { getMonthlyDistance, formatDuration } from '@/lib/routinist-data';
import { getSupabase } from '@/lib/supabase';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Camera, Share2, Sparkles } from 'lucide-react';
import ShareCard from '@/components/activity/ShareCard';

// Git 잔디 스타일 — 초록 단일 그라데이션
function distanceColor(km: number, dateStr: string): string {
  if (km <= 0) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cellDate = new Date(dateStr + 'T00:00:00');
    if (cellDate > today) return 'bg-green-50 dark:bg-green-950/20';
    return 'bg-gray-100 dark:bg-zinc-800/50';
  }
  if (km < 3) return 'bg-green-200 dark:bg-green-900/40';
  if (km < 5) return 'bg-green-300 dark:bg-green-800/50';
  if (km < 7) return 'bg-green-400 dark:bg-green-700/60';
  if (km < 10) return 'bg-green-500 dark:bg-green-600/70';
  return 'bg-green-600 dark:bg-green-500/80';
}

function distanceTextColor(km: number): string {
  if (km >= 7) return 'text-white';
  return 'text-[var(--foreground)]';
}

interface PendingUpload {
  date: string;
  photoUrl: string;
  activityId: string | null;  // 러닝 활동 없는 날은 null
  applyToCalendar: boolean;
  shareToRoutinePhotos: boolean;
}

export default function CalendarPage() {
  const { user } = useAuth();
  const { activities, loading } = useUserData();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [photos, setPhotos] = useState<Map<string, string>>(new Map());
  const [customPhotos, setCustomPhotos] = useState<Map<string, string>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showDetail, setShowDetail] = useState<string | null>(null);
  const [shareActivityId, setShareActivityId] = useState<string | null>(null);

  // 업로드 완료 후 옵션 모달 (체크박스 통합)
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [applying, setApplying] = useState(false);

  const monthlyActivities = useMemo(() =>
    activities.filter(a => {
      const d = new Date(a.activity_date);
      return d.getFullYear() === year && d.getMonth() + 1 === month;
    }),
    [activities, year, month]
  );

  const dateDistanceMap = useMemo(() => {
    const map = new Map<string, number>();
    monthlyActivities.forEach(a => {
      const key = a.activity_date;
      map.set(key, (map.get(key) || 0) + Number(a.distance_km));
    });
    return map;
  }, [monthlyActivities]);

  const dateActivityMap = useMemo(() => {
    const map = new Map<string, string[]>();
    monthlyActivities.forEach(a => {
      const key = a.activity_date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a.id);
    });
    return map;
  }, [monthlyActivities]);

  const loadPhotos = useCallback(async () => {
    if (!user || monthlyActivities.length === 0) return;
    const supabase = getSupabase();
    const activityIds = monthlyActivities.map(a => a.id);

    const { data } = await supabase
      .from('activity_photos')
      .select('activity_id, photo_url')
      .in('activity_id', activityIds)
      .order('sort_order', { ascending: true });

    if (!data?.length) return;

    const actDateMap = new Map<string, string>();
    monthlyActivities.forEach(a => actDateMap.set(a.id, a.activity_date));

    const photoMap = new Map<string, string>();
    data.forEach(p => {
      const date = actDateMap.get(p.activity_id);
      if (date && !photoMap.has(date)) {
        photoMap.set(date, p.photo_url);
      }
    });

    setPhotos(photoMap);
  }, [user, monthlyActivities]);

  useEffect(() => { loadPhotos(); }, [loadPhotos]);

  const loadCustomPhotos = useCallback(async () => {
    if (!user) return;
    const supabase = getSupabase();
    const { data } = await supabase
      .from('calendar_photos')
      .select('date, photo_url')
      .eq('user_id', user.id)
      .gte('date', `${year}-${String(month).padStart(2, '0')}-01`)
      .lte('date', `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`);

    if (data?.length) {
      const map = new Map<string, string>();
      data.forEach(p => map.set(p.date, p.photo_url));
      setCustomPhotos(map);
    }
  }, [user, year, month]);

  useEffect(() => { loadCustomPhotos(); }, [loadCustomPhotos]);

  const handlePhotoSelect = (dateStr: string) => {
    setSelectedDate(dateStr);
    fileInputRef.current?.click();
  };

  // 파일 선택 시: storage 업로드만 하고 체크박스 모달을 띄움. 실제 적용은 모달 confirm 에서.
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !selectedDate) return;

    setUploading(true);
    try {
      const supabase = getSupabase();
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${user.id}/calendar/${selectedDate}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('activity-photos')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('activity-photos').getPublicUrl(path);
      const photoUrl = urlData.publicUrl + '?t=' + Date.now();

      const activityIds = dateActivityMap.get(selectedDate) ?? [];
      setPendingUpload({
        date: selectedDate,
        photoUrl,
        activityId: activityIds[0] ?? null,
        applyToCalendar: true,
        shareToRoutinePhotos: activityIds.length > 0,  // 러닝 있는 날만 공유 가능 (기본 체크)
      });
    } catch (err) {
      console.warn('사진 업로드 실패:', err);
    } finally {
      setUploading(false);
      setSelectedDate(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // 체크박스 모달 확인 — 선택된 옵션 적용
  const applyPendingUpload = async () => {
    if (!pendingUpload || !user) return;
    setApplying(true);
    try {
      const supabase = getSupabase();

      if (pendingUpload.applyToCalendar) {
        await supabase.from('calendar_photos').upsert({
          user_id: user.id,
          date: pendingUpload.date,
          photo_url: pendingUpload.photoUrl,
        }, { onConflict: 'user_id,date' });

        setCustomPhotos(prev => {
          const next = new Map(prev);
          next.set(pendingUpload.date, pendingUpload.photoUrl);
          return next;
        });
      }

      if (pendingUpload.shareToRoutinePhotos && pendingUpload.activityId) {
        await supabase.from('activity_photos').insert({
          activity_id: pendingUpload.activityId,
          user_id: user.id,
          photo_url: pendingUpload.photoUrl,
          share_in_gallery: true,
          sort_order: 0,
        });
      }

      setPendingUpload(null);
    } catch (err) {
      console.warn('사진 적용 실패:', err);
    } finally {
      setApplying(false);
    }
  };

  const monthlyDistance = getMonthlyDistance(activities, year, month);
  const totalDuration = monthlyActivities.reduce((s, a) => s + (a.duration_seconds || 0), 0);
  const runDays = new Set(monthlyActivities.map(a => a.activity_date)).size;

  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  // 이전달 말일 옅게 표시 (피드백 — 첫 주 빈 칸 어색함 제거)
  const prevMonthLastDay = new Date(year, month - 1, 0).getDate();
  const prevMonthFillDays = Array.from({ length: firstDay }, (_, i) => prevMonthLastDay - firstDay + i + 1);

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  };

  return (
    <div className="p-4 max-w-lg mx-auto space-y-4 pb-8">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {uploading && (
        <div className="card p-3 text-center">
          <div className="animate-spin w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full mx-auto" />
          <p className="text-xs text-[var(--muted)] mt-1">사진 업로드 중...</p>
        </div>
      )}

      {/* 월 선택 */}
      <div className="flex items-center justify-between">
        <button onClick={prevMonth} className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-[var(--card-border)] transition-colors">
          <ChevronLeft size={20} />
        </button>
        <span className="text-2xl font-bold text-[var(--foreground)]">{year}년 {month}월</span>
        <button onClick={nextMonth} className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-[var(--card-border)] transition-colors">
          <ChevronRight size={20} />
        </button>
      </div>

      {/* 월간 요약 */}
      <div className="card p-4">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-2xl font-bold text-emerald-600">{monthlyDistance.toFixed(1)}</p>
            <p className="text-xs text-[var(--muted)]">km</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-[var(--foreground)]">{runDays}</p>
            <p className="text-xs text-[var(--muted)]">러닝 일수</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-[var(--foreground)]">{totalDuration > 0 ? formatDuration(totalDuration) : '-'}</p>
            <p className="text-xs text-[var(--muted)]">시간</p>
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="grid grid-cols-7 gap-1 text-center text-sm mb-2">
          {['일','월','화','수','목','금','토'].map((d, i) => (
            <span key={d} className={`py-1 font-semibold ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-[var(--muted)]'}`}>{d}</span>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {/* 이전달 말일 — 옅게 표시 (첫 주 빈칸 어색함 제거) */}
          {prevMonthFillDays.map((d) => (
            <div
              key={`prev-${d}`}
              className="aspect-square rounded-lg flex items-center justify-center bg-gray-50 dark:bg-zinc-900/40 opacity-40"
            >
              <span className="text-xs text-[var(--muted)]">{d}</span>
            </div>
          ))}

          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const km = dateDistanceMap.get(dateStr) || 0;
            const photoUrl = customPhotos.get(dateStr) || photos.get(dateStr);
            const hasPhoto = !!photoUrl;
            const bgColor = distanceColor(km, dateStr);
            const textColor = distanceTextColor(km);

            const cell = (
              <div
                className={`aspect-square rounded-lg relative overflow-hidden flex flex-col items-center justify-center ${
                  hasPhoto ? '' : bgColor
                } ${km > 0 ? 'ring-1 ring-green-300/50' : ''}`}
              >
                {hasPhoto && (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photoUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                  </>
                )}

                <span className={`text-sm font-semibold relative z-10 ${hasPhoto ? 'text-white drop-shadow' : textColor}`}>
                  {day}
                </span>

                {km > 0 && (
                  <span className={`text-[11px] font-medium relative z-10 ${hasPhoto ? 'text-white/90 drop-shadow' : 'text-[var(--muted)]'}`}>
                    {km.toFixed(1)}
                  </span>
                )}

                {/* 사진 추가 아이콘 (활동이 있는 날만) */}
                {km > 0 && !hasPhoto && (
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handlePhotoSelect(dateStr); }}
                    className="absolute bottom-0.5 right-0.5 w-5 h-5 rounded-full bg-white/80 flex items-center justify-center z-20 shadow-sm"
                    aria-label="사진 추가"
                  >
                    <Camera size={9} className="text-gray-700" />
                  </button>
                )}
              </div>
            );

            if (km > 0) {
              return (
                <div key={day} onClick={() => setShowDetail(dateStr)} className="cursor-pointer active:scale-95 transition-transform">
                  {cell}
                </div>
              );
            }
            return <div key={day}>{cell}</div>;
          })}
        </div>

        {/* 범례 */}
        <div className="flex items-center gap-1.5 mt-4 justify-center text-xs text-[var(--muted)]">
          <span>0</span>
          <span className="w-4 h-4 rounded-sm bg-gray-100 dark:bg-zinc-800/50" />
          <span className="w-4 h-4 rounded-sm bg-green-200 dark:bg-green-900/40" />
          <span className="w-4 h-4 rounded-sm bg-green-400 dark:bg-green-700/60" />
          <span className="w-4 h-4 rounded-sm bg-green-500 dark:bg-green-600/70" />
          <span className="w-4 h-4 rounded-sm bg-green-600 dark:bg-green-500/80" />
          <span>10+</span>
        </div>
      </div>

      {/* 이달 활동 리스트 */}
      {!loading && monthlyActivities.length > 0 && (
        <div className="card p-5">
          <h3 className="text-base font-bold text-[var(--foreground)] mb-3">이달의 러닝</h3>
          <div className="space-y-2">
            {monthlyActivities.map(a => (
              <Link
                key={a.id}
                href={`/activity?id=${a.id}`}
                className="flex items-center justify-between p-2.5 rounded-xl hover:bg-[var(--card-border)]/50 transition-colors"
              >
                <div>
                  <p className="text-sm font-semibold text-[var(--foreground)]">{a.distance_km.toFixed(2)} km</p>
                  <p className="text-xs text-[var(--muted)]">
                    {new Date(a.activity_date).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short' })}
                    {a.duration_seconds && ` · ${formatDuration(a.duration_seconds)}`}
                  </p>
                </div>
                <ChevronRight size={14} className="text-[var(--muted)]" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* 날짜 상세 모달 — 액션 중심 디자인 (피드백 #2: 바로 액션) */}
      {showDetail && (() => {
        const dayActivities = monthlyActivities.filter(a => a.activity_date === showDetail);
        const dayKm = dayActivities.reduce((s, a) => s + Number(a.distance_km), 0);
        const dayDuration = dayActivities.reduce((s, a) => s + (a.duration_seconds || 0), 0);
        const dayPhoto = customPhotos.get(showDetail) || photos.get(showDetail);
        const dateObj = new Date(showDetail + 'T00:00:00');
        const dateLabel = dateObj.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });

        return (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowDetail(null)}>
            <div className="w-full max-w-lg bg-[var(--card-bg)] rounded-t-3xl p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] space-y-4 animate-slide-up" onClick={e => e.stopPropagation()}>
              <div className="w-10 h-1 rounded-full bg-[var(--card-border)] mx-auto" />
              <h3 className="text-lg font-bold text-[var(--foreground)] text-center">{dateLabel}</h3>

              {dayPhoto && (
                <div className="rounded-2xl overflow-hidden h-44 relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={dayPhoto} alt="" className="w-full h-full object-cover" />
                </div>
              )}

              {dayActivities.length > 0 ? (
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 p-3">
                    <p className="text-2xl font-extrabold text-emerald-600">{dayKm.toFixed(1)}</p>
                    <p className="text-xs text-[var(--muted)]">km</p>
                  </div>
                  <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 p-3">
                    <p className="text-2xl font-extrabold text-emerald-700">{dayActivities.length}</p>
                    <p className="text-xs text-[var(--muted)]">러닝</p>
                  </div>
                  <div className="rounded-xl bg-lime-50 dark:bg-lime-950/30 p-3">
                    <p className="text-2xl font-extrabold text-lime-700 dark:text-lime-500">{dayDuration > 0 ? formatDuration(dayDuration) : '-'}</p>
                    <p className="text-xs text-[var(--muted)]">시간</p>
                  </div>
                </div>
              ) : (
                <p className="text-center text-sm text-[var(--muted)]">이 날은 러닝 기록이 없습니다</p>
              )}

              {dayActivities.map(a => (
                <Link
                  key={a.id}
                  href={`/activity?id=${a.id}`}
                  className="flex items-center justify-between p-3 rounded-xl bg-[var(--card-border)]/30 hover:bg-[var(--card-border)]/50"
                  onClick={() => setShowDetail(null)}
                >
                  <div>
                    <p className="text-sm font-semibold text-[var(--foreground)]">{a.distance_km.toFixed(2)} km</p>
                    <p className="text-xs text-[var(--muted)]">{a.duration_seconds ? formatDuration(a.duration_seconds) : ''}</p>
                  </div>
                  <ChevronRight size={14} className="text-[var(--muted)]" />
                </Link>
              ))}

              {/* 통합된 액션: 사진으로 꾸미기 (ShareCard) + 사진 배경 업로드 */}
              <div className="flex gap-2">
                {dayActivities.length > 0 && (
                  <button
                    onClick={() => { setShareActivityId(dayActivities[0].id); setShowDetail(null); }}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-semibold text-sm shadow-md"
                  >
                    <Share2 size={16} />
                    공유 카드
                  </button>
                )}
                <button
                  onClick={() => { handlePhotoSelect(showDetail); setShowDetail(null); }}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-white dark:bg-zinc-900 border border-[var(--card-border)] text-[var(--foreground)] font-semibold text-sm"
                >
                  <Camera size={16} />
                  {dayPhoto ? '사진 변경' : '사진 넣기'}
                </button>
              </div>

              <button
                onClick={() => setShowDetail(null)}
                className="w-full py-2.5 rounded-xl text-sm text-[var(--muted)] font-medium"
              >
                닫기
              </button>
            </div>
          </div>
        );
      })()}

      {/* 업로드 후 옵션 모달 — 캘린더 배경 + 러닝사진 등록 체크박스 통합 */}
      {pendingUpload && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-[var(--card-bg)] rounded-t-3xl p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] space-y-4 animate-slide-up">
            <div className="w-10 h-1 rounded-full bg-[var(--card-border)] mx-auto" />
            <div className="text-center space-y-1">
              <div className="inline-flex w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 items-center justify-center shadow-md">
                <Sparkles size={24} className="text-white" />
              </div>
              <h3 className="text-xl font-bold text-[var(--foreground)]">사진을 어떻게 사용할까요?</h3>
              <p className="text-sm text-[var(--muted)]">원하는 옵션을 선택하세요</p>
            </div>

            {/* 사진 미리보기 */}
            <div className="rounded-2xl overflow-hidden h-32">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pendingUpload.photoUrl} alt="" className="w-full h-full object-cover" />
            </div>

            {/* 체크박스 1: 캘린더 배경 */}
            <label className="flex items-start gap-3 p-4 rounded-2xl bg-emerald-50 cursor-pointer active:scale-[0.99] transition">
              <input
                type="checkbox"
                checked={pendingUpload.applyToCalendar}
                onChange={e => setPendingUpload(p => p ? { ...p, applyToCalendar: e.target.checked } : p)}
                className="mt-0.5 w-5 h-5 rounded accent-emerald-500"
              />
              <div className="flex-1">
                <p className="text-base font-bold text-[var(--foreground)]">📅 내 캘린더 배경에 반영</p>
                <p className="text-sm text-[var(--muted)] mt-0.5">이 날짜 셀의 배경으로 표시됩니다</p>
              </div>
            </label>

            {/* 체크박스 2: 러닝사진 등록 (러닝 있는 날만 활성) */}
            <label className={`flex items-start gap-3 p-4 rounded-2xl bg-emerald-50 cursor-pointer active:scale-[0.99] transition ${!pendingUpload.activityId ? 'opacity-50 cursor-not-allowed' : ''}`}>
              <input
                type="checkbox"
                checked={pendingUpload.shareToRoutinePhotos}
                disabled={!pendingUpload.activityId}
                onChange={e => setPendingUpload(p => p ? { ...p, shareToRoutinePhotos: e.target.checked } : p)}
                className="mt-0.5 w-5 h-5 rounded accent-emerald-500"
              />
              <div className="flex-1">
                <p className="text-base font-bold text-[var(--foreground)]">📸 러닝사진에 등록하기</p>
                <p className="text-sm text-[var(--muted)] mt-0.5">
                  {pendingUpload.activityId
                    ? '다른 러너들과 공유되고 좋아요 받을 수 있어요'
                    : '러닝 기록이 있는 날만 공유할 수 있어요'}
                </p>
              </div>
            </label>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setPendingUpload(null)}
                disabled={applying}
                className="flex-1 py-3 rounded-xl text-[var(--muted)] font-medium text-sm"
              >
                취소
              </button>
              <button
                onClick={applyPendingUpload}
                disabled={applying || (!pendingUpload.applyToCalendar && !pendingUpload.shareToRoutinePhotos)}
                className="flex-1 py-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-bold text-base shadow-md disabled:opacity-50"
              >
                {applying ? '적용 중...' : '확인'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ShareCard */}
      {shareActivityId && (() => {
        const shareAct = activities.find(a => a.id === shareActivityId);
        if (!shareAct) return null;
        return (
          <ShareCard
            activity={shareAct}
            displayName={user?.user_metadata?.name || '러너'}
            onClose={() => setShareActivityId(null)}
          />
        );
      })()}
    </div>
  );
}
