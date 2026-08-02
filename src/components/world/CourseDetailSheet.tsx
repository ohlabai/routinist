'use client';

// 월드런 코스 상세 sheet (build 112 Phase A).
// 라이브 트래커 (참가자 마커) + 디지털 인증서 PDF + 메달 신청 폼.

import { useEffect, useState, useCallback, useRef } from 'react';
import { X, Trophy, Users, Award, MapPin, Download, Truck, Globe, Crown, Sparkles, BookOpen, Mountain, ExternalLink, Play, Flag as FlagIcon, ChevronDown, Info } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { loadGoogleMaps, API_KEY } from '@/lib/google-maps';
import type { RealLatLng } from '@/lib/world-data';
import {
  fetchCourseById,
  fetchCourseRunners,
  fetchMyMedalStatus,
  requestCourseMedal,
  type VirtualCourse,
  type CourseRunner,
  type MedalStatus,
  type MedalShippingForm,
  type PreviewPoint,
} from '@/lib/world-data';
import AppToast from '@/components/AppToast';
import MilestoneBoard from './MilestoneBoard';
import { useI18n, ttl, getCurrentLocale } from '@/lib/i18n';
import { nextGenericMilestone } from '@/lib/world-milestones';

interface Props {
  courseId: string;
  onClose: () => void;
  // build 164 #3: 미참가 사용자가 sheet 에서 바로 결제 시작할 수 있는 sticky CTA.
  onStartCourse?: (course: VirtualCourse) => void;
}

const MEDAL_PRICE = 30000;

