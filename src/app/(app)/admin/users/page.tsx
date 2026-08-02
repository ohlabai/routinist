'use client';

// 어드민 — 회원 관리 DB view (build 201 / Phase A).
// 데스크탑 admin 페이지. 모든 회원 정보 컬럼 + 필터 + 정렬 + 페이지네이션.
// 모바일 가로 스크롤 OK (운영자는 데스크탑 / iPad 사용 가정).

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Users, Search, Filter, ChevronLeft, ChevronRight, RefreshCw,
  Eye, EyeOff, AlertCircle, Loader2, X,
} from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { isAdminEmail } from '@/lib/admin-emails';
import { getSupabase } from '@/lib/supabase';
import AppToast from '@/components/AppToast';

interface UserRow {
  user_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  region_si: string | null;
  region_gu: string | null;
  region_dong: string | null;
  country_code: string | null;
  gender: string | null;
  birth_year: number | null;
  age: number | null;
  running_since: string | null;
  bio: string | null;
  is_public: boolean;
  total_runs: number;
  total_distance_km: number;
  total_duration_sec: number;
  this_month_km: number;
  this_month_runs: number;
  last_activity_date: string | null;
  idle_days: number | null;
  mileage_balance: number;
  total_orders: number;
  total_paid_krw: number;
  club_count: number;
  follower_count: number;
  following_count: number;
  report_count_against: number;
  signup_provider: string;
  push_token_count: number;
  coach_opt_in: boolean | null;
  weight_kg: number | null;
  max_hr: number | null;
  email_confirmed_at: string | null;
  created_at: string;
  total_count: number;
}

type SortKey =
  | 'created_desc' | 'created_asc'
  | 'km_desc' | 'km_asc'
  | 'runs_desc' | 'last_active_desc' | 'mileage_desc';

interface Filters {
  search: string;
  region_si: string;
  region_gu: string;
  gender: string;
  age_min: string;
  age_max: string;
  signup_days: string;     // '7' / '30' / ''
  idle_days: string;       // '30' / '60' / ''
  has_club: string;        // 'yes' / 'no' / ''
  has_push: string;
  is_public: string;       // 'yes' / 'no' / ''
}

const PAGE_SIZE = 50;

const SORT_LABELS: Record<SortKey, string> = {
  created_desc: '가입일 ↓',
  created_asc: '가입일 ↑',
  km_desc: '총 km ↓',
  km_asc: '총 km ↑',
  runs_desc: '활동수 ↓',
  last_active_desc: '최근 활동 ↓',
  mileage_desc: '마일리지 ↓',
};

const initialFilters: Filters = {
  search: '', region_si: '', region_gu: '', gender: '',
  age_min: '', age_max: '', signup_days: '', idle_days: '',
  has_club: '', has_push: '', is_public: '',
};

