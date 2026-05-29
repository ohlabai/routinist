'use client';

// 데이터 점검 페이지 — "5/2 에 달렸는데 안 보여요" 같은 신고를 직접 검증할 수 있게 월별 카운트.
// /profile 에서 숨김 메뉴로 진입 (long-press 또는 별도 버튼).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, Stethoscope, ExternalLink, LogOut } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase, resetSupabaseClient } from '@/lib/supabase';
import { syncHealthData, syncRouteData, isNativeApp, getPlatform } from '@/lib/health-sync';
import { signOut } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';

interface AuditRow {
  month: string;
  run_count: number;
  total_km: number;
  source_breakdown: Record<string, number> | null;
  last_activity_date: string | null;
  last_started_at: string | null;
}

interface DiagnosticResult {
  available: boolean | null;
  hkRunning30d: number | null;
  hkWalking30d: number | null;
  hkRoutes30d: number | null;
  dbActivities30d: number | null;
  dbWithRoute30d: number | null;
  errors: string[];
}

export default function DataAuditPage() {
  const { user } = useAuth();
  const { tt, locale } = useI18n();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [resyncing, setResyncing] = useState(false);
  const [resyncMsg, setResyncMsg] = useState<string | null>(null);
  const [diag, setDiag] = useState<DiagnosticResult | null>(null);
  const [diagRunning, setDiagRunning] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();
      // 토큰 stale 시 RPC hang 방지 — 10s race
      const result = await Promise.race([
        supabase.rpc('audit_user_data', { p_months: 6 }),
        new Promise<{ data: null; error: { message: string } }>((resolve) =>
          setTimeout(() => resolve({ data: null, error: { message: '10초 timeout' } }), 10000)
        ),
      ]);
      if (!result.error) setRows((result.data ?? []) as AuditRow[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // 네이티브 플러그인이 응답을 안 주면 UI 가 영원히 멈춤 → 30초 race 가드.
  // (capgo Health.queryWorkouts / WorkoutRoute.getRoutes 가 권한 다이얼로그 미응답 등으로 hang 가능)
  // PromiseLike — Supabase 의 thenable builder 도 받게 (build 58)
  const withTimeout = <T,>(p: PromiseLike<T>, ms: number, label: string): Promise<T> =>
    Promise.race<T>([
      Promise.resolve(p),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} ${ms / 1000}초 timeout`)), ms)
      ),
    ]);

  const handleResync = async () => {
    if (!user) return;
    setResyncing(true);
    setResyncMsg(tt('Apple Health 다시 동기화 중...'));
    try {
      const r = await withTimeout(syncHealthData(user.id), 30000, 'Apple Health sync');
      setResyncMsg(`${r.message} (총 ${r.meta?.totalFromHealth ?? '?'}건 조회, 새 ${r.synced}건 저장)`);
      await load();
    } catch (e) {
      setResyncMsg(`실패: ${e instanceof Error ? e.message : e}`);
    } finally {
      setResyncing(false);
    }
  };

  const handleResyncRoutes = async () => {
    if (!user) return;
    setResyncing(true);
    setResyncMsg('GPS 경로 다시 불러오는 중... (3년치 검색)');
    let finalMsg = '';
    try {
      // build 59: 진짜 chunk 분할 — startDate/endDate 시그니처로 6개월씩 다른 기간 검색.
      // 이전 build 58 의 chunk 는 daysBack 인자 1개라 0~180/0~360/0~540 식 중복 호출 버그였음.
      const totalDays = 1095;  // 3년
      const chunkDays = 180;   // 6개월
      let fetched = 0, matched = 0, updated = 0;
      const reasons: string[] = [];
      const now = new Date();
      let zeroStreak = 0;  // 연속 0건 chunk — 옛 데이터 끝났다는 신호
      for (let offset = 0; offset < totalDays; offset += chunkDays) {
        const days = Math.min(chunkDays, totalDays - offset);
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() - offset);
        const startDate = new Date(now);
        startDate.setDate(startDate.getDate() - (offset + days));
        setResyncMsg(`GPS 경로: ${offset}~${offset + days}일 전 검색 중... (현재 ${matched}건 매칭)`);
        try {
          const r = await withTimeout(
            syncRouteData(user.id, { startDate, endDate }),
            45000,
            `GPS chunk[${offset}-${offset + days}]`,
          );
          fetched += r.fetched;
          matched += r.matched;
          updated += r.updated;
          if (r.reason) reasons.push(`${offset}-${offset + days}d: ${r.reason}`);
          if (r.fetched === 0) {
            zeroStreak++;
            if (zeroStreak >= 3) break;  // 18개월 연속 0건 = 더 옛 데이터 없음
          } else {
            zeroStreak = 0;
          }
        } catch (e) {
          reasons.push(`${offset}-${offset + days}d: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      const reasonStr = reasons.length > 0 ? `\n사유: ${reasons.slice(0, 3).join(', ')}` : '';
      finalMsg = `✅ GPS 경로 결과\n· 플러그인에서 ${fetched}건\n· 활동에 매칭 ${matched}건\n· DB 업데이트 ${updated}건${reasonStr}`;
      setResyncMsg(finalMsg);
      await load();
    } catch (e) {
      finalMsg = `❌ GPS 경로 실패: ${e instanceof Error ? e.message : e}`;
      setResyncMsg(finalMsg);
    } finally {
      setResyncing(false);
      if (!finalMsg) {
        setResyncMsg(tt('결과를 받지 못했어요. 잠시 후 다시 시도해주세요.'));
      }
    }
  };

  const native = typeof window !== 'undefined' && isNativeApp() && getPlatform() === 'ios';

  // 권한 + 데이터 진단 — 네이티브 plugin 으로 직접 query 해서 HealthKit 에 무엇이 있는지 vs DB 에 무엇이 있는지 비교
  const runDiagnostic = async () => {
    if (!user) return;
    setDiagRunning(true);
    const result: DiagnosticResult = {
      available: null,
      hkRunning30d: null,
      hkWalking30d: null,
      hkRoutes30d: null,
      dbActivities30d: null,
      dbWithRoute30d: null,
      errors: [],
    };

    const startDt = new Date();
    startDt.setDate(startDt.getDate() - 30);
    const startISO = startDt.toISOString();
    const endISO = new Date().toISOString();
    const startDate = startISO.slice(0, 10);

    try {
      const { Health } = await import('@capgo/capacitor-health');
      try {
        const av = await withTimeout(Health.isAvailable(), 5000, 'isAvailable');
        result.available = av.available;
      } catch (e) {
        result.errors.push(`isAvailable: ${e instanceof Error ? e.message : e}`);
      }

      try {
        await withTimeout(Health.requestAuthorization({
          read: ['workouts', 'distance', 'heartRate', 'calories', 'exerciseTime'],
          write: [],
        }), 20000, 'requestAuthorization');
      } catch (e) {
        result.errors.push(`requestAuthorization: ${e instanceof Error ? e.message : e}`);
      }

      try {
        const r = await withTimeout(
          Health.queryWorkouts({ workoutType: 'running', startDate: startISO, endDate: endISO, limit: 500, ascending: false }),
          15000, 'queryWorkouts(running)'
        );
        result.hkRunning30d = r.workouts?.length ?? 0;
      } catch (e) {
        result.errors.push(`queryWorkouts(running): ${e instanceof Error ? e.message : e}`);
        result.hkRunning30d = 0;
      }

      try {
        const r = await withTimeout(
          Health.queryWorkouts({ workoutType: 'walking', startDate: startISO, endDate: endISO, limit: 500, ascending: false }),
          15000, 'queryWorkouts(walking)'
        );
        result.hkWalking30d = r.workouts?.length ?? 0;
      } catch (e) {
        result.errors.push(`queryWorkouts(walking): ${e instanceof Error ? e.message : e}`);
        result.hkWalking30d = 0;
      }
    } catch (e) {
      result.errors.push(`Health import: ${e instanceof Error ? e.message : e}`);
    }

    try {
      const { WorkoutRoute } = await import('@/lib/workout-route');
      try {
        await withTimeout(WorkoutRoute.requestAuthorization(), 20000, 'WorkoutRoute.requestAuthorization');
      } catch (e) {
        result.errors.push(`WorkoutRoute auth: ${e instanceof Error ? e.message : e}`);
      }
      try {
        const r = await withTimeout(
          WorkoutRoute.getRoutes({ startDate: startISO, endDate: endISO, limit: 500 }),
          45000, 'WorkoutRoute.getRoutes'
        );
        result.hkRoutes30d = r.routes?.length ?? 0;
      } catch (e) {
        result.errors.push(`getRoutes: ${e instanceof Error ? e.message : e}`);
        result.hkRoutes30d = 0;
      }
    } catch (e) {
      result.errors.push(`WorkoutRoute plugin 미등록: ${e instanceof Error ? e.message : e}`);
    }

    try {
      const supabase = getSupabase();
      // 10s timeout — SDK lock 시 hang 방지 (build 58 회고: 진단이 영영 안 끝나서 "진단 중..." 영구 회귀)
      const dbResult = await withTimeout(
        supabase
          .from('activities')
          .select('id, route_data')
          .eq('user_id', user.id)
          .gte('activity_date', startDate),
        10000,
        'DB activities select',
      );
      const { data: dbRows, error: dbErr } = dbResult as {
        data: { id: string; route_data: unknown }[] | null;
        error: { message: string } | null;
      };
      if (dbErr) {
        result.errors.push(`DB activities: ${dbErr.message}`);
      } else {
        result.dbActivities30d = dbRows?.length ?? 0;
        result.dbWithRoute30d = (dbRows ?? []).filter(r => r.route_data).length;
      }
    } catch (e) {
      result.errors.push(`DB query: ${e instanceof Error ? e.message : e}`);
    }

    // setDiag/setDiagRunning 은 finally 처럼 항상 실행. 위쪽 어디서든 throw 면 catch 들이 errors 에 push 했으므로 안전.
    setDiag(result);
    setDiagRunning(false);
  };

  const openHealthSettings = async () => {
    try {
      // iOS: app-prefs:HEALTH (10.x 부터 deprecated 일 수도 있지만 Settings 자체는 열림)
      // 안 되면 일반 Settings 로 fallback
      const url = 'app-settings:';
      window.location.href = url;
    } catch (e) {
      console.warn('Settings 열기 실패:', e);
    }
  };

  // 강제 로그아웃 + 캐시 초기화 — Supabase 토큰이 stale 한데 refresh 도 실패하는 막다른 경우 마지막 수단
  const forceFreshLogin = async () => {
    if (typeof window === 'undefined') return;
    try {
      // 1. localStorage Supabase 세션 클리어 + 자체 캐시 클리어
      Object.keys(localStorage)
        .filter(k => k.startsWith('sb-') || k.includes('supabase') || k === 'last_health_sync' || k === 'routinist_last_route_sync')
        .forEach(k => localStorage.removeItem(k));
      // 2. signOut (best effort, 결과 무시) — 내부에서 resetSupabaseClient 호출
      try { await signOut(); } catch {}
      // 3. signOut 이 실패해도 강제로 supabase singleton 초기화
      resetSupabaseClient();
    } finally {
      // hard reload 강제 — capacitor WebView 가 module state 다시 초기화하도록
      window.location.href = '/login?reason=force_fresh';
    }
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/profile" className="text-[var(--muted)]"><ArrowLeft size={24} /></Link>
        <h1 className="text-xl font-bold text-[var(--foreground)]">{tt('데이터 점검')}</h1>
      </div>

      <p className="text-sm text-[var(--muted)] mb-4 leading-relaxed">
        {locale === 'en'
          ? "If a run doesn't show up, check monthly counts here and re-sync with Apple Health."
          : '실제로 달렸는데 기록이 안 보이는 경우 여기서 월별 활동 수를 확인하고, Apple Health 와 다시 동기화할 수 있어요.'}
      </p>

      {native && (
        <div className="mb-4 space-y-2">
          <button
            onClick={handleResync}
            disabled={resyncing}
            className="w-full py-3 rounded-xl bg-emerald-500 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <RefreshCw size={16} className={resyncing ? 'animate-spin' : ''} />
            {resyncing ? (locale === 'en' ? 'Syncing...' : '동기화 중...') : tt('Apple Health 다시 동기화 (90일)')}
          </button>
          <button
            onClick={handleResyncRoutes}
            disabled={resyncing}
            className="w-full py-3 rounded-xl bg-blue-500 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <RefreshCw size={16} className={resyncing ? 'animate-spin' : ''} />
            {resyncing ? '...' : (locale === 'en' ? 'Re-fetch GPS routes (3 years)' : 'GPS 경로 다시 불러오기 (3년)')}
          </button>
          <button
            onClick={runDiagnostic}
            disabled={diagRunning}
            className="w-full py-3 rounded-xl bg-purple-500 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Stethoscope size={16} className={diagRunning ? 'animate-pulse' : ''} />
            {diagRunning ? (locale === 'en' ? 'Diagnosing...' : '진단 중...') : tt('권한 + 데이터 진단 (30일)')}
          </button>
          <button
            onClick={openHealthSettings}
            className="w-full py-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 font-bold flex items-center justify-center gap-2"
          >
            <ExternalLink size={16} />
            {tt('iOS 설정 → 앱 권한 열기')}
          </button>
          <button
            onClick={forceFreshLogin}
            className="w-full py-3 rounded-xl bg-rose-500 text-white font-bold flex items-center justify-center gap-2"
          >
            <LogOut size={16} />
            {locale === 'en' ? 'Force sign out + re-login (last resort)' : '강제 로그아웃 + 다시 로그인 (모든 데이터 로딩 실패 시)'}
          </button>
          {resyncMsg && (
            <div className={`text-sm whitespace-pre-line p-3 rounded-xl border ${
              resyncMsg.startsWith('❌') || resyncMsg.includes('실패')
                ? 'border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-800'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-800'
            }`}>
              {resyncMsg}
            </div>
          )}

          {diag && (
            <div className="card p-4 space-y-2 text-sm">
              <p className="font-bold text-[var(--foreground)]">{locale === 'en' ? 'Diagnosis (last 30 days)' : '진단 결과 (지난 30일)'}</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <span className="text-[var(--muted)]">{locale === 'en' ? 'HealthKit available' : 'HealthKit 사용 가능'}</span>
                <span className="font-bold">{diag.available === true ? '✅' : diag.available === false ? '❌' : '?'}</span>

                <span className="text-[var(--muted)]">{locale === 'en' ? 'Apple Health runs' : 'Apple Health 러닝'}</span>
                <span className="font-bold">{diag.hkRunning30d ?? '?'} {locale === 'en' ? '' : '건'}</span>

                <span className="text-[var(--muted)]">{locale === 'en' ? 'Apple Health walks' : 'Apple Health 걷기'}</span>
                <span className="font-bold">{diag.hkWalking30d ?? '?'} {locale === 'en' ? '' : '건'}</span>

                <span className="text-[var(--muted)]">{locale === 'en' ? 'DB activities (total)' : 'DB 활동 (총)'}</span>
                <span className="font-bold">{diag.dbActivities30d ?? '?'} {locale === 'en' ? '' : '건'}</span>

                <span className="text-[var(--muted)]">{locale === 'en' ? 'Apple Health GPS routes' : 'Apple Health GPS 경로'}</span>
                <span className="font-bold">{diag.hkRoutes30d ?? '?'} {locale === 'en' ? '' : '건'}</span>

                <span className="text-[var(--muted)]">{locale === 'en' ? 'DB GPS matched' : 'DB GPS 매칭'}</span>
                <span className="font-bold">{diag.dbWithRoute30d ?? '?'} {locale === 'en' ? '' : '건'}</span>
              </div>

              {diag.hkRunning30d === 0 && diag.hkWalking30d === 0 && (
                <p className="text-xs text-rose-600 dark:text-rose-400 font-semibold pt-2 border-t border-[var(--card-border)]">
                  ⚠️ Apple Health 에서 데이터를 못 가져옵니다. 설정 → 개인정보 보호 → 건강 → Routinist 에서 모든 권한이 켜져있는지 확인하세요.
                </p>
              )}
              {diag.hkRunning30d !== null && diag.dbActivities30d !== null
                && diag.hkRunning30d > diag.dbActivities30d && (
                <p className="text-xs text-amber-600 font-semibold pt-2 border-t border-[var(--card-border)]">
                  ⚠️ Apple Health 에 {diag.hkRunning30d}건 있는데 DB 에는 {diag.dbActivities30d}건. 동기화 버튼을 다시 눌러주세요.
                </p>
              )}
              {diag.hkRoutes30d !== null && diag.dbWithRoute30d !== null
                && diag.hkRoutes30d > diag.dbWithRoute30d && (
                <p className="text-xs text-amber-600 font-semibold pt-1">
                  ⚠️ GPS 경로 {diag.hkRoutes30d - diag.dbWithRoute30d}건이 매칭 안 됨. "GPS 경로 다시 불러오기 (3년)" 눌러주세요.
                </p>
              )}
              {diag.errors.length > 0 && (
                <details className="pt-2 border-t border-[var(--card-border)]">
                  <summary className="text-xs text-[var(--muted)] cursor-pointer">상세 에러 ({diag.errors.length})</summary>
                  <ul className="mt-1 space-y-0.5 text-[10px] text-rose-500">
                    {diag.errors.map((err, i) => <li key={i}>• {err}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      <div className="card divide-y divide-[var(--card-border)]">
        {loading ? (
          <div className="flex justify-center py-10">
            <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-center text-sm text-[var(--muted)] py-10">{tt('활동 기록이 없습니다.')}</p>
        ) : (
          rows.map(row => (
            <div key={row.month} className="p-4">
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-base font-bold text-[var(--foreground)]">{row.month}</span>
                <span className="text-sm text-[var(--muted)]">
                  {locale === 'en' ? `${row.run_count} runs · ${row.total_km}km` : `${row.run_count}회 · ${row.total_km}km`}
                </span>
              </div>
              {row.source_breakdown && Object.keys(row.source_breakdown).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {Object.entries(row.source_breakdown).map(([source, count]) => (
                    <span key={source} className="text-xs px-2 py-0.5 rounded-full bg-[var(--card-border)]/40 text-[var(--muted)]">
                      {source}: {count}
                    </span>
                  ))}
                </div>
              )}
              {row.last_activity_date && (
                <p className="text-xs text-[var(--muted)] mt-1">
                  {locale === 'en' ? 'Last: ' : '최근: '}{row.last_activity_date}
                  {row.last_started_at && ` (${new Date(row.last_started_at).toLocaleString(locale === 'en' ? 'en-US' : 'ko-KR', { hour: '2-digit', minute: '2-digit' })})`}
                </p>
              )}
            </div>
          ))
        )}
      </div>

      <p className="mt-4 text-xs text-[var(--muted)] leading-relaxed">
        💡 "이 달 N회" 가 실제와 다르면 Apple Health 권한이 일부 거부됐거나, Apple Health 자체에 데이터가 안 들어갔을 수 있어요. 위 다시 동기화 버튼으로 한 번 더 시도하고, 그래도 안 되면 설정 → 개인정보 보호 → 건강 → Routinist 에서 모든 권한을 허용해주세요.
      </p>
    </div>
  );
}
