'use client';

// 세계를 달려! (Virtual Course) — 랭킹 탭 서브탭 (build 106).
// 유명 마라톤 / 트레일 코스를 가상으로 누적. 완주 시 메달 (수기 발급).

import { useEffect, useState, useCallback } from 'react';
import { Globe, Trophy, Sparkles, Flag, MapPin } from 'lucide-react';
import {
  fetchAvailableCourses,
  fetchMyCourses,
  fetchCourseSeries,
  startCourse,
  CONTINENT_LABEL,
  CONTINENT_EMOJI,
  type VirtualCourse,
  type MyCourse,
  type PreviewPoint,
  type Continent,
  type CourseSeries,
} from '@/lib/world-data';
import AppToast from '@/components/AppToast';
import CourseDetailSheet from './CourseDetailSheet';
import CourseFriendsRow from './CourseFriendsRow';
import { useI18n } from '@/lib/i18n';
import { logClientInfo, logClientWarn } from '@/lib/error-logger';
// build 207: 영문화 — 챌린지 시리즈/자세히/달리는 중/도전하기/대륙/마라톤·국가명 등 tt wrap.
import { Coins } from 'lucide-react';
import { track } from '@/lib/analytics';
import NextLink from 'next/link';
import { useAuth } from '@/components/AuthProvider';

