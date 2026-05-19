'use client';

// 어드민 — 분석 대시보드 (build 114).
// Amplitude/Mixpanel 식 핵심 KPI: 회원·활성·콘텐츠·리텐션·시간대·인기.

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, BarChart3, Users, Activity, TrendingUp, Camera, MessageSquare,
  Trophy, Globe, Award, Clock, Zap, AlertCircle, ChevronRight, Heart,
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell,
} from 'recharts';
import { useAuth } from '@/components/AuthProvider';
import { isAdminEmail } from '@/lib/admin-emails';
import { getSupabase } from '@/lib/supabase';

interface Overview {
  users: { total: number; new_today: number; new_7d: number; new_30d: number };
  active: { dau: number; wau: number; mau: number; churned_14d: number };
  activity: { runs_today: number; km_today: number; runs_7d: number; km_7d: number; runs_30d: number; km_30d: number };
  content: {
    photos_total: number; photos_7d: number;
    user_quotes_total: number; user_quotes_7d: number;
    feedback_total: number; feedback_open: number;
    contests_total: number; world_starts: number; world_completes: number;
    medals_requested: number;
  };
  engagement: { photo_likes: number; photo_comments: number };
}

interface SignupRow { day: string; count: number; }
interface ActivityRow { day: string; dau: number; runs: number; km: number; }
interface Retention { cohort_size: number; d1: number; d7: number; d30: number; }
interface HourRow { hour: number; runs: number; }
interface Activation { total: number; activated: number; never_ran: number; activated_within_1d: number; activated_within_7d: number; }
interface TopPhoto { id: string; photo_url: string; display_name: string; like_count: number; created_at: string; }
interface TopQuote { id: string; text: string; author: string; like_count: number; created_at: string; }
interface TopRunner { display_name: string; avatar_url: string | null; runs: number; total_km: number; }
interface TopContent { photos: TopPhoto[] | null; quotes: TopQuote[] | null; top_runners_30d: TopRunner[] | null; }

interface EventRow { event_name: string; n: number; }
interface PathRow { path: string; views: number; unique_users: number; }
interface EventsSummary {
  total_events: number;
  unique_users: number;
  top_events: EventRow[] | null;
  top_paths: PathRow[] | null;
}
interface Funnel {
  signup: number;
  first_run: number;
  first_photo: number;
  first_friend: number;
  first_world_start: number;
  first_world_complete: number;
  first_medal_request: number;
}

interface WeeklyReport {
  new_users: { this: number; prev: number };
  active_users: { this: number; prev: number };
  runs: { this: number; prev: number };
  km: { this: number; prev: number };
  photos: { this: number; prev: number };
  feedback: { this: number; prev: number };
  contests: { this: number; prev: number };
}

