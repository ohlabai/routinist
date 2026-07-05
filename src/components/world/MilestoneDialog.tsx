'use client';

// build 229: 마일스톤 unlock 다이얼로그 — Street View + 폴라로이드 풍 디지털 엽서 + Fun fact.
// 카드 탭 시 모달 슬라이드 업. 공유 버튼은 native share sheet (Capacitor Share) 활용.

import { X, Share2, MapPin, Sparkles } from 'lucide-react';
import type { VirtualCourse } from '@/lib/world-data';
import type { Milestone } from '@/lib/world-milestones';
import { API_KEY as MAPS_KEY } from '@/lib/google-maps';
import { useI18n } from '@/lib/i18n';
import { useState } from 'react';

interface Props {
  milestone: Milestone;
  course: VirtualCourse;
  userName?: string;
  onClose: () => void;
}

// Google Maps Street View Static API 이미지 URL.
// fov 80 = 자연스러운 거리뷰. pitch 0 = 수평. heading 산정은 path 의 진행 방향이 이상적이지만
// 일단 기본 (북향) 으로 시작 → 사용자 피드백 후 path-direction 보정 가능.
function streetViewUrl(lat: number, lng: number): string {
  if (!MAPS_KEY) return '';
  const params = new URLSearchParams({
    location: `${lat},${lng}`,
    size: '640x400',
    fov: '80',
    pitch: '0',
    source: 'outdoor',
    key: MAPS_KEY,
  });
  return `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`;
}

// Static Map URL — Street View 가 없는 위치 (오지·실내) 또는 lat/lng 없는 경우 폴백.
function staticMapUrl(lat: number, lng: number): string {
  if (!MAPS_KEY) return '';
  const params = new URLSearchParams({
    center: `${lat},${lng}`,
    zoom: '15',
    size: '640x400',
    maptype: 'roadmap',
    markers: `color:red|${lat},${lng}`,
    key: MAPS_KEY,
  });
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}

export default function MilestoneDialog({ milestone, course, userName, onClose }: Props) {
  const { tt, locale } = useI18n();
  const hasLatLng = milestone.lat != null && milestone.lng != null;
  const sv = hasLatLng ? streetViewUrl(milestone.lat!, milestone.lng!) : '';
  const map = hasLatLng ? staticMapUrl(milestone.lat!, milestone.lng!) : '';
  const [svError, setSvError] = useState(false);
  const today = new Date().toLocaleDateString(locale === 'en' ? 'en-US' : 'ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  // lib 생성 라벨: 고정 라벨은 tt 매핑, '완주! 32.0 km' 류 동적 라벨은 고정부만 치환.
  const labelText = milestone.label.startsWith('완주! ')
    ? `${tt('완주!')} ${milestone.label.slice(4)}`
    : tt(milestone.label);

  const handleShare = async () => {
    const text = `🏃 ${course.name} · ${labelText}\n${userName ?? tt('러너')} · ${today}\n${tt('#월드런챌린지 #루티니스트')}`;
    try {
      const { Share } = await import('@capacitor/share');
      await Share.share({
        title: `${course.name} · ${tt(milestone.name)}`,
        text,
        dialogTitle: tt('엽서 공유'),
      });
    } catch {
      // 웹/미지원 환경: clipboard fallback
      try {
        await navigator.clipboard?.writeText(text);
      } catch { /* ignore */ }
    }
  };

  return (
    <div className="fixed inset-0 z-[110] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-3" onClick={onClose}>
      <div
        className="w-full sm:max-w-md bg-[var(--background)] rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="px-5 pt-4 pb-3 border-b border-[var(--card-border)]/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl leading-none">{milestone.emoji}</span>
            <div>
              <p className="text-base font-extrabold tracking-tight">{labelText}</p>
              <p className="text-[11px] text-[var(--muted)] truncate">{course.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[var(--card-border)]/40 active:scale-90">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {/* 폴라로이드 엽서 — DOM 디자인. 흰 테두리 + 아래 여백 + 살짝 기울임 + 그림자 */}
          <div className="flex justify-center pt-2 pb-3">
            <div
              className="bg-white dark:bg-zinc-100 p-2 pb-12 shadow-2xl rounded-[3px] relative"
              style={{ transform: 'rotate(-1.8deg)', maxWidth: 280 }}
            >
              {/* 이미지 (Street View 우선, 실패 시 Static Map, 둘 다 없으면 hero) */}
              <div className="relative w-64 h-44 bg-zinc-200 overflow-hidden">
                {hasLatLng && !svError && sv ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={sv}
                    alt={milestone.name}
                    className="w-full h-full object-cover"
                    onError={() => setSvError(true)}
                  />
                ) : hasLatLng && map ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={map} alt={milestone.name} className="w-full h-full object-cover" />
                ) : course.hero_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={course.hero_image_url} alt={milestone.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-400">
                    <MapPin size={40} />
                  </div>
                )}
                {/* 코스명 sticker */}
                <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-white/85 backdrop-blur text-[10px] font-extrabold text-zinc-800">
                  {course.country ?? '🌍'} {course.name}
                </div>
              </div>
              {/* 손글씨 영역 */}
              <div className="px-1 pt-3 text-center">
                <p
                  className="text-zinc-900 leading-tight"
                  style={{ fontFamily: '"Brush Script MT", "Apple Chancery", "Snell Roundhand", cursive', fontSize: 22 }}
                >
                  {milestone.name === '완주' || milestone.kind === 'finish' ? tt('완주!') : tt(milestone.name)}
                </p>
                <p className="text-[10px] text-zinc-600 mt-1 font-bold tracking-wide tabular-nums">
                  {userName ?? tt('러너')} · {today}
                </p>
              </div>
              {/* 폴라로이드 핀 (귀여운 디테일) */}
              <span className="absolute -top-2 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-rose-400/80 shadow" aria-hidden />
            </div>
          </div>

          {/* Fun fact / 안내 */}
          {milestone.funFact && (
            <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-emerald-50/30 dark:from-emerald-950/30 dark:to-emerald-950/10 border border-emerald-200/60 dark:border-emerald-800/40 p-4">
              <p className="inline-flex items-center gap-1 text-[10px] font-extrabold text-emerald-700 dark:text-emerald-300 uppercase tracking-widest mb-1.5">
                <Sparkles size={11} /> Fun Fact
              </p>
              <p className="text-sm text-[var(--foreground)] leading-relaxed break-keep">{milestone.funFact}</p>
            </div>
          )}

          {!hasLatLng && (
            <p className="text-[11px] text-[var(--muted)] text-center">{tt('이 코스는 GPS 좌표가 등록되지 않아 거리뷰를 표시할 수 없어요.')}</p>
          )}
        </div>

        {/* CTA */}
        <div className="px-5 pt-3 pb-6 border-t border-[var(--card-border)]/40">
          <button
            onClick={handleShare}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-sm active:scale-[0.98] shadow-md shadow-emerald-500/30 inline-flex items-center justify-center gap-1.5"
          >
            <Share2 size={16} /> {tt('엽서 공유하기')}
          </button>
        </div>
      </div>
    </div>
  );
}