// build 166 #1: 사용자가 마일리지로 코스 참가했는데 "도전하기" 가 그대로 보이는 회귀.
// fetchMyCourses RPC 가 silent fail 하거나 client cache 회귀 시 mine=[] → joined=false 가 됨.
// localStorage 에 사용자가 직접 시작한 코스 id 영구 저장 → fetch 실패해도 "달리는 중" 유지.
function joinedKey(uid: string) { return `joined_courses:${uid}`; }
function getKnownJoined(uid: string | undefined): Set<string> {
  if (!uid || typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(joinedKey(uid));
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch { return new Set(); }
}
function addKnownJoined(uid: string | undefined, courseId: string): void {
  if (!uid || typeof window === 'undefined') return;
  try {
    const s = getKnownJoined(uid);
    s.add(courseId);
    window.localStorage.setItem(joinedKey(uid), JSON.stringify([...s]));
  } catch {}
}

// 코스 카드용 미리보기 SVG — preview_path (0~100) 정규화 폴리라인.
// 시작점=에메랄드 원, 끝점=주황 원. 배경 그리드 + 폴리라인 그림자.
function CoursePreview({ path, progress }: { path: PreviewPoint[] | null; progress?: number }) {
  if (!path || path.length === 0) {
    return (
      <div className="w-full h-28 rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/40 flex items-center justify-center">
        <Globe size={28} className="text-emerald-500/40" />
      </div>
    );
  }
  const d = path.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const first = path[0];
  const last = path[path.length - 1];
  // 진행률 표시 — path 를 길이 기반으로 자른 위치에 러너 마커
  let runner: PreviewPoint | null = null;
  if (typeof progress === 'number' && progress > 0 && progress < 1 && path.length > 1) {
    const cum: number[] = [0];
    for (let i = 1; i < path.length; i++) {
      const dx = path[i].x - path[i - 1].x;
      const dy = path[i].y - path[i - 1].y;
      cum.push(cum[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    const total = cum[cum.length - 1];
    const target = total * progress;
    for (let i = 1; i < path.length; i++) {
      if (cum[i] >= target) {
        const t = (target - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
        runner = {
          x: path[i - 1].x + (path[i].x - path[i - 1].x) * t,
          y: path[i - 1].y + (path[i].y - path[i - 1].y) * t,
        };
        break;
      }
    }
  }

  return (
    <div className="relative w-full h-28 rounded-xl bg-gradient-to-br from-emerald-50/70 via-white to-teal-50/40 dark:from-emerald-950/30 dark:via-zinc-900 dark:to-teal-950/20 overflow-hidden border border-emerald-100 dark:border-emerald-900/40">
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" className="w-full h-full">
        {/* 가벼운 그리드 */}
        <defs>
          <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(16,185,129,0.08)" strokeWidth="0.3" />
          </pattern>
        </defs>
        <rect width="100" height="60" fill="url(#grid)" />
        {/* 폴리라인 그림자 */}
        <path d={d} fill="none" stroke="rgba(0,0,0,0.12)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" transform="translate(0,0.4)" />
        {/* 본체 — 에메랄드 그라데이션 */}
        <defs>
          <linearGradient id="route" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>
        </defs>
        <path d={d} fill="none" stroke="url(#route)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        {/* 시작 */}
        <circle cx={first.x} cy={first.y} r="2.4" fill="#10b981" stroke="#ffffff" strokeWidth="0.6" />
        {/* 끝 */}
        <circle cx={last.x} cy={last.y} r="2.4" fill="#f97316" stroke="#ffffff" strokeWidth="0.6" />
        {/* 러너 마커 (진행중) */}
        {runner && (
          <>
            <circle cx={runner.x} cy={runner.y} r="3.2" fill="#ffffff" stroke="#10b981" strokeWidth="1.2" />
            <circle cx={runner.x} cy={runner.y} r="1.4" fill="#10b981" />
          </>
        )}
      </svg>
    </div>
  );
}

export default function WorldTab() {
  const { t, tt } = useI18n();
  const { user } = useAuth();
  const [mine, setMine] = useState<MyCourse[]>([]);
  const [available, setAvailable] = useState<VirtualCourse[]>([]);
  const [pathMap, setPathMap] = useState<Map<string, PreviewPoint[] | null>>(new Map());
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<string | null>(null);
  const [detailCourseId, setDetailCourseId] = useState<string | null>(null);
  const [confirmStart, setConfirmStart] = useState<VirtualCourse | null>(null);
  // build 229.B: 도전 시작 시 "왜 달리는가" optional 모티프 입력.
  const [motivationText, setMotivationText] = useState('');
  const [continentFilter, setContinentFilter] = useState<Continent | 'all'>('all');
  const [seriesList, setSeriesList] = useState<CourseSeries[]>([]);
  const [seriesFilter, setSeriesFilter] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  // build 166 #1: localStorage 기반 joined 영구셋. fetchMyCourses 실패해도 유지.
  const [knownJoined, setKnownJoined] = useState<Set<string>>(() => getKnownJoined(undefined));
  useEffect(() => { setKnownJoined(getKnownJoined(user?.id)); }, [user?.id]);

  const showToast = useCallback((text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2200);
  }, []);

  // build 170 #6: knownJoined stale 정리.
  // localStorage 가 영구 fallback 이라 사용자가 이전에 시도했다가 DB 에서 사라진 코스
  // (완주·취소·환불 등) 도 "달리는 중" 으로 잘못 표시될 수 있음 (사용자 신고: 2개 보임).
  // mine 이 한 번이라도 정상 fetch 되면 그 결과를 source of truth 로 삼아 sync.
  const reconcileKnownJoined = useCallback((freshMine: MyCourse[]) => {
    if (!user?.id || typeof window === 'undefined') return;
    const activeIds = new Set(freshMine.filter(m => !m.completed_at).map(m => m.course_id));
    try {
      const next = JSON.stringify([...activeIds]);
      window.localStorage.setItem(joinedKey(user.id), next);
      setKnownJoined(activeIds);
    } catch {}
  }, [user?.id]);

  const load = useCallback(async () => {
    setLoading(true);
    // 두 fetch 를 분리해서 한쪽 실패해도 다른 쪽은 표시 (사용자 신고: 빈 코스 화면).
    // build 170 #6: fetchMyCourses 성공/실패 구분 → 성공 시에만 knownJoined reconcile.
    //   실패 시엔 기존 localStorage 유지 (회귀 fallback).
    // build 239: catch 의 error 상세 (message/code/hint/details) 를 외부 변수로 보관 →
    //   아래 logClientWarn 에 포함시켜 정확한 원인 추적 (이전엔 빈 details {} 만 기록).
    let myFetchOk = true;
    let myFetchError: { message: string; code?: string; hint?: string; details?: string } | null = null;
    const myPromise = fetchMyCourses().catch(e => {
      myFetchOk = false;
      const errObj = e as { message?: string; code?: string; hint?: string; details?: string };
      myFetchError = {
        message: errObj?.message ?? String(e),
        code: errObj?.code,
        hint: errObj?.hint,
        details: errObj?.details,
      };
      console.warn('[world] fetchMyCourses fail', e);
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('world_fetch_my_courses_last_error', JSON.stringify({
            ts: new Date().toISOString(),
            ...myFetchError,
          }));
        }
      } catch {}
      return [] as MyCourse[];
    });
    const allPromise = fetchAvailableCourses().catch(e => {
      console.warn('[world] fetchAvailableCourses fail', e);
      return [] as VirtualCourse[];
    });
    const seriesPromise = fetchCourseSeries().catch(() => [] as CourseSeries[]);
    const [my, all, series] = await Promise.all([myPromise, allPromise, seriesPromise]);
    setSeriesList(series);

    // build 238: 진단 로그 — "달리는 중" 회귀 추적. mine 에 어떤 코스가 있고 completed_at 상태 어떤지.
    if (myFetchOk) {
      logClientInfo('world', 'fetchMyCourses ok', {
        count: my.length,
        courses: my.map(m => ({
          id: m.course_id,
          name: m.name,
          completed: !!m.completed_at,
          prog: Number(m.progress_km ?? 0),
          dist: Number(m.distance_km ?? 0),
        })),
      });
    } else {
      // build 239: error 상세를 details 에 함께 보내 정확한 원인 추적 가능.
      logClientWarn('world', 'fetchMyCourses fail — knownJoined fallback only', myFetchError ?? {});
    }

    setMine(my);
    // build 170 #6: mine 성공 fetch 이면 knownJoined 를 ground truth 로 sync.
    // → DB 에서 사라진 코스(완주·취소)가 localStorage 에 잔재해 "달리는 중" 으로 잘못 표시되는 버그 fix.
    if (myFetchOk) reconcileKnownJoined(my);
    // build 163 #3: 참가중 코스도 "새 코스" 리스트에 노출하되 버튼명만 "참가중 — 진입" 으로 분기.
    // 기존엔 mine 으로 필터링했지만, fetchMyCourses RPC 가 silent fail (.catch return []) 하면
    // 참가한 코스가 available 에 그대로 떠서 "도전 시작" 버튼을 또 보게 됨.
    // 완주한 코스만 제외 — 새 코스 섹션은 "참가 가능 + 진행 중" 으로 정의.
    // build 234: completed_at NULL 이라도 progress >= distance 면 completed 로 취급 (DB trigger
    // 적용 전 사용자의 stale data 흡수). Number() 변환 — numeric 컬럼이 string 으로 도착하던 회귀.
    const completedIds = new Set(
      my
        .filter(m => !!m.completed_at || Number(m.progress_km ?? 0) >= Number(m.distance_km ?? Infinity))
        .map(m => m.course_id)
    );
    setAvailable(all.filter(c => !completedIds.has(c.id)));

    // 진행중 코스도 미리보기 보이게 — all 의 preview_path 매핑.
    const map = new Map<string, PreviewPoint[] | null>();
    all.forEach(c => map.set(c.id, c.preview_path));
    setPathMap(map);

    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleStart = async (courseId: string) => {
    setStarting(courseId);
    try {
      const r = await startCourse(courseId);
      const name = confirmStart?.name ?? available.find(c => c.id === courseId)?.name ?? tt('코스');
      const localName = tt(name);
      if (r.already_started) {
        showToast(tt('🏃 {name} 참가중이에요 — 바로 진입할게요!').replace('{name}', localName));
      } else {
        track('world_course_start', { course_id: courseId, course_name: name });
        // build 164 #3: 친근한·재미있는 출발 멘트.
        showToast(
          tt('🎉 출발! {fee} 마일리지 차감 (잔액 {bal})')
            .replace('{fee}', r.fee_charged.toLocaleString())
            .replace('{bal}', r.balance.toLocaleString())
        );
      }
      // build 166 #1: handleStart 가 성공하면 (already_started 든 fee_charged 든) localStorage 에 영구 저장.
      // fetchMyCourses 가 RLS / network 이슈로 빈 결과를 줘도 "달리는 중" 표시가 유지됨.
      addKnownJoined(user?.id, courseId);
      setKnownJoined(prev => { const s = new Set(prev); s.add(courseId); return s; });
      // build 229.B: 모티프 텍스트 저장 (입력 비어 있으면 RPC 가 NULL 로 처리).
      if (motivationText.trim()) {
        try {
          const supabase = (await import('@/lib/supabase')).getSupabase();
          await supabase.rpc('set_course_motivation', {
            p_course_id: courseId,
            p_text: motivationText.trim(),
          });
        } catch (e) {
          console.warn('[world] set_course_motivation fail', e);
        }
      }
      setMotivationText('');
      setConfirmStart(null);
      await load();
      // build 157: 결제(시작) 직후 곧바로 코스 상세 시트로 진입 — Conqueror 앱처럼 가상 대회 참가한 느낌.
      setDetailCourseId(courseId);
    } catch (e) {
      // build 165 #3: Supabase PostgrestError 는 Error instance 가 아니라 plain object 이므로
      // instanceof 분기로 잡으면 RPC RAISE EXCEPTION 의 친근 메시지 ('앗! 마일리지가 N 모자라요…')
      // 가 묻혀버린다. 안전하게 message 필드 추출.
      const msg = (typeof e === 'object' && e !== null && 'message' in e && typeof (e as { message: unknown }).message === 'string')
        ? (e as { message: string }).message
        : tt('시작에 실패했어요. 잠시 후 다시 시도해주세요');
      showToast(msg, 'warn');
    } finally {
      setStarting(null);
    }
  };

  const completed = mine.filter(m => m.completed_at);
  const inProgress = mine.filter(m => !m.completed_at);
  // build 167 #5: 진행 중인 다른 코스가 있으면 새 코스 도전 차단 (정책: 동시 1개).
  // SQL guard + UI 양쪽 모두. UI 가 먼저 친근 메시지 보여줘서 결제 시도 자체를 막음.
  const hasActiveCourse = inProgress.length > 0;

  return (
    <div className="space-y-5">
      {/* 진행 중 */}
      {inProgress.length > 0 && (
        <Section title={t('world.inProgress')} icon={<Flag size={14} className="text-emerald-500" />}>
          <div className="space-y-2.5">
            {inProgress.map(c => (
              <button key={c.course_id} onClick={() => setDetailCourseId(c.course_id)} className="block w-full text-left active:scale-[0.99] transition">
                <ProgressCard course={c} path={pathMap.get(c.course_id) ?? null} />
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* 완주 메달 진열 */}
      {completed.length > 0 && (
        <Section title={t('world.medals')} icon={<Trophy size={14} className="text-amber-500" />}>
          <div className="grid grid-cols-3 gap-2.5">
            {completed.map(c => (
              <div key={c.course_id} className="card p-3 text-center">
                <div className="w-14 h-14 rounded-full mx-auto mb-1.5 bg-gradient-to-br from-amber-300 to-orange-500 flex items-center justify-center shadow-lg">
                  {c.has_medal ? <Trophy size={26} className="text-white" /> : <Sparkles size={22} className="text-white" />}
                </div>
                <p className="text-xs font-extrabold truncate">{tt(c.name)}</p>
                <p className="text-[10px] text-[var(--muted)]">{c.distance_km.toFixed(1)}km</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 챌린지 시리즈 (build 128 — The Conqueror 풍) */}
      {seriesList.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-extrabold inline-flex items-center gap-1.5">
              <Trophy size={14} className="text-amber-500" /> {tt('챌린지 시리즈')}
            </h2>
            {seriesFilter && (
              <button onClick={() => setSeriesFilter(null)} className="text-[11px] font-bold text-emerald-600 active:scale-95">{tt('전체')}</button>
            )}
          </div>
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-1 px-1">
            {seriesList.map(s => {
              const active = seriesFilter === s.series_id;
              const pct = s.course_count > 0 ? Math.round((s.my_completed / s.course_count) * 100) : 0;
              return (
                <div
                  key={s.series_id}
                  className={`flex-shrink-0 w-48 rounded-2xl p-3 border-2 transition ${
                    active ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white border-transparent shadow-md shadow-amber-500/30' : 'bg-[var(--card)] border-[var(--card-border)]'
                  }`}
                >
                  <button onClick={() => setSeriesFilter(active ? null : s.series_id)} className="w-full text-left active:scale-[0.98] transition">
                    <div className="text-2xl mb-1">{s.emoji ?? '🏆'}</div>
                    <p className={`text-sm font-extrabold ${active ? 'text-white' : 'text-[var(--foreground)]'}`}>{tt(s.name)}</p>
                    <p className={`text-[10px] mt-0.5 line-clamp-2 ${active ? 'text-white/90' : 'text-[var(--muted)]'}`}>{s.description ? tt(s.description) : ''}</p>
                    <div className="mt-2 flex items-center gap-2 text-[11px] font-extrabold">
                      <span className={active ? 'text-white' : 'text-emerald-600'}>{s.my_completed}/{s.course_count}</span>
                      <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${active ? 'bg-white/30' : 'bg-[var(--card-border)]/30'}`}>
                        <div className={`h-full ${active ? 'bg-white' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </button>
                  <NextLink href={`/world/series?slug=${s.slug}`} className={`mt-2 block text-center py-1 rounded-lg text-[10px] font-extrabold ${
                    active ? 'bg-white/25 text-white' : 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                  }`}>
                    {tt('자세히 →')}
                  </NextLink>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 대륙 필터 칩 (build 122 — #17 카테고리) */}
      <section>
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide pb-1 -mx-1 px-1">
          {(['all', 'asia', 'europe', 'americas', 'oceania', 'africa', 'global'] as const).map(c => (
            <button
              key={c}
              onClick={() => setContinentFilter(c)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-extrabold whitespace-nowrap active:scale-95 transition ${
                continentFilter === c
                  ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-500/30'
                  : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
              }`}
            >
              {c === 'all' ? tt('전체') : `${CONTINENT_EMOJI[c]} ${tt(CONTINENT_LABEL[c])}`}
            </button>
          ))}
        </div>
      </section>

      {/* 시작 가능한 코스 */}
      <Section title={tt('새 코스')} icon={<Globe size={14} className="text-emerald-500" />}>
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map(i => <div key={i} className="card p-4 animate-pulse h-24" />)}
          </div>
        ) : available.length === 0 && mine.length === 0 ? (
          <div className="card p-6 text-center">
            <Globe size={28} className="mx-auto text-[var(--muted)] mb-2" />
            <p className="text-sm font-bold">{tt('아직 등록된 코스가 없어요')}</p>
            <p className="text-xs text-[var(--muted)] mt-1">{tt('곧 추가될 예정이에요')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {available
              .filter(c => continentFilter === 'all' || c.continent === continentFilter)
              .filter(c => !seriesFilter || c.series_id === seriesFilter)
              // build 169 #13: 내가 도전 중인 코스를 최상단으로. (사용자가 참가한 코스가 리스트 중간에
              // 묻혀 보이지 않는다는 신고). myEntry || knownJoined 인 코스에 우선순위 부여.
              .sort((a, b) => {
                const aJoined = mine.some(m => m.course_id === a.id) || knownJoined.has(a.id);
                const bJoined = mine.some(m => m.course_id === b.id) || knownJoined.has(b.id);
                if (aJoined && !bJoined) return -1;
                if (!aJoined && bJoined) return 1;
                return 0;
              })
              .map(c => {
              const myEntry = mine.find(m => m.course_id === c.id);
              // build 166 #1: fetchMyCourses 가 빈결과여도 localStorage knownJoined 로 fallback.
              const joined = !!myEntry || knownJoined.has(c.id);
              // build 226 #6: progress_km >= distance_km 이지만 completed_at 이 NULL 인 경우에도
              // UI 상 "완주" 로 표시. build 234: Supabase numeric → JS string 으로 와서 lex 비교가
              // 깨지던 회귀 fix. Number() 명시 변환 + course distance fallback (mine 에 없을 때 available 에서).
              const myDistKm = Number(myEntry?.distance_km ?? c.distance_km ?? 0);
              const myProgKm = Number(myEntry?.progress_km ?? 0);
              const courseCompleted = !!myEntry && (
                !!myEntry.completed_at ||
                (myDistKm > 0 && myProgKm >= myDistKm)
              );
              return (
              <div key={c.id} className="rounded-2xl bg-[var(--card)] border border-[var(--card-border)] overflow-hidden">
                {/* 지도 미리보기 + 클릭 시 상세 */}
                <button onClick={() => setDetailCourseId(c.id)} className="w-full text-left active:opacity-90">
                  <CoursePreview path={c.preview_path} />
                </button>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h3 className="text-base font-extrabold truncate">{tt(c.name)}</h3>
                    <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex-shrink-0">
                      {c.distance_km.toFixed(1)}km
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-[var(--muted)] inline-flex items-center gap-1 font-semibold">
                      <MapPin size={11} /> {c.country ? tt(c.country) : tt('세계')}
                    </span>
                    <span className="text-amber-700 dark:text-amber-300 inline-flex items-center gap-0.5 font-extrabold">
                      <Coins size={11} /> {c.entry_fee_p.toLocaleString()}{tt(' 마일리지')}
                    </span>
                  </div>
                  {c.description && (
                    <p className="text-[13px] text-[var(--foreground)] mt-2 leading-relaxed break-keep line-clamp-3">{tt(c.description)}</p>
                  )}
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => setDetailCourseId(c.id)}
                      className="flex-1 py-3 rounded-xl bg-[var(--card)] border-2 border-[var(--card-border)] font-bold text-sm active:scale-[0.99]"
                    >
                      {tt('자세히')}
                    </button>
                    {joined ? (
                      // build 238: myEntry 없는 knownJoined-only 케이스 (fetchMyCourses fail / silent
                      // empty) 에선 "달리는 중" 으로 잘못 표시되는 회귀 차단. 중립 "확인" 표시 + 탭하면
                      // 상세 sheet 에서 정확한 progress 확인 가능. courseCompleted 도 myEntry 있을 때만.
                      !myEntry ? (
                        <button
                          onClick={() => setDetailCourseId(c.id)}
                          className="flex-1 py-3 rounded-xl text-white font-extrabold text-sm active:scale-[0.99] shadow-md bg-gradient-to-br from-sky-500 to-sky-600 shadow-sky-500/25"
                        >
                          {tt('🔍 확인')}
                        </button>
                      ) : (
                      <button
                        onClick={() => setDetailCourseId(c.id)}
                        className={`flex-1 py-3 rounded-xl text-white font-extrabold text-sm active:scale-[0.99] shadow-md ${
                          courseCompleted
                            ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-emerald-500/30'
                            : 'bg-gradient-to-br from-amber-500 to-orange-500 shadow-amber-500/25'
                        }`}
                      >
                        {courseCompleted ? tt('✅ 완주') : tt('🏃 달리는 중')}
                      </button>
                      )
                    ) : hasActiveCourse ? (
                      // build 167 #5: 진행 중인 다른 코스가 있으면 도전 차단. 친근 안내.
                      <button
                        onClick={() => showToast(tt('진행 중인 코스를 완주한 후에 새 도전을 시작할 수 있어요 🏃'), 'warn')}
                        className="flex-1 py-3 rounded-xl bg-[var(--card-border)]/30 text-[var(--muted)] font-bold text-sm active:scale-[0.99] cursor-not-allowed"
                      >
                        {tt('완주 후 도전 가능')}
                      </button>
                    ) : (
                      <button
                        onClick={() => setDetailCourseId(c.id)}
                        disabled={starting === c.id}
                        className="flex-1 py-3 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-sm active:scale-[0.99] disabled:opacity-50 shadow-md shadow-emerald-500/25"
                      >
                        {/* build 164 #3: "도전 시작" 누르면 바로 결제 다이얼로그가 뜨는 게 거친 흐름.
                            먼저 코스 상세를 보고, 거기서 결제 버튼을 누르는 흐름으로 매끄럽게. */}
                        {tt('도전하기 →')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          </div>
        )}
      </Section>

      {/* 참가비 차감 확인 다이얼로그 + build 229.B: 모티프 입력 */}
      {confirmStart && (
        <div className="fixed inset-0 z-[80] bg-black/65 flex items-center justify-center p-4" onClick={() => starting !== confirmStart.id && (setConfirmStart(null), setMotivationText(''))}>
          <div className="w-full max-w-sm bg-[var(--background)] rounded-3xl p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col items-center gap-2 mb-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-100 to-emerald-50 dark:from-emerald-900/40 dark:to-emerald-950/40 flex items-center justify-center">
                <Coins size={24} className="text-emerald-600" />
              </div>
              <h3 className="text-base font-extrabold text-center">🏃 {tt(confirmStart.name)} {tt('출발 준비!')}</h3>
              <p className="text-sm text-[var(--muted)] text-center leading-relaxed">
                {tt('참가비')} <span className="font-extrabold text-emerald-600">{confirmStart.entry_fee_p.toLocaleString()}{tt(' 마일리지')}</span> {tt('차감하고 시작할게요.')}
                <br />{tt('지금부터 달리는 모든 km 이 이 코스에 쌓여요.')}
              </p>
            </div>

            {/* build 229.B: 왜 달리는가 (optional) — 완주 시 회상 모먼트로 활용 */}
            <div className="mb-4">
              <label className="text-[11px] font-extrabold text-[var(--muted)] uppercase tracking-widest block mb-1.5">
                💭 {tt('왜 달리고 있나요?')} <span className="text-[10px] opacity-60 normal-case">({tt('선택')})</span>
              </label>
              <textarea
                value={motivationText}
                onChange={(e) => setMotivationText(e.target.value.slice(0, 80))}
                placeholder={tt('예: 60세 생일 기념으로 / 살을 빼기 위해 / 친구와의 약속')}
                rows={2}
                className="w-full text-sm rounded-xl border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 placeholder:text-[var(--muted)]/60 focus:outline-none focus:border-emerald-400 resize-none"
              />
              <p className="text-[10px] text-[var(--muted)] mt-1">{tt('완주 시 이 문장을 다시 보여드릴게요')}</p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => { setConfirmStart(null); setMotivationText(''); }}
                disabled={starting === confirmStart.id}
                className="flex-1 py-3 rounded-xl bg-[var(--card-border)]/30 font-semibold text-sm disabled:opacity-50"
              >
                {tt('취소')}
              </button>
              <button
                onClick={() => handleStart(confirmStart.id)}
                disabled={starting === confirmStart.id}
                className="flex-1 py-3 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-sm disabled:opacity-50 active:scale-95"
              >
                {starting === confirmStart.id ? tt('차감 중…') : tt('출발! 🚀')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 코스 상세 sheet */}
      {detailCourseId && (
        <CourseDetailSheet
          courseId={detailCourseId}
          onClose={() => { setDetailCourseId(null); load(); }}
          onStartCourse={(c) => { setDetailCourseId(null); setConfirmStart(c); }}
        />
      )}

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2200} />}
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-extrabold mb-2.5 inline-flex items-center gap-1.5">{icon}{title}</h2>
      {children}
    </section>
  );
}

function ProgressCard({ course, path }: { course: MyCourse; path: PreviewPoint[] | null }) {
  // build 207: locale-aware 라벨. tt 는 useI18n hook 안에서만 — 직접 useI18n 사용.
  const { tt } = useI18n();
  const pct = Math.min(100, (course.progress_km / course.distance_km) * 100);
  const remain = Math.max(0, course.distance_km - course.progress_km);
  const ratio = Math.min(1, course.progress_km / course.distance_km);
  // build 167 #5: 100% 도달 시 성취감 디자인 — 큰 그라데이션 카드 + ✨ 메달 받기 CTA.
  const isCompleted = pct >= 100;
  return (
    <div className={`rounded-2xl overflow-hidden border ${isCompleted
      ? 'bg-gradient-to-br from-amber-50 via-orange-50 to-amber-50 dark:from-amber-950/30 dark:via-orange-950/30 dark:to-amber-950/30 border-amber-300 dark:border-amber-700 shadow-lg shadow-amber-500/20'
      : 'bg-[var(--card)] border-[var(--card-border)]'
    }`}>
      {/* 지도 미리보기 + 러너 위치 마커 */}
      <CoursePreview path={path} progress={ratio} />
      <div className="p-4">
        <div className="flex items-baseline justify-between gap-2 mb-0.5">
          <p className="text-base font-extrabold truncate">{tt(course.name)}</p>
          <span className="text-xs text-[var(--muted)] flex-shrink-0 font-semibold">{course.country ? tt(course.country) : ''}</span>
        </div>
        <p className="text-xs text-[var(--muted)] font-semibold">
          {course.progress_km.toFixed(1)} / {course.distance_km.toFixed(1)} km
        </p>

        {isCompleted ? (
          // build 167 #5: 완주 — 메달·축하 디자인. 진입(자세히)으로 가서 메달 발급 신청.
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md shadow-amber-500/30">
              <Trophy size={18} className="drop-shadow" />
              <span className="text-sm font-extrabold drop-shadow">{tt('🎉 완주했어요! 메달이 기다려요')}</span>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <div className="h-2.5 rounded-full bg-[var(--card-border)]/30 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all duration-700 ease-out" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex items-center justify-between mt-1.5 text-xs">
              <span className="text-emerald-600 font-extrabold">{pct.toFixed(0)}%</span>
              <span className="text-[var(--muted)] font-semibold">{tt('남은 거리 ')}{remain.toFixed(1)}km</span>
            </div>
          </div>
        )}
        {/* build 252: 같이 달리는 친구 진행률 */}
        <CourseFriendsRow
          courseId={course.course_id}
          courseDistanceKm={course.distance_km}
          myProgressKm={course.progress_km}
        />
      </div>
    </div>
  );
}
