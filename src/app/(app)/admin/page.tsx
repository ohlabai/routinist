'use client';

// 어드민 메인 대시보드 — 매출/주문/사용자/상품 KPI + 14일 매출 추이.
// hans@openhan.kr 만 접근.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ShoppingBag, Users, Package, AlertCircle, ChevronRight, Beaker, Coins } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

const ADMIN_EMAIL = 'hans@openhan.kr';

interface DashboardStats {
  revenue: { today: number; week: number; month: number; all_time: number };
  orders: { today: number; week: number; month: number; pending: number; paid_unfulfilled: number; shipped_unfulfilled: number };
  users: { total: number; new_today: number; new_week: number };
  products: { published: number; draft: number; out_of_stock: number; low_stock: number };
  daily_revenue_14d: { day: string; krw: number }[];
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = user?.email === ADMIN_EMAIL;

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    if (!isAdmin) { router.replace('/'); return; }
  }, [authLoading, user, isAdmin, router]);

  useEffect(() => {
    if (!isAdmin) return;
    const supabase = getSupabase();
    (async () => {
      try {
        const { data, error } = await supabase.rpc('admin_dashboard_stats');
        if (error) { console.warn('[admin/dash] fail', error); return; }
        setStats(data as DashboardStats);
      } finally {
        setLoading(false);
      }
    })();
  }, [isAdmin]);

  if (authLoading || !isAdmin || loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
      </div>
    );
  }

  const chartData = stats?.daily_revenue_14d?.map(d => ({
    label: new Date(d.day).getDate().toString(),
    krw: d.krw,
  })) ?? [];

  return (
    <div className="max-w-2xl mx-auto pb-12">
      <div className="flex items-center gap-3 px-4 py-3 sticky top-0 bg-[var(--background)]/95 backdrop-blur z-10">
        <button onClick={() => router.back()} className="p-1 active:scale-90"><ArrowLeft size={24} /></button>
        <h1 className="text-xl font-bold flex-1">어드민 대시보드</h1>
      </div>

      {stats && (
        <>
          {/* 매출 카드 */}
          <div className="px-4">
            <div className="card p-5 bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950/30 dark:to-emerald-900/20">
              <p className="text-xs text-emerald-700 dark:text-emerald-300 mb-1">오늘 매출</p>
              <p className="text-3xl font-extrabold text-emerald-700 dark:text-emerald-400">
                {stats.revenue.today.toLocaleString()}원
              </p>
              <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-emerald-200/50 dark:border-emerald-800/30">
                <Stat label="이번 주" value={`${stats.revenue.week.toLocaleString()}원`} />
                <Stat label="이번 달" value={`${stats.revenue.month.toLocaleString()}원`} />
                <Stat label="총 매출" value={`${stats.revenue.all_time.toLocaleString()}원`} />
              </div>
            </div>
          </div>

          {/* 14일 매출 추이 차트 */}
          {chartData.length > 0 && (
            <div className="px-4 mt-3">
              <div className="card p-4">
                <p className="text-sm font-bold mb-3">최근 14일 매출 추이</p>
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={chartData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval={1} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: 'var(--card)', border: '1px solid var(--card-border)', borderRadius: 12, fontSize: 12 }}
                      formatter={(v) => [`${Number(v).toLocaleString()}원`, '매출']}
                    />
                    <Bar dataKey="krw" fill="#10B981" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* 주문 상태 카드 */}
          <div className="px-4 mt-3">
            <div className="card p-4">
              <p className="text-sm font-bold mb-3 flex items-center gap-1.5"><ShoppingBag size={16} /> 주문 현황</p>
              <div className="grid grid-cols-3 gap-3">
                <Stat label="오늘 주문" value={`${stats.orders.today}건`} />
                <Stat label="이번 주" value={`${stats.orders.week}건`} />
                <Stat label="이번 달" value={`${stats.orders.month}건`} />
              </div>
              <div className="grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-[var(--card-border)]">
                <Stat label="결제 대기" value={`${stats.orders.pending}건`} accent={stats.orders.pending > 0 ? 'amber' : undefined} />
                <Stat label="발송 대기" value={`${stats.orders.paid_unfulfilled}건`} accent={stats.orders.paid_unfulfilled > 0 ? 'red' : undefined} />
                <Stat label="배송 중" value={`${stats.orders.shipped_unfulfilled}건`} accent="blue" />
              </div>
              <Link href="/admin/orders" className="mt-4 inline-flex items-center gap-1 text-xs text-[var(--accent)] font-semibold">
                주문 관리 <ChevronRight size={12} />
              </Link>
            </div>
          </div>

          {/* 상품 카드 */}
          <div className="px-4 mt-3">
            <div className="card p-4">
              <p className="text-sm font-bold mb-3 flex items-center gap-1.5"><Package size={16} /> 상품 현황</p>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="판매중" value={`${stats.products.published}개`} />
                <Stat label="임시저장" value={`${stats.products.draft}개`} />
                <Stat label="품절" value={`${stats.products.out_of_stock}개`} accent={stats.products.out_of_stock > 0 ? 'red' : undefined} />
                <Stat label="재고 5↓" value={`${stats.products.low_stock}개`} accent={stats.products.low_stock > 0 ? 'amber' : undefined} />
              </div>
              {(stats.products.out_of_stock + stats.products.low_stock) > 0 && (
                <p className="mt-3 text-xs text-amber-600 inline-flex items-center gap-1">
                  <AlertCircle size={12} /> 재고 보충 필요한 상품이 있어요
                </p>
              )}
              <Link href="/admin/products" className="mt-4 inline-flex items-center gap-1 text-xs text-[var(--accent)] font-semibold">
                상품 관리 <ChevronRight size={12} />
              </Link>
            </div>
          </div>

          {/* 사용자 카드 */}
          <div className="px-4 mt-3">
            <div className="card p-4">
              <p className="text-sm font-bold mb-3 flex items-center gap-1.5"><Users size={16} /> 사용자</p>
              <div className="grid grid-cols-3 gap-3">
                <Stat label="총 가입" value={`${stats.users.total}명`} />
                <Stat label="오늘 신규" value={`+${stats.users.new_today}`} />
                <Stat label="이번 주 신규" value={`+${stats.users.new_week}`} />
              </div>
            </div>
          </div>

          {/* 어드민 메뉴 */}
          <div className="px-4 mt-5">
            <p className="text-sm font-bold mb-2 px-1">관리</p>
            <div className="grid grid-cols-2 gap-2">
              <AdminLink href="/admin/orders" icon={<ShoppingBag size={20} />} label="주문 관리" />
              <AdminLink href="/admin/products" icon={<Package size={20} />} label="상품 관리" />
              <AdminLink href="/admin/mileage" icon={<Coins size={20} />} label="마일리지 정책" />
              <AdminLink href="/admin/experiments" icon={<Beaker size={20} />} label="A/B 실험" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'amber' | 'red' | 'blue' }) {
  const colorClass = accent === 'amber' ? 'text-amber-600' :
                     accent === 'red' ? 'text-red-500' :
                     accent === 'blue' ? 'text-blue-500' :
                     'text-[var(--foreground)]';
  return (
    <div>
      <p className="text-xs text-[var(--muted)] mb-0.5">{label}</p>
      <p className={`text-base font-bold ${colorClass}`}>{value}</p>
    </div>
  );
}

function AdminLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link href={href} className="card p-3 flex items-center gap-2 active:scale-95 transition">
      <span className="text-[var(--accent)]">{icon}</span>
      <span className="text-sm font-semibold flex-1">{label}</span>
      <ChevronRight size={14} className="text-[var(--muted)]" />
    </Link>
  );
}