export default function CourseDetailSheet({ courseId, onClose, onStartCourse }: Props) {
  const { tt, locale } = useI18n();
  const { user, profile } = useAuth();
  const [course, setCourse] = useState<VirtualCourse | null>(null);
  const certBusyRef = useRef(false);
  const [runners, setRunners] = useState<CourseRunner[]>([]);
  const [medal, setMedal] = useState<MedalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [medalFormOpen, setMedalFormOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  // build 226 #7: 대회 소개 / 코스 이야기 카드 collapse — 사용자 피드백 (별로 중요하지 않으니 필요할 때만 펼침).
  const [descOpen, setDescOpen] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);
  // build 229.B: 사용자 모티프 텍스트 (왜 달리는가).
  const [motivation, setMotivation] = useState<string | null>(null);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2200);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const [c, rs, m] = await Promise.all([
      fetchCourseById(courseId).catch(() => null),
      fetchCourseRunners(courseId).catch(() => [] as CourseRunner[]),
      user ? fetchMyMedalStatus(courseId).catch(() => null) : Promise.resolve(null),
    ]);
    setCourse(c);
    setRunners(rs);
    setMedal(m);
    // build 229.B: motivation_text fetch (RLS 가 본인 row 만 노출).
    if (user) {
      try {
        const supabase = (await import('@/lib/supabase')).getSupabase();
        const { data } = await supabase
          .from('user_course_progress')
          .select('motivation_text')
          .eq('user_id', user.id)
          .eq('course_id', courseId)
          .maybeSingle();
        setMotivation((data?.motivation_text as string | undefined) ?? null);
      } catch {
        setMotivation(null);
      }
    }
    setLoading(false);
  }, [courseId, user]);

  useEffect(() => { load(); }, [load]);

  const myRunner = runners.find(r => r.user_id === user?.id);
  // build 233: completed_at 가 NULL 인데 progress 가 distance 이상이면 UI 상 완주로 표시.
  // DB trigger (auto_mark_course_complete) 가 적용 전 사용자에게도 정상 표시 보장.
  const completed = !!myRunner && (
    !!myRunner.completed_at ||
    (myRunner.ratio >= 0.999) ||
    (course && course.distance_km > 0 && myRunner.progress_km >= course.distance_km)
  );

  // build 228 → 2026-07-15 리뷰 fix: 하드코딩 5~40km 시퀀스가 장거리 코스 (633km 등) 에서
  // 40km 이후 "완주까지 588km" 로 붕괴 — MilestoneBoard/ProgressCard 와 같은
  // nextGenericMilestone (장거리는 25km 간격) 을 재사용해 일관화.
  const nextMilestone = (() => {
    if (!course || !myRunner || completed) return null;
    const next = nextGenericMilestone(course.distance_km, myRunner.progress_km);
    if (!next) return null;
    const label = next.name === '하프' ? '하프 마라톤' : next.name === '완주' ? '완주' : next.name;
    return { km: next.km, label, remaining: Math.max(0, next.km - myRunner.progress_km) };
  })();

  return (
    <div className="fixed inset-0 z-[70] bg-black/65 flex items-end sm:items-center justify-center sm:p-3" onClick={onClose}>
      <div
        className="w-full sm:max-w-lg bg-[var(--background)] rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="sticky top-0 z-10 px-5 pt-4 pb-3 bg-[var(--background)] border-b border-emerald-100 dark:border-emerald-950/40 rounded-t-3xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-100 to-teal-50 dark:from-emerald-900/40 dark:to-teal-950/40 flex items-center justify-center flex-shrink-0">
                <Globe size={20} className="text-emerald-600" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-extrabold tracking-tight truncate">{course ? tt(course.name) : tt('코스')}</h3>
                <p className="text-[13px] text-[var(--muted)] truncate">
                  {course?.country ?? ''} {course && `· ${course.distance_km.toFixed(1)}km`}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-[var(--card-border)]/40 active:scale-90 flex-shrink-0">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loading ? (
            <div className="space-y-3">
              <div className="h-48 bg-[var(--card-border)]/30 animate-pulse rounded-2xl" />
              <div className="h-24 bg-[var(--card-border)]/30 animate-pulse rounded-2xl" />
            </div>
          ) : !course ? (
            <p className="text-center text-sm text-[var(--muted)] py-12">{tt('코스를 찾을 수 없어요')}</p>
          ) : (
            <>
              {/* build 157: hero 이미지 — 코스를 시각적으로 첫 인상 (Conqueror 앱 패턴) */}
              {course.hero_image_url && (
                <div className="relative w-full h-48 -mt-1 rounded-2xl overflow-hidden shadow-md">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={course.hero_image_url} alt={course.name} className="w-full h-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/65 via-black/30 to-transparent" />
                  <div className="absolute left-4 right-4 bottom-3 flex items-end justify-between">
                    <div>
                      <p className="text-white text-xl font-extrabold drop-shadow-lg leading-tight">{tt(course.name)}</p>
                      <p className="text-white/90 text-xs font-bold mt-0.5">
                        {course.distance_km.toFixed(1)}km · {course.country ? tt(course.country) : ''}
                      </p>
                    </div>
                    {runners.length > 0 && (
                      <div className="flex items-center gap-1">
                        <div className="flex -space-x-2">
                          {runners.slice(0, 4).map((r, i) => (
                            <div key={r.user_id + i} className="w-7 h-7 rounded-full border-2 border-white bg-zinc-300 overflow-hidden">
                              {r.avatar_url
                                ? // eslint-disable-next-line @next/next/no-img-element
                                  <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
                                : <div className="w-full h-full flex items-center justify-center text-[12px] font-bold text-zinc-600">{r.display_name?.[0] ?? tt('러')}</div>
                              }
                            </div>
                          ))}
                        </div>
                        {runners.length > 4 && (
                          <span className="text-white/90 text-xs font-bold drop-shadow ml-0.5">+{runners.length - 4}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 큰 지도 + 라이브 트래커 — real_path 있으면 Google Maps, 없으면 SVG fallback */}
              {course.real_path && course.real_path.length >= 2 ? (
                <GoogleLiveTracker
                  realPath={course.real_path}
                  runners={runners}
                  myUserId={user?.id ?? null}
                />
              ) : (
                <LiveTrackerMap
                  path={course.preview_path}
                  runners={runners}
                  myUserId={user?.id ?? null}
                />
              )}

              {/* 참가비 + 한줄 설명 */}
              <div className="rounded-2xl bg-gradient-to-br from-amber-50/60 to-orange-50/30 dark:from-amber-950/30 dark:to-amber-950/10 border border-amber-200/60 dark:border-amber-800/40 p-3 flex items-center justify-between">
                <span className="text-xs font-bold text-amber-700 dark:text-amber-300">{tt('참가비')}</span>
                <span className="text-base font-extrabold text-amber-700 dark:text-amber-300">{course.entry_fee_p.toLocaleString()}{tt(' 마일리지')}</span>
              </div>

              {/* build 228 #1: 내 진행 카드 — 큰 hero 거리 + 큰 progress bar + 다음 마일스톤 카운트다운.
                  완주 시 메달 신청 카드가 별도로 아래에 따라옴. */}
              {myRunner && (
                <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-emerald-50/30 dark:from-emerald-950/40 dark:to-emerald-950/15 border-2 border-emerald-300/60 dark:border-emerald-800/40 p-5 shadow-md shadow-emerald-500/10">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-extrabold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1.5">
                      <Trophy size={13} /> {tt('내 진행')}
                    </p>
                    <span className="text-xs font-extrabold text-emerald-600 tabular-nums">
                      {Math.min(100, Math.round(myRunner.ratio * 100))}%
                    </span>
                  </div>
                  <p className="text-4xl font-extrabold tabular-nums leading-none">
                    {myRunner.progress_km.toFixed(1)}
                    <span className="text-lg font-bold text-[var(--muted)] ml-1">/ {course.distance_km.toFixed(1)}km</span>
                  </p>
                  <div className="mt-3 h-3 rounded-full bg-white/70 dark:bg-zinc-900/70 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-emerald-500 to-emerald-600 transition-all duration-500"
                      style={{ width: `${Math.min(100, myRunner.ratio * 100)}%` }}
                    />
                  </div>
                  {completed ? (
                    <p className="mt-3 text-sm font-extrabold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1.5">
                      <Trophy size={15} /> {tt('완주!')}{myRunner.completed_at && ` ${new Date(myRunner.completed_at).toLocaleDateString(locale === 'en' ? 'en-US' : 'ko-KR')}`}
                    </p>
                  ) : nextMilestone ? (
                    <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500 text-white text-xs font-extrabold">
                      <FlagIcon size={12} /> {locale === 'en' ? `${nextMilestone.remaining.toFixed(1)}km to ${tt(nextMilestone.label)}` : `${nextMilestone.label}까지 ${nextMilestone.remaining.toFixed(1)}km`}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-[var(--muted)]">{tt('남은 거리 ')}{Math.max(0, course.distance_km - myRunner.progress_km).toFixed(1)}km</p>
                  )}
                </div>
              )}

              {/* build 229.B: "왜 달리는가" 모티프 카드 — 도전 시작 시 입력한 문장 회상.
                  완주 시는 더 큰 emotional 톤. */}
              {myRunner && motivation && (
                <div className={`rounded-2xl p-4 border ${
                  completed
                    ? 'bg-gradient-to-br from-amber-50 to-orange-50/40 dark:from-amber-950/30 dark:to-amber-950/10 border-amber-300/60 dark:border-amber-800/40'
                    : 'bg-gradient-to-br from-emerald-50/60 to-transparent dark:from-emerald-950/15 border-emerald-200/40 dark:border-emerald-900/30'
                }`}>
                  <p className="text-[12px] font-extrabold uppercase tracking-widest mb-1.5 inline-flex items-center gap-1
                                 text-emerald-700 dark:text-emerald-300">
                    💭 {completed ? tt('시작했을 때 마음') : tt('왜 달리고 있나요')}
                  </p>
                  <p className={`leading-relaxed break-keep ${completed ? 'text-base font-extrabold' : 'text-sm'}`}>
                    &quot;{motivation}&quot;
                  </p>
                  {completed && (
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-300 font-bold">
                      {tt('해냈어요. 그 마음을 끝까지 지켰네요 🌟')}
                    </p>
                  )}
                </div>
              )}

              {/* build 229: 마일스톤 보드 — Conqueror 패턴. 5/10/하프/풀 + landmarks 통합. */}
              {myRunner && (
                <MilestoneBoard
                  course={course}
                  myProgressKm={myRunner.progress_km}
                  userName={profile?.display_name ?? undefined}
                />
              )}

              {/* build 228 #2: 같은 코스 도전 중 — 막대 그래프로 한눈에 비교. 1위 왕관 + 본인 emerald 강조 */}
              <div>
                <h4 className="text-sm font-extrabold mb-2.5 inline-flex items-center gap-1.5">
                  <Users size={14} className="text-emerald-500" /> {tt('같은 코스 도전 중')} · {locale === 'en' ? runners.length : `${runners.length}명`}
                </h4>
                {runners.length === 0 ? (
                  <div className="rounded-2xl bg-[var(--card)] border border-[var(--card-border)] p-4 text-center">
                    <p className="text-xs text-[var(--muted)] italic">{tt('아직 도전 중인 사람이 없어요. 첫 번째가 되어보세요.')}</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {(() => {
                      const maxKm = Math.max(...runners.map(r => r.progress_km), course.distance_km * 0.1);
                      return runners.slice(0, 10).map((r, i) => {
                        const isMe = r.user_id === user?.id;
                        const pct = Math.round(r.ratio * 100);
                        const barPct = Math.min(100, (r.progress_km / maxKm) * 100);
                        return (
                          <div key={r.user_id} className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl ${
                            isMe
                              ? 'bg-gradient-to-r from-amber-50 to-amber-50/40 dark:from-amber-950/30 dark:to-amber-950/15 border border-amber-300/60 dark:border-amber-800/40'
                              : 'bg-[var(--card)] border border-[var(--card-border)]/40'
                          }`}>
                            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[13px] font-extrabold flex-shrink-0 ${
                              i === 0 ? 'bg-amber-100 text-amber-700' :
                              i === 1 ? 'bg-zinc-200 text-zinc-700' :
                              i === 2 ? 'bg-orange-100 text-orange-700' :
                              'bg-[var(--card-border)]/40 text-[var(--muted)]'
                            }`}>
                              {i === 0 ? <Crown size={11} className="text-amber-600" /> : i + 1}
                            </span>
                            <div className="w-7 h-7 rounded-full bg-[var(--card-border)]/40 overflow-hidden flex-shrink-0">
                              {r.avatar_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-[13px] font-bold text-[var(--muted)]">
                                  {r.display_name.slice(0, 1)}
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline justify-between gap-2">
                                <span className={`text-sm truncate ${isMe ? 'font-extrabold text-amber-700 dark:text-amber-300' : 'font-bold'}`}>
                                  {r.display_name}{isMe && <span className="ml-1 text-[12px] font-bold">{tt('(나)')}</span>}
                                  {r.completed_at && <Trophy size={11} className="inline ml-1 text-emerald-600" />}
                                </span>
                                <span className="text-[13px] font-extrabold text-[var(--muted)] tabular-nums flex-shrink-0">
                                  {r.progress_km.toFixed(1)}km · {pct}%
                                </span>
                              </div>
                              <div className="mt-1 h-1.5 rounded-full bg-[var(--card-border)]/40 overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    isMe ? 'bg-gradient-to-r from-amber-400 to-amber-500' : 'bg-emerald-400/70'
                                  }`}
                                  style={{ width: `${barPct}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}
              </div>

              {/* 코스 설명 (collapse) — build 226 #7 */}
              {course.description && (
                <div className="rounded-2xl bg-[var(--card)] border border-[var(--card-border)] overflow-hidden">
                  <button
                    onClick={() => setDescOpen(o => !o)}
                    className="w-full px-4 py-3 flex items-center justify-between text-left active:bg-[var(--card-border)]/30 transition"
                  >
                    <span className="text-sm font-extrabold text-[var(--foreground)] inline-flex items-center gap-1.5">
                      <Info size={14} className="text-emerald-600" /> {tt('대회 소개')}
                    </span>
                    <ChevronDown size={16} className={`text-[var(--muted)] transition-transform ${descOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {descOpen && (
                    <div className="px-4 pb-4">
                      <p className="text-[14px] text-[var(--foreground)] leading-relaxed break-keep">{tt(course.description)}</p>
                    </div>
                  )}
                </div>
              )}

              {/* 스토리텔링 (build 123 — The Conqueror 풍) — collapse build 226 #7 */}
              {course.story && (
                <div className="rounded-2xl bg-[var(--card)] border border-[var(--card-border)] overflow-hidden">
                  <button
                    onClick={() => setStoryOpen(o => !o)}
                    className="w-full px-4 py-3 flex items-center justify-between text-left active:bg-[var(--card-border)]/30 transition"
                  >
                    <span className="text-sm font-extrabold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1.5">
                      <BookOpen size={14} /> {tt('코스 이야기')}
                    </span>
                    <ChevronDown size={16} className={`text-[var(--muted)] transition-transform ${storyOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {storyOpen && (
                    <div className="px-4 pb-4">
                      <p className="text-[14px] text-[var(--foreground)] leading-relaxed break-keep whitespace-pre-wrap">{tt(course.story)}</p>
                      {course.official_url && (
                        <a
                          href={course.official_url}
                          target="_blank"
                          rel="noopener"
                          className="mt-2.5 inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 active:scale-95"
                        >
                          {tt('공식 사이트')} <ExternalLink size={10} />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 유튜브 영상 임베드 */}
              {course.youtube_url && (
                <a
                  href={course.youtube_url}
                  target="_blank"
                  rel="noopener"
                  className="block rounded-2xl bg-gradient-to-br from-rose-500/95 to-rose-600 p-4 shadow-md active:scale-[0.98]"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur flex items-center justify-center flex-shrink-0">
                      <Play size={22} className="text-white ml-0.5" fill="white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-extrabold text-white">{tt('대회 영상 보기')}</p>
                      <p className="text-[13px] text-white/85 mt-0.5">{tt('YouTube 에서 코스 미리보기')}</p>
                    </div>
                    <ExternalLink size={16} className="text-white/85" />
                  </div>
                </a>
              )}

              {/* 고도 프로파일 */}
              {course.elevation_profile && course.elevation_profile.length > 0 && (
                <div className="rounded-2xl bg-[var(--card)] border border-[var(--card-border)] p-4">
                  <p className="text-xs font-extrabold text-[var(--muted)] inline-flex items-center gap-1 mb-2">
                    <Mountain size={12} className="text-emerald-500" /> {tt('고도 프로파일')}
                  </p>
                  <ElevationChart points={course.elevation_profile} />
                </div>
              )}

              {/* 주요 지점 (랜드마크) */}
              {course.landmarks && course.landmarks.length > 0 && (
                <div className="rounded-2xl bg-[var(--card)] border border-[var(--card-border)] p-4">
                  <p className="text-xs font-extrabold text-[var(--muted)] inline-flex items-center gap-1 mb-2">
                    <FlagIcon size={12} className="text-emerald-500" /> {tt('코스 주요 지점')}
                  </p>
                  <div className="space-y-2">
                    {course.landmarks.map((l, i) => (
                      <div key={i} className="flex items-start gap-2.5 px-2 py-1.5">
                        <span className="text-[13px] font-extrabold text-emerald-600 tabular-nums w-12 flex-shrink-0">
                          {l.km.toFixed(1)}km
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold">{tt(l.name)}</p>
                          {l.description && <p className="text-[13px] text-[var(--muted)] mt-0.5 leading-snug">{tt(l.description)}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 역대 우승자 */}
              {course.past_winners && course.past_winners.length > 0 && (
                <div className="rounded-2xl bg-[var(--card)] border border-[var(--card-border)] p-4">
                  <p className="text-xs font-extrabold text-[var(--muted)] inline-flex items-center gap-1 mb-2">
                    <Crown size={12} className="text-amber-500" /> {tt('역대 우승자')}
                  </p>
                  <div className="space-y-1.5">
                    {course.past_winners.map((w, i) => (
                      <div key={i} className="flex items-center gap-2 px-2 py-1.5">
                        <span className="text-xs font-bold text-amber-600 tabular-nums w-10 flex-shrink-0">{w.year}</span>
                        <span className="text-sm font-bold flex-1 truncate">{w.name}</span>
                        <span className="text-sm font-extrabold text-emerald-600 tabular-nums">{w.time}</span>
                      </div>
                    ))}
                  </div>
                  {course.course_record && (
                    <p className="text-[13px] text-[var(--muted)] mt-2 italic border-t border-[var(--card-border)]/40 pt-2">
                      {tt('코스 기록:')} {course.course_record}
                    </p>
                  )}
                </div>
              )}

              {/* build 228: 내 진행 + 도전자 list 카드는 참가비 직후 상단으로 이동.
                  완주자 인증서는 완주 시만 노출되므로 위치 유지. */}

              {/* 완주자 인증서 + 메달 신청 */}
              {completed && course && (
                <div className="rounded-2xl bg-gradient-to-br from-amber-50 via-amber-50/60 to-yellow-50/40 dark:from-amber-950/40 dark:to-amber-950/20 border-2 border-amber-300/60 dark:border-amber-800/40 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-md shadow-amber-500/30">
                      <Trophy size={20} className="text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-extrabold text-amber-900 dark:text-amber-200">{tt('🎉 완주 축하해요!')}</p>
                      <p className="text-[13px] text-amber-700/80 dark:text-amber-300/80">{tt('디지털 인증서를 다운받거나 실물 메달을 신청하세요')}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        // 2026-07-15: async 미대기 연타 → 중복 생성/공유 시트 겹침 방지
                        if (certBusyRef.current) return;
                        certBusyRef.current = true;
                        void downloadCertificate(course, profile?.display_name ?? tt('러너'), myRunner!)
                          .catch(() => {})
                          .finally(() => { certBusyRef.current = false; });
                      }}
                      className="py-3 rounded-xl bg-white dark:bg-zinc-900 border-2 border-amber-300/60 dark:border-amber-800/40 text-amber-700 dark:text-amber-300 font-extrabold text-sm active:scale-[0.98] inline-flex items-center justify-center gap-1.5"
                    >
                      <Download size={14} /> {tt('인증서')}
                    </button>
                    <button
                      onClick={() => setMedalFormOpen(true)}
                      disabled={medal?.request_status === 'paid' || medal?.request_status === 'shipped' || medal?.request_status === 'delivered'}
                      className="py-3 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 text-white font-extrabold text-sm disabled:opacity-50 active:scale-[0.98] inline-flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/30"
                    >
                      <Award size={14} /> {medal?.request_status === 'requested' ? tt('신청 완료') : tt('메달 신청')}
                    </button>
                  </div>

                  {medal?.request_status && medal.request_status !== 'none' && (
                    <div className="text-[13px] text-amber-800 dark:text-amber-200 px-2 py-2 rounded-lg bg-white/40 dark:bg-black/20">
                      <span className="font-extrabold">{tt('상태:')}</span> {tt(STATUS_LABEL[medal.request_status])}
                      {medal.shipping_address && <> · {medal.shipping_address.slice(0, 40)}</>}
                    </div>
                  )}

                  <p className="text-[12px] text-amber-700/70 dark:text-amber-300/70 leading-relaxed">
                    {locale === 'en'
                      ? `💌 Physical medal ₩${MEDAL_PRICE.toLocaleString()} (shipping included). Ships 1–2 weeks after request.`
                      : `💌 실물 메달은 ${MEDAL_PRICE.toLocaleString()}원 (배송비 포함). 신청 후 1~2주 내 발송.`}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* build 164 #3: 미참가 사용자에게 sticky bottom CTA 노출.
            상세 화면을 충분히 본 뒤 자연스럽게 결제로 이어지는 흐름. */}
        {!loading && course && !myRunner && onStartCourse && (
          <div
            className="sticky bottom-0 px-5 py-3 bg-[var(--background)] border-t border-[var(--card-border)]/40"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
          >
            <button
              onClick={() => onStartCourse(course)}
              className="w-full py-4 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-base active:scale-[0.98] shadow-md shadow-emerald-500/25 inline-flex items-center justify-center gap-1.5"
            >
              <Trophy size={16} /> {locale === 'en' ? `Start for ${course.entry_fee_p.toLocaleString()} mileage` : `${course.entry_fee_p.toLocaleString()} 마일리지로 도전 시작`}
            </button>
            <p className="text-[13px] text-center text-[var(--muted)] mt-1.5">
              {locale === 'en' ? `${runners.length} runner${runners.length === 1 ? ' is' : 's are'} on this course right now` : `지금 ${runners.length}명이 함께 달리고 있어요`}
            </p>
          </div>
        )}

        {medalFormOpen && course && (
          <MedalRequestForm
            courseId={course.id}
            courseName={course.name}
            initialName={profile?.display_name ?? ''}
            existing={medal}
            onClose={() => setMedalFormOpen(false)}
            onSubmitted={async () => { setMedalFormOpen(false); showToast(tt('✨ 메달 신청이 접수됐어요')); await load(); }}
            onError={(msg) => showToast(msg, 'warn')}
          />
        )}

        {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2200} />}
      </div>
    </div>
  );
}

// ── Google Maps 라이브 트래커 (build 126) ──
function GoogleLiveTracker({ realPath, runners, myUserId }: {
  realPath: RealLatLng[];
  runners: CourseRunner[];
  myUserId: string | null;
}) {
  const { tt } = useI18n();
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!API_KEY) { setError(ttl('지도 API 키 없음')); return; }
    loadGoogleMaps().then(() => setLoaded(true)).catch(e => setError(e instanceof Error ? e.message : ttl('실패')));
  }, []);

  // 진행률 ratio 로 path 위 위치 계산
  const posOf = useCallback((ratio: number): RealLatLng => {
    if (realPath.length < 2) return realPath[0];
    const cum: number[] = [0];
    for (let i = 1; i < realPath.length; i++) {
      const dx = realPath[i].lng - realPath[i - 1].lng;
      const dy = realPath[i].lat - realPath[i - 1].lat;
      cum.push(cum[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    const total = cum[cum.length - 1];
    const target = total * Math.min(1, Math.max(0, ratio));
    for (let i = 1; i < realPath.length; i++) {
      if (cum[i] >= target) {
        const t = (target - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
        return {
          lat: realPath[i - 1].lat + (realPath[i].lat - realPath[i - 1].lat) * t,
          lng: realPath[i - 1].lng + (realPath[i].lng - realPath[i - 1].lng) * t,
        };
      }
    }
    return realPath[realPath.length - 1];
  }, [realPath]);

  useEffect(() => {
    if (!loaded || !mapDivRef.current) return;

    if (!mapRef.current) {
      mapRef.current = new window.google.maps.Map(mapDivRef.current, {
        zoom: 10,
        center: realPath[0],
        disableDefaultUI: true,
        zoomControl: true,
        // build 220 #4a: 사용자 — '지도 확대를 누르면 더 상세하게 볼 수 있게'.
        // 줌 컨트롤 위치를 우측 하단으로 옮기고, 풀스크린 컨트롤 활성화. minZoom 4 / maxZoom 19.
        zoomControlOptions: { position: window.google.maps.ControlPosition.RIGHT_BOTTOM },
        fullscreenControl: true,
        // build 233: 확대 아이콘이 hero runners 프로필 ribbon 과 겹친다는 신고 → LEFT_TOP 으로 이동.
        fullscreenControlOptions: { position: window.google.maps.ControlPosition.LEFT_TOP },
        minZoom: 3,
        maxZoom: 19,
        gestureHandling: 'greedy',
        styles: [
          { featureType: 'poi', stylers: [{ visibility: 'off' }] },
          { featureType: 'transit', stylers: [{ visibility: 'off' }] },
        ],
      });

      // 폴리라인
      polylineRef.current = new window.google.maps.Polyline({
        path: realPath,
        map: mapRef.current,
        strokeColor: '#10b981',
        strokeOpacity: 0.9,
        strokeWeight: 5,
      });

      // 시작/끝 마커
      new window.google.maps.Marker({
        position: realPath[0],
        map: mapRef.current,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#10b981', fillOpacity: 1,
          strokeColor: '#ffffff', strokeWeight: 2,
        },
        title: ttl('시작'),
      });
      new window.google.maps.Marker({
        position: realPath[realPath.length - 1],
        map: mapRef.current,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#f97316', fillOpacity: 1,
          strokeColor: '#ffffff', strokeWeight: 2,
        },
        title: ttl('피니시'),
      });

      // bounds fit
      const bounds = new window.google.maps.LatLngBounds();
      realPath.forEach(p => bounds.extend(p));
      mapRef.current.fitBounds(bounds, 30);
    }

    // 러너 마커 재생성
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];

    // build 220 #3: avatar 를 SVG <image href> 로 임베드하면 WKWebView 가
    // 외부 이미지 fetch 시점에 마커가 빈 박스로 그려지는 회귀 (build 219 사용자 신고).
    // 안전한 방법 = avatar 를 canvas 로 미리 그려 PNG dataURL 로 변환 후 marker icon 으로 사용.
    // CORS 안 되면 fallback SymbolPath.CIRCLE.
    let cancelled = false;
    (async () => {
      const slice = runners.slice(0, 12);
      const iconUrls = await Promise.all(slice.map(async (r) => {
        if (!r.avatar_url) return null;
        const isMe = r.user_id === myUserId;
        const isCompleted = r.ratio >= 1.0;
        const size = isCompleted ? 48 : (isMe ? 44 : 36);
        const ringColor = isCompleted ? '#f59e0b' : (isMe ? '#10b981' : '#3b82f6');
        return await buildAvatarPngDataUrl(r.avatar_url, size, ringColor);
      }));
      if (cancelled || !mapRef.current) return;

      slice.forEach((r, idx) => {
        const isMe = r.user_id === myUserId;
        const isCompleted = r.ratio >= 1.0;
        const pos = posOf(r.ratio);
        const offsetPos = isCompleted
          ? { lat: pos.lat + 0.003 * (idx + 1), lng: pos.lng + 0.003 * (idx + 1) }
          : pos;
        const size = isCompleted ? 48 : (isMe ? 44 : 36);
        const iconUrl = iconUrls[idx];

        const marker = new window.google.maps.Marker({
          position: offsetPos,
          map: mapRef.current!,
          icon: iconUrl ? {
            url: iconUrl,
            scaledSize: new window.google.maps.Size(size, size),
            anchor: new window.google.maps.Point(size / 2, size / 2),
          } : {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: isCompleted ? 14 : (isMe ? 10 : 7),
            fillColor: isCompleted ? (isMe ? '#f59e0b' : '#0ea5e9') : (isMe ? '#10b981' : '#3b82f6'),
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: isCompleted ? 4 : 2.5,
          },
          label: !iconUrl && isCompleted
            ? { text: isMe ? '👑' : '🏁', color: '#ffffff', fontWeight: 'bold', fontSize: '12px' }
            : undefined,
          title: `${r.display_name} · ${isCompleted ? ttl('완주!') : `${(r.ratio * 100).toFixed(0)}%`}`,
          zIndex: isMe ? 2000 : isCompleted ? 1500 : 100,
        });
        markersRef.current.push(marker);
      });
    })();

    return () => { cancelled = true; };
  }, [loaded, realPath, runners, myUserId, posOf]);

  useEffect(() => {
    return () => {
      markersRef.current.forEach(m => m.setMap(null));
      markersRef.current = [];
    };
  }, []);

  if (error) {
    return (
      <div className="h-56 rounded-2xl bg-[var(--card-border)]/20 flex items-center justify-center text-xs text-[var(--muted)]">
        {tt('지도 로드 실패')} — {error}
      </div>
    );
  }

  return (
    <div className="rounded-2xl overflow-hidden border-2 border-emerald-200/60 dark:border-emerald-900/40">
      {!loaded && <div className="h-56 animate-pulse bg-[var(--card-border)]/30" />}
      <div ref={mapDivRef} style={{ height: 240, display: loaded ? 'block' : 'none' }} />
      {/* build 220 #4a: 사용자가 '지도 중간 파란점이 뭐지?' 라고 물음.
          마커가 무엇을 의미하는지 한 줄 범례. */}
      {loaded && (
        <div className="px-3 py-2 bg-[var(--card)] border-t border-[var(--card-border)] text-[12px] flex items-center gap-2.5 flex-wrap text-[var(--muted)]">
          <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" /> {tt('시작')}</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-500" /> {tt('도착')}</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-200" /> {tt('나')}</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500" /> {tt('다른 참가자')}</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500" /> {tt('완주자')}</span>
        </div>
      )}
    </div>
  );
}

// build 220 #3: avatar 를 canvas 로 미리 그려 PNG dataURL 반환.
// 이전(219) SVG <image href> 방식은 WKWebView 에서 marker 생성 시점에
// 이미지 fetch 가 끝나지 않아 빈 박스로 그려지는 회귀가 있었음.
// crossOrigin='anonymous' 로 fetch — supabase storage 는 CORS open. 실패 시 null.
async function buildAvatarPngDataUrl(
  avatarUrl: string,
  size: number,
  ringColor: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        const r = size / 2;
        const inner = r - 3;
        // 색 ring
        ctx.fillStyle = ringColor;
        ctx.beginPath();
        ctx.arc(r, r, r - 0.5, 0, Math.PI * 2);
        ctx.fill();
        // 흰 border
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        // 원형 clip + avatar
        ctx.save();
        ctx.beginPath();
        ctx.arc(r, r, inner, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, r - inner, r - inner, inner * 2, inner * 2);
        ctx.restore();
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    // CORS 가 막히면 timeout — 5초 안에 onload 없으면 포기.
    setTimeout(() => resolve(null), 5000);
    img.src = avatarUrl;
  });
}

// 고도 프로파일 SVG 차트
function ElevationChart({ points }: { points: { km: number; m: number }[] }) {
  const { tt } = useI18n();
  if (points.length === 0) return null;
  const maxKm = Math.max(...points.map(p => p.km), 1);
  const minM = Math.min(...points.map(p => p.m));
  const maxM = Math.max(...points.map(p => p.m));
  const range = Math.max(1, maxM - minM);
  const w = 100, h = 40;
  const norm = (km: number, m: number) => ({
    x: (km / maxKm) * w,
    y: h - ((m - minM) / range) * h,
  });
  const pts = points.map(p => norm(p.km, p.m));
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
  const areaPath = `${linePath} L ${w} ${h} L 0 ${h} Z`;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h + 8}`} preserveAspectRatio="none" className="w-full" style={{ height: 120 }}>
        <defs>
          <linearGradient id="elev-grad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#elev-grad)" />
        <path d={linePath} fill="none" stroke="#10b981" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="flex items-center justify-between text-[12px] text-[var(--muted)] font-bold mt-1">
        <span>0km · {Math.round(points[0].m)}m</span>
        <span className="text-emerald-600">{tt('최고')} {Math.round(maxM)}m</span>
        <span>{points[points.length - 1].km.toFixed(1)}km · {Math.round(points[points.length - 1].m)}m</span>
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<NonNullable<MedalStatus['request_status']>, string> = {
  none: '미신청',
  requested: '접수됨 (결제 대기)',
  paid: '결제 완료 (포장 중)',
  shipped: '발송됨',
  delivered: '배송 완료',
  cancelled: '취소됨',
};

// ── 큰 라이브 트래커 지도 ────────────────────────────────────
function LiveTrackerMap({ path, runners, myUserId }: { path: PreviewPoint[] | null; runners: CourseRunner[]; myUserId: string | null }) {
  if (!path || path.length === 0) {
    return <div className="h-56 rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/40 flex items-center justify-center"><Globe size={48} className="text-emerald-500/40" /></div>;
  }
  const d = path.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  // 진행률 ratio 에 따라 폴리라인 좌표 계산
  const cum: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    cum.push(cum[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const total = cum[cum.length - 1];
  const posOf = (ratio: number): PreviewPoint => {
    const target = total * Math.min(1, Math.max(0, ratio));
    for (let i = 1; i < path.length; i++) {
      if (cum[i] >= target) {
        const t = (target - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
        return { x: path[i - 1].x + (path[i].x - path[i - 1].x) * t, y: path[i - 1].y + (path[i].y - path[i - 1].y) * t };
      }
    }
    return path[path.length - 1];
  };

  return (
    <div className="relative w-full rounded-2xl bg-gradient-to-br from-emerald-50/70 via-white to-teal-50/40 dark:from-emerald-950/30 dark:via-zinc-900 dark:to-teal-950/20 overflow-hidden border-2 border-emerald-200/60 dark:border-emerald-900/40">
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" className="w-full" style={{ aspectRatio: '5/3' }}>
        <defs>
          <pattern id="grid-lg" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(16,185,129,0.1)" strokeWidth="0.3" />
          </pattern>
          <linearGradient id="route-lg" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>
        </defs>
        <rect width="100" height="60" fill="url(#grid-lg)" />
        <path d={d} fill="none" stroke="rgba(0,0,0,0.15)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" transform="translate(0,0.4)" />
        <path d={d} fill="none" stroke="url(#route-lg)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={path[0].x} cy={path[0].y} r="2.8" fill="#10b981" stroke="#ffffff" strokeWidth="0.7" />
        <circle cx={path[path.length - 1].x} cy={path[path.length - 1].y} r="2.8" fill="#f97316" stroke="#ffffff" strokeWidth="0.7" />
      </svg>

      {/* 참가자 마커 — html overlay (avatar 이미지 렌더링 위해 SVG 대신 div) */}
      {runners.slice(0, 10).map(r => {
        const pos = posOf(r.ratio);
        const isMe = r.user_id === myUserId;
        return (
          <div
            key={r.user_id}
            className={`absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none transition-all ${isMe ? 'z-10' : ''}`}
            style={{ left: `${pos.x}%`, top: `${pos.y / 60 * 100}%` }}
          >
            <div className={`rounded-full overflow-hidden border-2 ${isMe ? 'border-emerald-500 w-9 h-9 shadow-lg shadow-emerald-500/40' : 'border-white w-7 h-7 shadow'}`}>
              {r.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className={`w-full h-full flex items-center justify-center font-extrabold text-[12px] ${isMe ? 'bg-emerald-500 text-white' : 'bg-white text-emerald-600'}`}>
                  {r.display_name.slice(0, 1)}
                </div>
              )}
            </div>
            <div className={`mt-0.5 px-1.5 py-0.5 rounded-md text-[11px] font-extrabold whitespace-nowrap max-w-[80px] truncate ${isMe ? 'bg-emerald-500 text-white' : 'bg-white/95 dark:bg-zinc-900/95 text-[var(--foreground)] shadow-sm'}`}>
              {r.display_name}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── 메달 신청 폼 ────────────────────────────────────
function MedalRequestForm({ courseId, courseName, initialName, existing, onClose, onSubmitted, onError }: {
  courseId: string;
  courseName: string;
  initialName: string;
  existing: MedalStatus | null;
  onClose: () => void;
  onSubmitted: () => void;
  onError: (msg: string) => void;
}) {
  const { tt, locale } = useI18n();
  const [form, setForm] = useState<MedalShippingForm>({
    shipping_name: existing?.shipping_name ?? initialName,
    shipping_phone: '',
    shipping_address: existing?.shipping_address ?? '',
    shipping_zipcode: '',
    payment_amount: MEDAL_PRICE,
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!form.shipping_name || !form.shipping_phone || !form.shipping_address) {
      onError(tt('받는분 / 연락처 / 주소 모두 입력해주세요'));
      return;
    }
    setSubmitting(true);
    try {
      await requestCourseMedal(courseId, form);
      onSubmitted();
    } catch (e) {
      onError(e instanceof Error ? e.message : tt('신청 실패'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/65 flex items-end sm:items-center justify-center sm:p-3" onClick={() => !submitting && onClose()}>
      <div className="w-full sm:max-w-md bg-[var(--background)] rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 px-5 pt-4 pb-3 bg-[var(--background)] border-b border-amber-100 dark:border-amber-950/40 rounded-t-3xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                <Award size={20} className="text-white" />
              </div>
              <div>
                <h3 className="text-base font-extrabold">{tt('메달 신청')}</h3>
                <p className="text-[13px] text-[var(--muted)]">{courseName}</p>
              </div>
            </div>
            <button onClick={onClose} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-[var(--card-border)]/40 active:scale-90">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div className="rounded-2xl bg-gradient-to-br from-amber-50 to-amber-50/60 dark:from-amber-950/30 dark:to-amber-950/10 border border-amber-200/60 dark:border-amber-800/40 p-4">
            <p className="text-sm font-extrabold text-amber-900 dark:text-amber-200 inline-flex items-center gap-1.5">
              <Sparkles size={14} /> {locale === 'en' ? `Souvenir medal ₩${MEDAL_PRICE.toLocaleString()}` : `기념 메달 ${MEDAL_PRICE.toLocaleString()}원`}
            </p>
            <p className="text-[13px] text-amber-700/80 dark:text-amber-300/80 mt-1 leading-relaxed">
              {tt('배송비 포함. 신청 접수 후 결제 안내 메시지를 보내드려요. 결제 확인 후 1~2주 내 발송.')}
            </p>
          </div>

          <Field label={tt('받는 분')}>
            <input
              value={form.shipping_name}
              onChange={(e) => setForm({ ...form, shipping_name: e.target.value })}
              placeholder={tt('이름')}
              className={inputCls}
            />
          </Field>
          <Field label={tt('연락처')}>
            <input
              type="tel"
              value={form.shipping_phone}
              onChange={(e) => setForm({ ...form, shipping_phone: e.target.value })}
              placeholder="010-0000-0000"
              className={inputCls}
            />
          </Field>
          <Field label={tt('우편번호')}>
            <input
              value={form.shipping_zipcode}
              onChange={(e) => setForm({ ...form, shipping_zipcode: e.target.value })}
              placeholder="00000"
              className={inputCls}
              maxLength={6}
            />
          </Field>
          <Field label={tt('주소')}>
            <textarea
              value={form.shipping_address}
              onChange={(e) => setForm({ ...form, shipping_address: e.target.value })}
              placeholder={tt('도로명 + 상세주소')}
              rows={3}
              className={`${inputCls} resize-none`}
            />
          </Field>
        </div>

        <div className="sticky bottom-0 px-5 py-4 bg-[var(--background)] border-t border-[var(--card-border)]/40" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-4 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 text-white font-extrabold text-base disabled:opacity-50 active:scale-[0.98] inline-flex items-center justify-center gap-1.5 shadow-lg shadow-amber-500/30"
          >
            {submitting ? tt('접수 중…') : <><Truck size={16} /> {tt('신청하기')}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls = 'w-full px-4 py-3.5 rounded-xl border-2 border-[var(--card-border)] bg-[var(--card)] text-[15px] focus:outline-none focus:border-amber-500';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-extrabold text-[var(--muted)] mb-1">{label}</label>
      {children}
    </div>
  );
}

// ── 인증서 다운로드 (canvas → png blob → 다운로드) ──────────
// 2026-07-12 Conqueror 차용 5: 가로 A4 텍스트-only → 세로형 (1080×1528, 인스타 공유 친화)
// + 실제 지도 밴드 (hero_image_url) 위 경로 오버레이 + 도전 기간 (시작~완주 · N일간).
// 지도 로드 실패 (오프라인 등) 시 밴드만 단색 폴백 — 인증서 자체는 항상 생성.
async function downloadCertificate(course: VirtualCourse, displayName: string, runner: CourseRunner) {
  const W = 1080;
  const H = 1528;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // 지도 이미지 선로드 — Supabase Storage public 은 CORS * 라 crossOrigin 으로 canvas 오염 없음
  let heroImg: HTMLImageElement | null = null;
  if (course.hero_image_url) {
    heroImg = await new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      // 2026-07-15: 네트워크 stall 시 onload/onerror 둘 다 안 와 버튼이 영구 무반응이던
      // 문제 — 5초 지나면 지도 밴드 없이 진행 (buildAvatarPngDataUrl 과 동일 패턴).
      const timer = setTimeout(() => resolve(null), 5000);
      img.crossOrigin = 'anonymous';
      img.onload = () => { clearTimeout(timer); resolve(img); };
      img.onerror = () => { clearTimeout(timer); resolve(null); };
      img.src = course.hero_image_url as string;
    });
  }

  // 배경 — 크림 + 에메랄드 액센트
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#fefce8');
  bg.addColorStop(1, '#f0fdf4');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 테두리 — 에메랄드 두꺼운 + 안쪽 골드 얇은
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 16;
  ctx.strokeRect(30, 30, W - 60, H - 60);
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 3;
  ctx.strokeRect(54, 54, W - 108, H - 108);

  ctx.textAlign = 'center';

  // 헤더 — Routinist
  ctx.fillStyle = '#10b981';
  ctx.font = 'bold 30px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('ROUTINIST · WORLD RUN', W / 2, 140);

  // 타이틀
  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold 78px Georgia, serif';
  ctx.fillText(ttl('완주 인증서'), W / 2, 240);
  ctx.fillStyle = '#6b7280';
  ctx.font = '26px Georgia, serif';
  ctx.fillText('CERTIFICATE OF COMPLETION', W / 2, 288);

  // 지도 밴드 (5:3 — hero 이미지 비율 그대로) + 경로 오버레이
  const mapX = 90, mapY = 340, mapW = 900, mapH = 540;
  ctx.save();
  ctx.beginPath();
  // roundRect 폴리필 불필요한 사각 클립 (iOS 15 호환)
  ctx.rect(mapX, mapY, mapW, mapH);
  ctx.clip();
  if (heroImg) {
    ctx.drawImage(heroImg, mapX, mapY, mapW, mapH);
  } else {
    ctx.fillStyle = '#d1fae5';
    ctx.fillRect(mapX, mapY, mapW, mapH);
  }
  // 경로 — preview_path 는 hero 이미지와 같은 crop 좌표계 (x 0~100 / y 0~60)
  const pp = course.preview_path;
  if (pp && pp.length > 1) {
    const px = (p: { x: number; y: number }) => ({ x: mapX + (p.x / 100) * mapW, y: mapY + (p.y / 60) * mapH });
    const drawPath = () => {
      ctx.beginPath();
      pp.forEach((p, i) => {
        const q = px(p);
        if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
      });
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    drawPath();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 16;
    ctx.stroke();
    drawPath();
    ctx.strokeStyle = '#059669';
    ctx.lineWidth = 9;
    ctx.stroke();
    const s = px(pp[0]);
    const e = px(pp[pp.length - 1]);
    ctx.fillStyle = '#10b981';
    ctx.beginPath(); ctx.arc(s.x, s.y, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f97316';
    ctx.beginPath(); ctx.arc(e.x, e.y, 12, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  // 밴드 테두리
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 4;
  ctx.strokeRect(mapX, mapY, mapW, mapH);

  // 이름
  ctx.fillStyle = '#10b981';
  ctx.font = 'bold 84px Georgia, serif';
  ctx.fillText(displayName, W / 2, 1000);

  // "은(는) 다음 코스를 완주하였습니다"
  ctx.fillStyle = '#374151';
  ctx.font = '32px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(ttl('님은 다음 가상 코스를 완주하였습니다.'), W / 2, 1060);

  // 코스명 + 거리·국가
  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold 58px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(course.name, W / 2, 1150);
  ctx.fillStyle = '#10b981';
  ctx.font = 'bold 44px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(`${course.distance_km.toFixed(1)} km · ${ttl(course.country ?? '세계')}`, W / 2, 1215);

  // 도전 기간 — 시작 ~ 완주 · N일간
  const certLocale = getCurrentLocale() === 'en' ? 'en-US' : 'ko-KR';
  const fmt = (iso: string) => new Date(iso).toLocaleDateString(certLocale, { year: 'numeric', month: 'long', day: 'numeric' });
  const completedIso = runner.completed_at ?? new Date().toISOString();
  const days = Math.max(1, Math.ceil((new Date(completedIso).getTime() - new Date(runner.started_at).getTime()) / 86400000));
  ctx.fillStyle = '#6b7280';
  ctx.font = '30px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(
    getCurrentLocale() === 'en'
      ? `${fmt(runner.started_at)} – ${fmt(completedIso)} · ${days} day${days > 1 ? 's' : ''}`
      : `${fmt(runner.started_at)} ~ ${fmt(completedIso)} · ${days}일간의 여정`,
    W / 2, 1290
  );

  // 푸터 — 사인
  ctx.fillStyle = '#9ca3af';
  ctx.font = '24px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('Run Your Routine.', W / 2, 1400);
  ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillStyle = '#10b981';
  ctx.fillText('routinist.kr', W / 2, 1440);

  // build 237: iOS WKWebView 가 <a download> 잘 못 다룸 → Capacitor Filesystem + Share 로 native
  // share sheet 띄움. 사용자가 "사진에 저장" / "파일에 저장" / "공유" 선택 가능.
  // 비-네이티브 (web/dev) 환경에선 기존 <a download> 폴백.
  const filename = `Routinist_${course.name.replace(/\s/g, '_')}_${displayName}.png`;
  canvas.toBlob(async (blob) => {
    if (!blob) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isNative = (typeof window !== 'undefined') && ((window as any).Capacitor?.isNativePlatform?.() ?? false);
    if (isNative) {
      try {
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve, reject) => {
          reader.onloadend = () => {
            const result = reader.result as string;
            // data:image/png;base64,xxxx → 헤더 제거
            const idx = result.indexOf(',');
            resolve(idx >= 0 ? result.slice(idx + 1) : result);
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        await Filesystem.writeFile({
          path: filename,
          data: base64,
          directory: Directory.Cache,
        });
        const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
        const { Share } = await import('@capacitor/share');
        await Share.share({
          title: `${course.name} ${ttl('완주 인증서')}`,
          text: `${displayName} · ${course.name} ${ttl('완주 인증서')}`,
          url: uri,
          dialogTitle: ttl('인증서 저장 또는 공유'),
        });
      } catch (e) {
        console.warn('[certificate] native share fail', e);
        // 최후 폴백 — DOM 다운로드 (대부분 WKWebView 에서 동작 안 하지만 시도).
        const link = document.createElement('a');
        link.download = filename;
        link.href = URL.createObjectURL(blob);
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      }
    } else {
      const link = document.createElement('a');
      link.download = filename;
      link.href = URL.createObjectURL(blob);
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }
  }, 'image/png');
}