export default function AdminUsersPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);

  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [sort, setSort] = useState<SortKey>('created_desc');
  const [page, setPage] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !isAdmin) { router.replace('/'); return; }
  }, [authLoading, user, isAdmin, router]);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2200);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.rpc('admin_list_users_v2', {
        p_search: filters.search.trim() || null,
        p_region_si: filters.region_si || null,
        p_region_gu: filters.region_gu || null,
        p_gender: filters.gender || null,
        p_age_min: filters.age_min ? Number(filters.age_min) : null,
        p_age_max: filters.age_max ? Number(filters.age_max) : null,
        p_signup_days: filters.signup_days ? Number(filters.signup_days) : null,
        p_idle_days: filters.idle_days ? Number(filters.idle_days) : null,
        p_has_club: filters.has_club === 'yes' ? true : filters.has_club === 'no' ? false : null,
        p_has_push: filters.has_push === 'yes' ? true : filters.has_push === 'no' ? false : null,
        p_is_public: filters.is_public === 'yes' ? true : filters.is_public === 'no' ? false : null,
        p_sort: sort,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      });
      if (error) throw error;
      setRows((data ?? []) as UserRow[]);
    } catch (e) {
      console.warn('[admin/users] fail', e);
      showToast(e instanceof Error ? e.message : '조회 실패', 'warn');
    } finally {
      setLoading(false);
    }
  }, [filters, sort, page]);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const togglePublic = async (row: UserRow) => {
    setBusy(row.user_id);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.rpc('admin_set_user_public', {
        p_user_id: row.user_id, p_is_public: !row.is_public,
      });
      if (error) throw error;
      setRows(prev => prev.map(r => r.user_id === row.user_id ? { ...r, is_public: !r.is_public } : r));
      showToast(row.is_public ? '감춤 처리됨' : '공개로 변경');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '실패', 'warn');
    } finally {
      setBusy(null);
    }
  };

  const resetFilters = () => { setFilters(initialFilters); setPage(0); };

  const totalCount = rows[0]?.total_count ?? 0;
  const pageCount = Math.max(1, Math.ceil(Number(totalCount) / PAGE_SIZE));
  const activeFilterCount = Object.entries(filters).filter(([k, v]) => k !== 'search' && v).length;

  if (!isAdmin) return null;

  return (
    <div className="bg-[var(--background)] min-h-screen pb-12">
      {/* 헤더 */}
      <header className="sticky top-0 z-30 bg-[var(--background)]/85 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="max-w-6xl mx-auto flex items-center gap-2 px-4 py-3">
          <Link href="/admin" className="w-10 h-10 flex items-center justify-center rounded-full active:bg-[var(--card-border)]/30">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-xl font-extrabold tracking-tight inline-flex items-center gap-1.5">
            <Users size={18} className="text-emerald-500" /> 회원 관리
          </h1>
          <span className="ml-auto text-xs font-bold text-[var(--muted)]">총 {Number(totalCount).toLocaleString()}명</span>
          <button onClick={load} aria-label="새로고침"
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[var(--card-border)]/30">
            <RefreshCw size={14} />
          </button>
        </div>

        {/* 검색 + 필터 + 정렬 */}
        <div className="max-w-6xl mx-auto px-4 pb-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input value={filters.search}
              onChange={e => { setFilters(f => ({ ...f, search: e.target.value })); setPage(0); }}
              placeholder="이메일 / 닉네임 검색"
              className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-sm focus:outline-none focus:border-emerald-500" />
          </div>
          <button onClick={() => setShowFilters(s => !s)}
            className={`px-3 py-2.5 rounded-xl text-xs font-extrabold inline-flex items-center gap-1 border ${
              showFilters || activeFilterCount > 0
                ? 'bg-emerald-500 text-white border-emerald-500'
                : 'bg-[var(--card)] border-[var(--card-border)] text-[var(--foreground)]'
            }`}>
            <Filter size={12} /> 필터 {activeFilterCount > 0 && <span className="ml-0.5 px-1 rounded-full bg-white/20 text-[12px]">{activeFilterCount}</span>}
          </button>
          <select value={sort} onChange={e => { setSort(e.target.value as SortKey); setPage(0); }}
            className="px-3 py-2.5 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-xs font-bold focus:outline-none focus:border-emerald-500">
            {Object.entries(SORT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>

        {/* 필터 패널 */}
        {showFilters && (
          <div className="max-w-6xl mx-auto px-4 pb-4">
            <div className="card p-3 space-y-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <FilterChips label="가입" value={filters.signup_days}
                  onChange={v => setFilters(f => ({ ...f, signup_days: v }))}
                  options={[['', '전체'], ['7', '7일'], ['30', '30일']]} />
                <FilterChips label="활동" value={filters.idle_days}
                  onChange={v => setFilters(f => ({ ...f, idle_days: v }))}
                  options={[['', '전체'], ['30', '30일+미활동'], ['60', '60일+미활동']]} />
                <FilterChips label="클럽" value={filters.has_club}
                  onChange={v => setFilters(f => ({ ...f, has_club: v }))}
                  options={[['', '전체'], ['yes', '멤버'], ['no', '비멤버']]} />
                <FilterChips label="푸시" value={filters.has_push}
                  onChange={v => setFilters(f => ({ ...f, has_push: v }))}
                  options={[['', '전체'], ['yes', '있음'], ['no', '없음']]} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <FilterChips label="성별" value={filters.gender}
                  onChange={v => setFilters(f => ({ ...f, gender: v }))}
                  options={[['', '전체'], ['male', '남'], ['female', '여']]} />
                <FilterChips label="공개" value={filters.is_public}
                  onChange={v => setFilters(f => ({ ...f, is_public: v }))}
                  options={[['', '전체'], ['yes', '공개'], ['no', '감춤']]} />
                <input value={filters.region_si} onChange={e => setFilters(f => ({ ...f, region_si: e.target.value }))}
                  placeholder="시 (예: 서울특별시)"
                  className="px-3 py-2 rounded-xl bg-[var(--background)] border border-[var(--card-border)] text-xs focus:outline-none focus:border-emerald-500" />
                <input value={filters.region_gu} onChange={e => setFilters(f => ({ ...f, region_gu: e.target.value }))}
                  placeholder="구 (예: 강남구)"
                  className="px-3 py-2 rounded-xl bg-[var(--background)] border border-[var(--card-border)] text-xs focus:outline-none focus:border-emerald-500" />
              </div>
              <div className="flex items-center gap-2">
                <input value={filters.age_min} onChange={e => setFilters(f => ({ ...f, age_min: e.target.value }))}
                  placeholder="나이 ≥" inputMode="numeric"
                  className="flex-1 px-3 py-2 rounded-xl bg-[var(--background)] border border-[var(--card-border)] text-xs focus:outline-none focus:border-emerald-500" />
                <input value={filters.age_max} onChange={e => setFilters(f => ({ ...f, age_max: e.target.value }))}
                  placeholder="나이 ≤" inputMode="numeric"
                  className="flex-1 px-3 py-2 rounded-xl bg-[var(--background)] border border-[var(--card-border)] text-xs focus:outline-none focus:border-emerald-500" />
                <button onClick={() => { setPage(0); load(); }}
                  className="px-3 py-2 rounded-xl bg-emerald-500 text-white text-xs font-extrabold active:scale-95">적용</button>
                <button onClick={resetFilters}
                  className="px-2 py-2 rounded-xl bg-[var(--card-border)]/30 text-xs font-bold active:scale-95 inline-flex items-center gap-0.5">
                  <X size={11} /> 초기화
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* 테이블 */}
      <div className="max-w-6xl mx-auto px-4 pt-4">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-emerald-500" /></div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-sm text-[var(--muted)]">조건에 맞는 회원 없음</div>
        ) : (
          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-xs whitespace-nowrap">
              {/* build 220 #1: 기존 thead 가 overflow-x-auto 안에서 sticky top-110 →
                  스크롤 컨테이너 기준이라 항상 mid-table 에 떠 있음.
                  데스크탑/iPad 운영 도구라 화면이 짧지 않아 sticky 가 오히려 혼란.
                  자연 위치 (테이블 최상단) 로 환원. */}
              <thead className="bg-[var(--card-border)]/20 text-[12px] uppercase tracking-widest text-[var(--muted)]">
                <tr>
                  <Th>닉네임</Th>
                  <Th>이메일</Th>
                  <Th>가입일</Th>
                  <Th>방식</Th>
                  <Th>지역</Th>
                  <Th>성/연령</Th>
                  <Th>활동수</Th>
                  <Th>총 km</Th>
                  <Th>이달 km</Th>
                  <Th>마지막 러닝</Th>
                  <Th>이탈일</Th>
                  <Th>마일리지</Th>
                  <Th>주문</Th>
                  <Th>결제액</Th>
                  <Th>클럽</Th>
                  <Th>팔로워</Th>
                  <Th>푸시</Th>
                  <Th>코치</Th>
                  <Th>신고</Th>
                  <Th>상태</Th>
                  <Th className="sticky right-0 bg-[var(--card-border)]/20">액션</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--card-border)]/40">
                {rows.map(r => (
                  <tr key={r.user_id} className={`hover:bg-emerald-50/40 dark:hover:bg-emerald-950/10 ${!r.is_public ? 'opacity-60' : ''}`}>
                    <Td>
                      <Link href={`/admin/users/detail?id=${r.user_id}`} className="font-bold text-emerald-700 dark:text-emerald-300 hover:underline">
                        {r.display_name ?? '익명'}
                      </Link>
                    </Td>
                    <Td className="text-[var(--muted)]">{r.email}</Td>
                    <Td>{fmtDate(r.created_at)}</Td>
                    <Td>{providerLabel(r.signup_provider)}</Td>
                    <Td>{r.region_si ? `${shortSi(r.region_si)} ${r.region_gu ?? ''}` : '-'}</Td>
                    <Td>{r.gender ? genderLabel(r.gender) : '-'}{r.age !== null ? ` ${r.age}` : ''}</Td>
                    <Td className="text-right tabular-nums">{r.total_runs}</Td>
                    <Td className="text-right tabular-nums font-bold">{Number(r.total_distance_km ?? 0).toFixed(1)}</Td>
                    <Td className="text-right tabular-nums">{Number(r.this_month_km ?? 0).toFixed(1)}</Td>
                    <Td>{r.last_activity_date ?? '-'}</Td>
                    <Td className={`text-right tabular-nums ${r.idle_days !== null && r.idle_days >= 30 ? 'text-rose-500 font-bold' : ''}`}>
                      {r.idle_days !== null ? `${r.idle_days}일` : '-'}
                    </Td>
                    <Td className="text-right tabular-nums">{r.mileage_balance.toLocaleString()}P</Td>
                    <Td className="text-right tabular-nums">{r.total_orders}</Td>
                    <Td className="text-right tabular-nums">{Number(r.total_paid_krw ?? 0).toLocaleString()}원</Td>
                    <Td className="text-right tabular-nums">{r.club_count}</Td>
                    <Td className="text-right tabular-nums">{r.follower_count}/{r.following_count}</Td>
                    <Td className="text-right">{r.push_token_count > 0
                      ? <span className="text-emerald-600">✓</span>
                      : <span className="text-[var(--muted)]">-</span>}
                    </Td>
                    <Td className="text-right">{r.coach_opt_in
                      ? <span className="text-violet-600 font-bold">AI</span>
                      : <span className="text-[var(--muted)]">-</span>}
                    </Td>
                    <Td className={`text-right ${r.report_count_against > 0 ? 'text-rose-500 font-bold' : 'text-[var(--muted)]'}`}>
                      {r.report_count_against > 0 ? `⚠️ ${r.report_count_against}` : '-'}
                    </Td>
                    <Td>
                      {r.is_public
                        ? <span className="inline-flex items-center gap-0.5 text-emerald-600 font-bold"><Eye size={11} /> 공개</span>
                        : <span className="inline-flex items-center gap-0.5 text-rose-500 font-bold"><EyeOff size={11} /> 감춤</span>}
                    </Td>
                    <Td className="sticky right-0 bg-[var(--background)]">
                      <div className="flex items-center gap-1">
                        <button onClick={() => togglePublic(r)} disabled={busy === r.user_id}
                          aria-label={r.is_public ? '감추기' : '공개'}
                          className={`w-7 h-7 rounded-lg flex items-center justify-center disabled:opacity-50 active:scale-95 ${
                            r.is_public ? 'bg-[var(--card-border)]/30 text-[var(--muted)]' : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                          }`}>
                          {r.is_public ? <EyeOff size={12} /> : <Eye size={12} />}
                        </button>
                        <Link href={`/admin/users/detail?id=${r.user_id}`}
                          className="px-2 py-1 rounded-lg bg-[var(--card)] border border-[var(--card-border)] text-[12px] font-extrabold hover:bg-emerald-50 dark:hover:bg-emerald-950/20">
                          상세
                        </Link>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 페이지네이션 */}
        {rows.length > 0 && (
          <div className="flex items-center justify-between mt-4 px-1">
            <span className="text-xs text-[var(--muted)]">
              {page * PAGE_SIZE + 1}~{Math.min((page + 1) * PAGE_SIZE, Number(totalCount))} / {Number(totalCount).toLocaleString()}
            </span>
            <div className="flex items-center gap-1">
              <button disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}
                className="w-9 h-9 rounded-xl bg-[var(--card)] border border-[var(--card-border)] disabled:opacity-30 active:scale-95 flex items-center justify-center">
                <ChevronLeft size={14} />
              </button>
              <span className="px-3 text-xs font-bold tabular-nums">{page + 1} / {pageCount}</span>
              <button disabled={page + 1 >= pageCount} onClick={() => setPage(p => p + 1)}
                className="w-9 h-9 rounded-xl bg-[var(--card)] border border-[var(--card-border)] disabled:opacity-30 active:scale-95 flex items-center justify-center">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2000} />}
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-2.5 py-2.5 text-left font-extrabold ${className}`}>{children}</th>;
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2.5 py-2 ${className}`}>{children}</td>;
}

function FilterChips({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: [string, string][];
}) {
  return (
    <div>
      <p className="text-[11px] font-extrabold uppercase tracking-widest text-[var(--muted)] mb-1">{label}</p>
      <div className="flex gap-1 flex-wrap">
        {options.map(([v, lbl]) => (
          <button key={v} onClick={() => onChange(v)}
            className={`px-2 py-1 rounded-lg text-[12px] font-extrabold ${
              value === v ? 'bg-emerald-500 text-white' : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--foreground)]'
            }`}>{lbl}</button>
        ))}
      </div>
    </div>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}
function shortSi(si: string): string {
  // "서울특별시" → "서울", "경기도" → "경기"
  return si.replace(/특별시|광역시|특별자치시|특별자치도|도$/, '');
}
function genderLabel(g: string): string {
  return g === 'male' ? '남' : g === 'female' ? '여' : '기';
}
function providerLabel(p: string): string {
  return p === 'apple' ? '🍎' : p === 'google' ? 'G' : p === 'email' ? '✉️' : p;
}