export default function AdminAnalyticsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [signups, setSignups] = useState<SignupRow[]>([]);
  const [activityDaily, setActivityDaily] = useState<ActivityRow[]>([]);
  const [retention, setRetention] = useState<Retention | null>(null);
  const [activation, setActivation] = useState<Activation | null>(null);
  const [hourMap, setHourMap] = useState<HourRow[]>([]);
  const [topContent, setTopContent] = useState<TopContent | null>(null);
  const [eventsSummary, setEventsSummary] = useState<EventsSummary | null>(null);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [weekly, setWeekly] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !isAdmin) { router.replace('/'); return; }
  }, [authLoading, user, isAdmin, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const [ov, su, ad, rt, act, hm, top, ev, fn, wk] = await Promise.all([
        supabase.rpc('admin_analytics_overview'),
        supabase.rpc('admin_analytics_signups_daily', { p_days: 30 }),
        supabase.rpc('admin_analytics_activity_daily', { p_days: 30 }),
        supabase.rpc('admin_analytics_retention'),
        supabase.rpc('admin_analytics_activation'),
        supabase.rpc('admin_analytics_hour_heatmap'),
        supabase.rpc('admin_analytics_top_content', { p_limit: 5 }),
        supabase.rpc('admin_analytics_events_summary', { p_days: 7 }),
        supabase.rpc('admin_analytics_funnel'),
        supabase.rpc('admin_weekly_report'),
      ]);
      if (ov.data) setOverview(ov.data as Overview);
      if (su.data) setSignups((su.data as { day: string; count: number }[]).map(r => ({ day: String(r.day).slice(5), count: r.count })));
      if (ad.data) setActivityDaily((ad.data as { day: string; dau: number; runs: number; km: number }[]).map(r => ({ day: String(r.day).slice(5), dau: r.dau, runs: r.runs, km: Number(r.km) })));
      if (rt.data) setRetention(rt.data as Retention);
      if (act.data) setActivation(act.data as Activation);
      if (hm.data) setHourMap(hm.data as HourRow[]);
      if (top.data) setTopContent(top.data as TopContent);
      if (ev.data) setEventsSummary(ev.data as EventsSummary);
      if (fn.data) setFunnel(fn.data as Funnel);
      if (wk.data) setWeekly(wk.data as WeeklyReport);
    } catch (e) {
      console.warn('[admin/analytics] fail', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  if (!isAdmin) return null;

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/85 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <Link href="/admin" className="w-10 h-10 flex items-center justify-center rounded-full active:bg-[var(--card-border)]/30">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-xl font-extrabold tracking-tight inline-flex items-center gap-1.5">
            <BarChart3 size={18} className="text-emerald-500" /> 분석 대시보드
          </h1>
          <button
            onClick={load}
            className="ml-auto text-xs font-bold text-emerald-600 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 active:scale-95"
          >
            새로고침
          </button>
        </div>
      </header>

      {loading && !overview ? (
        <div className="p-4 space-y-3">
          {[0,1,2,3,4].map(i => <div key={i} className="card p-4 h-24 animate-pulse" />)}
        </div>
      ) : (
        <div className="p-4 space-y-5">
          {/* 회원 KPI */}
          {overview && (
            <Section title="회원" icon={<Users size={14} className="text-emerald-500" />}>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="전체 회원" value={overview.users.total.toLocaleString()} tone="emerald" />
                <Stat label="오늘 가입" value={`+${overview.users.new_today}`} tone="emerald" />
                <Stat label="7일 신규" value={`+${overview.users.new_7d}`} />
                <Stat label="30일 신규" value={`+${overview.users.new_30d}`} />
              </div>
            </Section>
          )}

          {/* 일별 가입 차트 */}
          {signups.length > 0 && (
            <Section title="일별 신규 가입 (30일)" icon={<TrendingUp size={14} className="text-emerald-500" />}>
              <div className="card p-4">
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={signups}>
                    <XAxis dataKey="day" tick={{ fontSize: 9 }} interval={4} />
                    <YAxis tick={{ fontSize: 9 }} width={20} allowDecimals={false} />
                    <Tooltip cursor={{ fill: 'rgba(16,185,129,0.1)' }} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                    <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Section>
          )}

          {/* 활성도 */}
          {overview && (
            <Section title="활성 사용자" icon={<Zap size={14} className="text-amber-500" />}>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="DAU (오늘)" value={overview.active.dau.toLocaleString()} tone="emerald" />
                <Stat label="WAU (7일)" value={overview.active.wau.toLocaleString()} />
                <Stat label="MAU (30일)" value={overview.active.mau.toLocaleString()} />
                <Stat label="14일 미접속" value={overview.active.churned_14d.toLocaleString()} tone="red" />
              </div>
              {overview.active.mau > 0 && (
                <p className="text-[11px] text-[var(--muted)] mt-2 font-bold inline-flex items-center gap-1">
                  DAU/MAU 끈끈함 (Stickiness):
                  <span className="text-emerald-600">
                    {((overview.active.dau / overview.active.mau) * 100).toFixed(0)}%
                  </span>
                </p>
              )}
            </Section>
          )}

          {/* 일별 활동 차트 */}
          {activityDaily.length > 0 && (
            <Section title="일별 활동 (DAU + km)" icon={<Activity size={14} className="text-emerald-500" />}>
              <div className="card p-4">
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={activityDaily}>
                    <XAxis dataKey="day" tick={{ fontSize: 9 }} interval={4} />
                    <YAxis tick={{ fontSize: 9 }} width={20} allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                    <Line type="monotone" dataKey="dau" stroke="#10b981" strokeWidth={2.5} dot={false} name="DAU" />
                    <Line type="monotone" dataKey="runs" stroke="#f97316" strokeWidth={2} dot={false} name="활동수" />
                  </LineChart>
                </ResponsiveContainer>
                <div className="flex items-center justify-center gap-3 mt-2 text-[10px] font-bold">
                  <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> DAU</span>
                  <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500" /> 활동수</span>
                </div>
              </div>
            </Section>
          )}

          {/* 활성화율 (가입 → 첫 활동) */}
          {activation && (
            <Section title="활성화 (가입 → 첫 활동)" icon={<Zap size={14} className="text-violet-500" />}>
              <div className="card p-4">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <FunnelStep label="가입자" value={activation.total} pct={100} />
                  <FunnelStep label="1일 내 첫 달림" value={activation.activated_within_1d} pct={pct(activation.activated_within_1d, activation.total)} />
                  <FunnelStep label="7일 내 첫 달림" value={activation.activated_within_7d} pct={pct(activation.activated_within_7d, activation.total)} />
                </div>
                <div className="mt-3 px-3 py-2 rounded-lg bg-rose-50 dark:bg-rose-950/30 text-[11px] text-rose-700 dark:text-rose-300 inline-flex items-center gap-1.5 w-full">
                  <AlertCircle size={11} /> 한 번도 달리지 않은 사용자: <b>{activation.never_ran.toLocaleString()}명</b>
                </div>
              </div>
            </Section>
          )}

          {/* 리텐션 */}
          {retention && retention.cohort_size > 0 && (
            <Section title="리텐션 (30일 이전 가입자 기준)" icon={<TrendingUp size={14} className="text-blue-500" />}>
              <div className="card p-4">
                <div className="grid grid-cols-4 gap-2 text-center">
                  <FunnelStep label="가입 (D0)" value={retention.cohort_size} pct={100} />
                  <FunnelStep label="D1 활동" value={retention.d1} pct={pct(retention.d1, retention.cohort_size)} />
                  <FunnelStep label="D7 활동" value={retention.d7} pct={pct(retention.d7, retention.cohort_size)} />
                  <FunnelStep label="D30 활동" value={retention.d30} pct={pct(retention.d30, retention.cohort_size)} />
                </div>
              </div>
            </Section>
          )}

          {/* 시간대별 활동 */}
          {hourMap.length > 0 && (
            <Section title="시간대별 활동 (30일, KST)" icon={<Clock size={14} className="text-emerald-500" />}>
              <div className="card p-4">
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={hourMap}>
                    <XAxis dataKey="hour" tick={{ fontSize: 9 }} tickFormatter={(h) => `${h}시`} interval={2} />
                    <YAxis tick={{ fontSize: 9 }} width={20} allowDecimals={false} />
                    <Tooltip cursor={{ fill: 'rgba(16,185,129,0.1)' }} contentStyle={{ fontSize: 11, borderRadius: 8 }} labelFormatter={(h) => `${h}시`} />
                    <Bar dataKey="runs" radius={[4, 4, 0, 0]}>
                      {hourMap.map((entry) => (
                        <Cell key={entry.hour} fill={peakColor(entry, hourMap)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="text-[10px] text-[var(--muted)] mt-1 text-center">색이 진할수록 인기 시간</p>
              </div>
            </Section>
          )}

          {/* 활동 통계 */}
          {overview && (
            <Section title="활동" icon={<Activity size={14} className="text-emerald-500" />}>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="오늘 활동" value={overview.activity.runs_today.toLocaleString()} unit="회" tone="emerald" />
                <Stat label="오늘 km" value={overview.activity.km_today.toLocaleString()} unit="km" tone="emerald" />
                <Stat label="7일 활동" value={overview.activity.runs_7d.toLocaleString()} unit="회" />
                <Stat label="7일 km" value={overview.activity.km_7d.toLocaleString()} unit="km" />
                <Stat label="30일 활동" value={overview.activity.runs_30d.toLocaleString()} unit="회" />
                <Stat label="30일 km" value={overview.activity.km_30d.toLocaleString()} unit="km" />
              </div>
            </Section>
          )}

          {/* 콘텐츠 */}
          {overview && (
            <Section title="콘텐츠" icon={<Camera size={14} className="text-emerald-500" />}>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="루틴포토 (전체)" value={overview.content.photos_total.toLocaleString()} />
                <Stat label="포토 (7일)" value={`+${overview.content.photos_7d}`} tone="emerald" />
                <Stat label="러너 한 줄" value={overview.content.user_quotes_total.toLocaleString()} />
                <Stat label="러너 한 줄 (7일)" value={`+${overview.content.user_quotes_7d}`} tone="emerald" />
                <Stat label="친선런 누적" value={overview.content.contests_total.toLocaleString()} />
                <Stat label="월드마라톤 시작" value={overview.content.world_starts.toLocaleString()} />
                <Stat label="월드마라톤 완주" value={overview.content.world_completes.toLocaleString()} tone="amber" />
                <Stat label="메달 신청" value={overview.content.medals_requested.toLocaleString()} tone="amber" />
              </div>
            </Section>
          )}

          {/* 제안 게시판 / 인게이지먼트 */}
          {overview && (
            <Section title="피드백 + 인게이지먼트" icon={<MessageSquare size={14} className="text-blue-500" />}>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="제안 전체" value={overview.content.feedback_total.toLocaleString()} />
                <Stat label="처리 대기" value={overview.content.feedback_open.toLocaleString()} tone={overview.content.feedback_open > 0 ? 'amber' : 'mute'} />
                <Stat label="포토 좋아요" value={overview.engagement.photo_likes.toLocaleString()} tone="rose" />
                <Stat label="포토 댓글" value={overview.engagement.photo_comments.toLocaleString()} />
              </div>
            </Section>
          )}

          {/* 인기 콘텐츠 top */}
          {topContent && (topContent.top_runners_30d?.length ?? 0) > 0 && (
            <Section title="이달 러닝 top 5" icon={<Trophy size={14} className="text-amber-500" />}>
              <div className="card p-3 space-y-1.5">
                {topContent.top_runners_30d!.map((r, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center font-extrabold text-[11px] ${
                      i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-zinc-200 text-zinc-700' : i === 2 ? 'bg-orange-100 text-orange-700' : 'bg-[var(--card-border)]/40 text-[var(--muted)]'
                    }`}>{i + 1}</span>
                    <div className="w-7 h-7 rounded-full bg-[var(--card-border)]/40 overflow-hidden flex-shrink-0">
                      {r.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] font-bold text-[var(--muted)]">{r.display_name?.slice(0,1)}</div>
                      )}
                    </div>
                    <span className="flex-1 text-sm font-bold truncate">{r.display_name}</span>
                    <span className="text-xs text-[var(--muted)]">{r.runs}회</span>
                    <span className="text-sm font-extrabold text-emerald-600 tabular-nums">{Number(r.total_km).toFixed(1)}km</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {topContent?.quotes && topContent.quotes.length > 0 && (
            <Section title="좋아요 받은 러너 한 줄 top 5" icon={<Heart size={14} className="text-rose-500" />}>
              <div className="card p-3 space-y-2">
                {topContent.quotes.map((q) => (
                  <div key={q.id} className="px-2 py-1.5 border-l-2 border-emerald-400 bg-emerald-50/30 dark:bg-emerald-950/20 rounded-r-lg">
                    <p className="text-xs italic font-semibold line-clamp-2 break-keep">&ldquo;{q.text}&rdquo;</p>
                    <p className="text-[10px] text-[var(--muted)] mt-0.5">— {q.author} · ❤️ {q.like_count}</p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* 위클리 리포트 (build 119) — 이번주 vs 지난주 변화 */}
          {weekly && (
            <Section title="위클리 리포트 (vs 지난 7일)" icon={<TrendingUp size={14} className="text-emerald-500" />}>
              <div className="grid grid-cols-2 gap-2">
                <WeeklyCard label="신규 가입" this_={weekly.new_users.this} prev={weekly.new_users.prev} />
                <WeeklyCard label="활성 유저" this_={weekly.active_users.this} prev={weekly.active_users.prev} />
                <WeeklyCard label="활동 수" this_={weekly.runs.this} prev={weekly.runs.prev} />
                <WeeklyCard label="총 km" this_={weekly.km.this} prev={weekly.km.prev} unit="km" />
                <WeeklyCard label="포토" this_={weekly.photos.this} prev={weekly.photos.prev} />
                <WeeklyCard label="친선런" this_={weekly.contests.this} prev={weekly.contests.prev} />
              </div>
              {weekly.feedback.this > 0 && (
                <div className="card p-3 mt-2 inline-flex items-center gap-2 w-full">
                  <MessageSquare size={14} className="text-blue-500" />
                  <span className="text-xs font-bold flex-1">제안 게시판 신규 글</span>
                  <span className="text-sm font-extrabold text-emerald-600">{weekly.feedback.this}건</span>
                  <span className="text-[10px] text-[var(--muted)]">(지난주 {weekly.feedback.prev})</span>
                </div>
              )}
              <WeeklySendButtons />
            </Section>
          )}

          {/* 사용자 여정 펀넬 (Phase B) — 가입부터 메달 신청까지 conversion */}
          {funnel && (
            <Section title="사용자 여정 펀넬" icon={<TrendingUp size={14} className="text-violet-500" />}>
              <div className="card p-3">
                {[
                  { label: '가입', value: funnel.signup, key: 'signup' },
                  { label: '첫 활동', value: funnel.first_run, key: 'first_run' },
                  { label: '첫 사진 공유', value: funnel.first_photo, key: 'first_photo' },
                  { label: '첫 친구', value: funnel.first_friend, key: 'first_friend' },
                  { label: '월드마라톤 시작', value: funnel.first_world_start, key: 'first_world_start' },
                  { label: '월드마라톤 완주', value: funnel.first_world_complete, key: 'first_world_complete' },
                  { label: '메달 신청', value: funnel.first_medal_request, key: 'first_medal_request' },
                ].map((step) => (
                  <div key={step.key} className="flex items-center gap-2 py-1.5">
                    <span className="text-xs font-bold text-[var(--muted)] w-24 flex-shrink-0">{step.label}</span>
                    <div className="flex-1 h-5 rounded-full bg-[var(--card-border)]/30 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-violet-600 transition-all" style={{ width: `${pct(step.value, funnel.signup)}%` }} />
                    </div>
                    <span className="text-xs font-extrabold tabular-nums w-10 text-right">{step.value.toLocaleString()}</span>
                    <span className="text-[10px] font-bold text-violet-600 w-9 text-right">{pct(step.value, funnel.signup)}%</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* 이벤트 추적 (Phase B) — top events + paths */}
          {eventsSummary && eventsSummary.total_events > 0 && (
            <Section title="이벤트 추적 (7일)" icon={<Zap size={14} className="text-amber-500" />}>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <Stat label="총 이벤트" value={eventsSummary.total_events.toLocaleString()} tone="amber" />
                <Stat label="추적된 사용자" value={eventsSummary.unique_users.toLocaleString()} />
              </div>
              {eventsSummary.top_paths && eventsSummary.top_paths.length > 0 && (
                <div className="card p-3 mb-2">
                  <p className="text-[11px] font-extrabold text-[var(--muted)] mb-1.5">인기 화면 (페이지뷰)</p>
                  <div className="space-y-1">
                    {eventsSummary.top_paths.slice(0, 10).map((p) => (
                      <div key={p.path} className="flex items-center gap-2">
                        <span className="text-xs font-mono truncate flex-1">{p.path}</span>
                        <span className="text-xs font-bold tabular-nums text-[var(--muted)]">{p.views.toLocaleString()}회</span>
                        <span className="text-[10px] font-bold tabular-nums text-emerald-600">{p.unique_users}명</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {eventsSummary.top_events && eventsSummary.top_events.length > 0 && (
                <div className="card p-3">
                  <p className="text-[11px] font-extrabold text-[var(--muted)] mb-1.5">자주 발생한 이벤트</p>
                  <div className="space-y-1">
                    {eventsSummary.top_events.slice(0, 10).map((e) => (
                      <div key={e.event_name} className="flex items-center gap-2">
                        <span className="text-xs font-mono truncate flex-1">{e.event_name}</span>
                        <span className="text-xs font-bold tabular-nums text-amber-600">{e.n.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Section>
          )}

          {/* 빠른 진입점 — 다른 어드민 페이지로 */}
          <Section title="빠른 진입점" icon={<ChevronRight size={14} className="text-emerald-500" />}>
            <div className="grid grid-cols-2 gap-2">
              <QuickLink href="/admin/users" label="회원 관리" Icon={Users} />
              <QuickLink href="/admin/feedback" label="제안 모더" Icon={MessageSquare} />
              <QuickLink href="/admin/medals" label="메달 신청" Icon={Award} />
              <QuickLink href="/admin/courses" label="가상 코스" Icon={Globe} />
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

function WeeklySendButtons() {
  const [webhook, setWebhook] = useState('');
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const supabase = getSupabase();
        const { data } = await supabase.rpc('admin_get_setting', { p_key: 'slack_webhook_url' });
        if (typeof data === 'string') setWebhook(data);
      } catch { /* ignore */ }
    })();
  }, []);

  const showMsg = (t: string) => { setMsg(t); setTimeout(() => setMsg(null), 2500); };

  const saveWebhook = async () => {
    try {
      const supabase = getSupabase();
      const { error } = await supabase.rpc('admin_set_setting', {
        p_key: 'slack_webhook_url',
        p_value: webhook.trim(),
        p_description: '위클리 리포트 발송용 슬랙 incoming webhook URL',
      });
      if (error) throw error;
      setEditing(false);
      showMsg('✨ 저장됨');
    } catch (e) {
      showMsg(e instanceof Error ? e.message : '저장 실패');
    }
  };

  const sendSlack = async () => {
    if (!webhook) { showMsg('webhook URL 먼저 설정하세요'); setEditing(true); return; }
    setSending(true);
    try {
      const supabase = getSupabase();
      const { data: text, error } = await supabase.rpc('admin_weekly_report_text');
      if (error) throw error;
      const r = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) throw new Error(`Slack ${r.status}`);
      showMsg('✅ 슬랙 발송 완료');
    } catch (e) {
      showMsg(e instanceof Error ? e.message : '발송 실패');
    } finally {
      setSending(false);
    }
  };

  const copyText = async () => {
    try {
      const supabase = getSupabase();
      const { data: text, error } = await supabase.rpc('admin_weekly_report_text');
      if (error) throw error;
      await navigator.clipboard.writeText(String(text));
      showMsg('📋 텍스트 복사됨');
    } catch (e) {
      showMsg(e instanceof Error ? e.message : '실패');
    }
  };

  return (
    <div className="card p-3 mt-2 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={sendSlack}
          disabled={sending}
          className="flex-1 py-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white font-extrabold text-xs disabled:opacity-50 active:scale-95"
        >
          {sending ? '발송 중…' : '슬랙 발송'}
        </button>
        <button
          onClick={copyText}
          className="flex-1 py-2.5 rounded-xl bg-[var(--card-border)]/40 font-bold text-xs active:scale-95"
        >
          텍스트 복사
        </button>
        <button
          onClick={() => setEditing(!editing)}
          className="px-3 py-2.5 rounded-xl text-xs font-bold text-[var(--muted)] active:scale-95"
        >
          ⚙
        </button>
      </div>
      {editing && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold text-[var(--muted)]">슬랙 Incoming Webhook URL</p>
          <input
            type="url"
            value={webhook}
            onChange={(e) => setWebhook(e.target.value)}
            placeholder="https://hooks.slack.com/services/..."
            className="w-full px-3 py-2 rounded-lg border-2 border-[var(--card-border)] bg-[var(--background)] text-xs font-mono focus:outline-none focus:border-violet-500"
          />
          <button
            onClick={saveWebhook}
            className="w-full py-2 rounded-lg bg-violet-500 text-white text-xs font-extrabold active:scale-95"
          >
            저장
          </button>
        </div>
      )}
      {msg && <p className="text-[11px] text-center font-bold text-emerald-600">{msg}</p>}
      <p className="text-[10px] text-[var(--muted)] leading-snug">
        자동 발송은 별도 pg_cron 또는 Vercel Cron 으로 매주 일요일 21:00 KST 에 admin_weekly_report_text() 결과를 webhook 에 POST 하면 됩니다.
      </p>
    </div>
  );
}

function WeeklyCard({ label, this_, prev, unit }: { label: string; this_: number; prev: number; unit?: string }) {
  const diff = Number(this_) - Number(prev);
  const pctDiff = prev > 0 ? Math.round((diff / prev) * 100) : (this_ > 0 ? 100 : 0);
  const tone = diff >= 0 ? 'text-emerald-600' : 'text-rose-500';
  return (
    <div className="card p-3">
      <p className="text-[10px] text-[var(--muted)] font-bold">{label}</p>
      <p className="text-lg font-extrabold mt-0.5 tabular-nums">
        {Number(this_).toLocaleString()}{unit && <span className="text-[10px] font-bold ml-0.5 opacity-70">{unit}</span>}
      </p>
      <p className={`text-[10px] font-extrabold mt-0.5 ${tone}`}>
        {diff >= 0 ? '▲' : '▼'} {Math.abs(diff).toLocaleString()} ({pctDiff > 0 ? '+' : ''}{pctDiff}%)
      </p>
    </div>
  );
}

function peakColor(row: HourRow, all: HourRow[]): string {
  const max = Math.max(...all.map(r => r.runs), 1);
  const ratio = row.runs / max;
  if (ratio > 0.66) return '#10b981';
  if (ratio > 0.33) return '#34d399';
  return '#a7f3d0';
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-extrabold mb-2 inline-flex items-center gap-1.5">{icon}{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value, unit, tone = 'default' }: { label: string; value: string; unit?: string; tone?: 'default' | 'emerald' | 'amber' | 'red' | 'rose' | 'mute' }) {
  const colorClass = {
    default: 'text-[var(--foreground)]',
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
    red: 'text-rose-500',
    rose: 'text-rose-500',
    mute: 'text-[var(--muted)]',
  }[tone];
  return (
    <div className="card p-3">
      <p className="text-[10px] text-[var(--muted)] font-bold">{label}</p>
      <p className={`text-xl font-extrabold mt-0.5 ${colorClass}`}>
        {value}
        {unit && <span className="text-[11px] font-bold ml-0.5 opacity-70">{unit}</span>}
      </p>
    </div>
  );
}

function FunnelStep({ label, value, pct }: { label: string; value: number; pct: number }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-[var(--muted)]">{label}</p>
      <p className="text-lg font-extrabold mt-0.5">{value.toLocaleString()}</p>
      <div className="mt-1 h-1 rounded-full bg-[var(--card-border)]/30 overflow-hidden">
        <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[10px] font-extrabold text-emerald-600 mt-0.5">{pct}%</p>
    </div>
  );
}

function QuickLink({ href, label, Icon }: { href: string; label: string; Icon: typeof Users }) {
  return (
    <Link href={href} className="card p-3 flex items-center gap-2 active:scale-[0.97]">
      <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center text-emerald-600">
        <Icon size={18} />
      </div>
      <span className="text-sm font-bold flex-1">{label}</span>
      <ChevronRight size={14} className="text-[var(--muted)]" />
    </Link>
  );
}
