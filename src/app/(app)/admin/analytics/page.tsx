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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !isAdmin) { router.replace('/'); return; }
  }, [authLoading, user, isAdmin, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const [ov, su, ad, rt, act, hm, top] = await Promise.all([
        supabase.rpc('admin_analytics_overview'),
        supabase.rpc('admin_analytics_signups_daily', { p_days: 30 }),
        supabase.rpc('admin_analytics_activity_daily', { p_days: 30 }),
        supabase.rpc('admin_analytics_retention'),
        supabase.rpc('admin_analytics_activation'),
        supabase.rpc('admin_analytics_hour_heatmap'),
        supabase.rpc('admin_analytics_top_content', { p_limit: 5 }),
      ]);
      if (ov.data) setOverview(ov.data as Overview);
      if (su.data) setSignups((su.data as { day: string; count: number }[]).map(r => ({ day: String(r.day).slice(5), count: r.count })));
      if (ad.data) setActivityDaily((ad.data as { day: string; dau: number; runs: number; km: number }[]).map(r => ({ day: String(r.day).slice(5), dau: r.dau, runs: r.runs, km: Number(r.km) })));
      if (rt.data) setRetention(rt.data as Retention);
      if (act.data) setActivation(act.data as Activation);
      if (hm.data) setHourMap(hm.data as HourRow[]);
      if (top.data) setTopContent(top.data as TopContent);
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
                <Stat label="유저 명언" value={overview.content.user_quotes_total.toLocaleString()} />
                <Stat label="명언 (7일)" value={`+${overview.content.user_quotes_7d}`} tone="emerald" />
                <Stat label="친선런 누적" value={overview.content.contests_total.toLocaleString()} />
                <Stat label="월드런 시작" value={overview.content.world_starts.toLocaleString()} />
                <Stat label="월드런 완주" value={overview.content.world_completes.toLocaleString()} tone="amber" />
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
            <Section title="좋아요 받은 명언 top 5" icon={<Heart size={14} className="text-rose-500" />}>
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
