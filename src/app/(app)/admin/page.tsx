'use client';

// 어드민 메인 대시보드 — 모던 모바일 UX/UI (에메랄드 그린).
// hans@openhan.kr 만 접근.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, ShoppingBag, Users, Package, AlertCircle, ChevronRight,
  Beaker, Coins, TrendingUp, Sparkles, Settings, Stethoscope, Globe, MessageSquare, Award, BarChart3, Trophy,
} from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

import { isAdminEmail } from '@/lib/admin-emails';

interface DashboardStats {
  revenue: { today: number; week: number; month: number; all_time: number };
  orders: { today: number; week: number; month: number; pending: number; paid_unfulfilled: number; shipped_unfulfilled: number };
  users: { total: number; new_today: number; new_week: number };
  products: { published: number; draft: number; out_of_stock: number; low_stock: number };
  daily_revenue_14d: { day: string; krw: number }[];
}

interface KpiExtended {
  refund: { rate_30d: number; refunded_count_30d: number; paid_count_30d: number };
  aov: { avg_order_30d: number; max_order_30d: number };
  categories_30d: { category: string; krw: number; orders: number }[];
  top_products_30d: { product_name: string; units: number; krw: number }[];
  cart: { users_with_cart: number; total_items: number };
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [kpi, setKpi] = useState<KpiExtended | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    if (!isAdmin) { router.replace('/'); return; }
  }, [authLoading, user, isAdmin, router]);

  useEffect(() => {
    if (!isAdmin) return;
    const supabase = getSupabase();
    let cancelled = false;
    // 15s timeout 안전망 — RPC 가 hang 되어도 사용자가 "loading…" 에 갇히지 않게.
    const timeoutId = setTimeout(() => { if (!cancelled) setLoading(false); }, 15000);
    (async () => {
      try {
        const [base, ext] = await Promise.all([
          supabase.rpc('admin_dashboard_stats'),
          supabase.rpc('admin_kpi_extended'),
        ]);
        if (cancelled) return;
        if (base.error) console.warn('[admin/dash] base fail', base.error);
        else setStats(base.data as DashboardStats);
        if (ext.error) console.warn('[admin/dash] kpi fail', ext.error);
        else setKpi(ext.data as KpiExtended);
      } catch (e) {
        console.warn('[admin/dash] fetch fail', e);
      } finally {
        clearTimeout(timeoutId);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [isAdmin]);

  if (authLoading || !isAdmin) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const chartData = stats?.daily_revenue_14d?.map(d => ({
    label: new Date(d.day).getDate().toString(),
    krw: d.krw,
  })) ?? [];

  return (
    <div className="max-w-2xl mx-auto pb-12 bg-[var(--background)] min-h-screen">
      {/* Sticky Header */}
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-extrabold tracking-tight flex-1">어드민</h1>
          <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40">
            ADMIN
          </span>
        </div>
      </header>

      {loading ? (
        <div className="px-4 pt-4 space-y-3">
          {[0,1,2,3].map(i => (
            <div key={i} className="card p-5 animate-pulse">
              <div className="h-3 w-1/3 bg-[var(--card-border)]/50 rounded mb-3" />
              <div className="h-8 w-2/3 bg-[var(--card-border)]/50 rounded" />
            </div>
          ))}
        </div>
      ) : stats && (
        <>
          {/* Hero — 오늘 매출 */}
          <section className="px-4 pt-4">
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-teal-600 p-6 shadow-lg shadow-emerald-500/30">
              <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
              <div className="absolute -bottom-16 -left-8 w-32 h-32 rounded-full bg-emerald-300/30 blur-xl" />
              <div className="relative">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 backdrop-blur-sm mb-3">
                  <Sparkles size={11} className="text-white" />
                  <span className="text-[10px] font-extrabold text-white tracking-widest">TODAY REVENUE</span>
                </div>
                <p className="text-4xl font-extrabold text-white tracking-tight">
                  {stats.revenue.today.toLocaleString()}<span className="text-xl ml-1">원</span>
                </p>
                <div className="grid grid-cols-3 gap-2 mt-5 pt-5 border-t border-white/20">
                  <SmallStat label="이번 주" value={`${(stats.revenue.week / 10000).toFixed(0)}만`} dark />
                  <SmallStat label="이번 달" value={`${(stats.revenue.month / 10000).toFixed(0)}만`} dark />
                  <SmallStat label="총 매출" value={`${(stats.revenue.all_time / 10000).toFixed(0)}만`} dark />
                </div>
              </div>
            </div>
          </section>

          {/* 14일 매출 추이 */}
          {chartData.length > 0 && (
            <Section title="14일 매출 추이" icon={<TrendingUp size={16} className="text-emerald-500" />}>
              <div className="card p-4">
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={chartData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval={1} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: 'var(--card)', border: '1px solid var(--card-border)', borderRadius: 12, fontSize: 12 }}
                      formatter={(v) => [`${Number(v).toLocaleString()}원`, '매출']}
                    />
                    <Bar dataKey="krw" fill="#10B981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Section>
          )}

          {/* 주문 현황 */}
          <Section title="주문 현황" icon={<ShoppingBag size={16} className="text-emerald-500" />} action={
            <Link href="/admin/orders" className="text-xs font-bold text-emerald-600 inline-flex items-center gap-0.5 active:scale-95">
              관리 <ChevronRight size={12} />
            </Link>
          }>
            <div className="card p-4">
              <div className="grid grid-cols-3 gap-2">
                <Stat label="오늘" value={`${stats.orders.today}`} unit="건" />
                <Stat label="이번 주" value={`${stats.orders.week}`} unit="건" />
                <Stat label="이번 달" value={`${stats.orders.month}`} unit="건" />
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-[var(--card-border)]/40">
                <Stat label="결제 대기" value={`${stats.orders.pending}`} unit="건" tone={stats.orders.pending > 0 ? 'amber' : 'mute'} />
                <Stat label="발송 대기" value={`${stats.orders.paid_unfulfilled}`} unit="건" tone={stats.orders.paid_unfulfilled > 0 ? 'red' : 'mute'} />
                <Stat label="배송 중" value={`${stats.orders.shipped_unfulfilled}`} unit="건" tone="blue" />
              </div>
            </div>
          </Section>

          {/* 상품 현황 */}
          <Section title="상품 현황" icon={<Package size={16} className="text-emerald-500" />} action={
            <Link href="/admin/products" className="text-xs font-bold text-emerald-600 inline-flex items-center gap-0.5 active:scale-95">
              관리 <ChevronRight size={12} />
            </Link>
          }>
            <div className="card p-4">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="판매중" value={`${stats.products.published}`} unit="개" tone="emerald" />
                <Stat label="임시저장" value={`${stats.products.draft}`} unit="개" tone="mute" />
                <Stat label="품절" value={`${stats.products.out_of_stock}`} unit="개" tone={stats.products.out_of_stock > 0 ? 'red' : 'mute'} />
                <Stat label="재고 5↓" value={`${stats.products.low_stock}`} unit="개" tone={stats.products.low_stock > 0 ? 'amber' : 'mute'} />
              </div>
              {(stats.products.out_of_stock + stats.products.low_stock) > 0 && (
                <div className="mt-3 pt-3 border-t border-[var(--card-border)]/40 inline-flex items-center gap-1.5 text-xs text-amber-600 font-bold">
                  <AlertCircle size={12} /> 재고 보충이 필요한 상품이 있어요
                </div>
              )}
            </div>
          </Section>

          {/* 사용자 */}
          <Section title="사용자" icon={<Users size={16} className="text-emerald-500" />}>
            <div className="card p-4 grid grid-cols-3 gap-2">
              <Stat label="총 가입" value={`${stats.users.total}`} unit="명" />
              <Stat label="오늘 신규" value={`+${stats.users.new_today}`} tone="emerald" />
              <Stat label="이번 주 신규" value={`+${stats.users.new_week}`} tone="emerald" />
            </div>
          </Section>

          {/* KPI 확장 — 환불률 / AOV / 카테고리 매출 */}
          {kpi && (
            <>
              <Section title="30일 KPI" icon={<TrendingUp size={16} className="text-emerald-500" />}>
                <div className="card p-4 grid grid-cols-3 gap-3">
                  <Stat
                    label="환불률"
                    value={`${(kpi.refund.rate_30d * 100).toFixed(1)}%`}
                    tone={kpi.refund.rate_30d > 0.05 ? 'red' : kpi.refund.rate_30d > 0 ? 'amber' : 'emerald'}
                  />
                  <Stat
                    label="평균 주문"
                    value={`${(kpi.aov.avg_order_30d / 1000).toFixed(1)}k`}
                    unit="원"
                  />
                  <Stat
                    label="장바구니"
                    value={`${kpi.cart.users_with_cart}`}
                    unit="명"
                    tone="blue"
                  />
                </div>
              </Section>

              {kpi.categories_30d.length > 0 && (
                <Section title="카테고리별 매출 (30일)" icon={<Package size={16} className="text-emerald-500" />}>
                  <div className="card p-4 space-y-2">
                    {kpi.categories_30d.slice(0, 5).map(c => {
                      const top = kpi.categories_30d[0]?.krw || 1;
                      const pct = Math.round((c.krw / top) * 100);
                      return (
                        <div key={c.category}>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="font-bold text-[var(--foreground)]">{c.category}</span>
                            <span className="text-[var(--muted)]">{c.krw.toLocaleString()}원 · {c.orders}건</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Section>
              )}

              {kpi.top_products_30d.length > 0 && (
                <Section title="인기 상품 TOP 5 (30일)" icon={<Sparkles size={16} className="text-emerald-500" />}>
                  <div className="card p-4 space-y-2">
                    {kpi.top_products_30d.map((p, i) => (
                      <div key={p.product_name} className="flex items-center gap-3 text-xs">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center font-extrabold text-[10px] ${
                          i === 0 ? 'bg-amber-100 text-amber-700' :
                          i === 1 ? 'bg-zinc-200 text-zinc-700' :
                          i === 2 ? 'bg-orange-100 text-orange-700' :
                          'bg-[var(--card-border)]/40 text-[var(--muted)]'
                        }`}>
                          {i + 1}
                        </span>
                        <span className="flex-1 font-bold text-[var(--foreground)] line-clamp-1">{p.product_name}</span>
                        <span className="text-[var(--muted)]">{p.units}개</span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </>
          )}

          {/* 어드민 메뉴 */}
          <Section title="관리 메뉴" icon={<Settings size={16} className="text-emerald-500" />}>
            <div className="grid grid-cols-2 gap-2">
              <AdminLink href="/admin/analytics" icon={<BarChart3 size={20} />} label="분석 대시보드" />
              <AdminLink href="/admin/users" icon={<Users size={20} />} label="회원 관리" />
              <AdminLink href="/admin/feedback" icon={<MessageSquare size={20} />} label="제안 모더레이션" />
              <AdminLink href="/admin/medals" icon={<Award size={20} />} label="메달 신청" />
              <AdminLink href="/admin/series-medals" icon={<Trophy size={20} />} label="시리즈 메달" />
              <AdminLink href="/admin/courses" icon={<Globe size={20} />} label="가상 코스" />
              <AdminLink href="/admin/series" icon={<Trophy size={20} />} label="챌린지 시리즈" />
              <AdminLink href="/admin/orders" icon={<ShoppingBag size={20} />} label="주문 관리" />
              <AdminLink href="/admin/products" icon={<Package size={20} />} label="상품 관리" />
              <AdminLink href="/admin/mileage" icon={<Coins size={20} />} label="마일리지 정책" />
              <AdminLink href="/admin/experiments" icon={<Beaker size={20} />} label="A/B 실험" />
              <AdminLink href="/profile/audit" icon={<Stethoscope size={20} />} label="데이터 점검" />
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

function Section({ title, icon, action, children }: { title: string; icon?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="px-4 mt-5">
      <div className="flex items-center justify-between mb-2.5">
        <h2 className="text-sm font-extrabold inline-flex items-center gap-1.5">{icon}{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, unit, tone = 'default' }: { label: string; value: string; unit?: string; tone?: 'default' | 'emerald' | 'amber' | 'red' | 'blue' | 'mute' }) {
  const colorClass = {
    default: 'text-[var(--foreground)]',
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
    red: 'text-red-500',
    blue: 'text-blue-500',
    mute: 'text-[var(--muted)]',
  }[tone];
  return (
    <div>
      <p className="text-[10px] text-[var(--muted)] font-medium mb-0.5">{label}</p>
      <p className={`text-base font-extrabold ${colorClass}`}>
        {value}
        {unit && <span className="text-xs font-bold ml-0.5 opacity-70">{unit}</span>}
      </p>
    </div>
  );
}

function SmallStat({ label, value, dark }: { label: string; value: string; dark?: boolean }) {
  return (
    <div>
      <p className={`text-[10px] font-medium ${dark ? 'text-white/70' : 'text-[var(--muted)]'}`}>{label}</p>
      <p className={`text-base font-extrabold ${dark ? 'text-white' : 'text-[var(--foreground)]'}`}>{value}</p>
    </div>
  );
}

function AdminLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="card p-4 flex items-center gap-2.5 active:scale-[0.97] transition group hover:border-emerald-200 dark:hover:border-emerald-900/40"
    >
      <div className="w-10 h-10 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center text-emerald-600">
        {icon}
      </div>
      <span className="text-sm font-bold flex-1">{label}</span>
      <ChevronRight size={14} className="text-[var(--muted)] group-active:translate-x-0.5 transition" />
    </Link>
  );
}
