'use client';

// 러닝 코치 (AI) — 컨셉 유지하면서 deep analytics opt-in (build 198).
// - 오늘 컨디션 점수 (0~100) + 친근한 한국어 코칭 메시지
// - CTL/ATL/TSB 14일 sparkline (용어 노출 X, "장기 / 단기 부하" 풀이)
// - 설정: opt-in 토글, 체중·max HR (kcal/HR Zones 정확도용, 본인만 보임)

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Sparkles, Activity, Heart, Zap, Info, Settings, Save, Loader2,
} from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';
import AppToast from '@/components/AppToast';
import TargetRaceCard from '@/components/coach/TargetRaceCard';
import RacePredictionCard from '@/components/coach/RacePredictionCard';
import WeeklyLoadCard from '@/components/coach/WeeklyLoadCard';

interface CoachingPayload {
  score: number;
  message: string;
  advice: string;
  tsb: number;
  ctl: number;
  atl: number;
  last_active_date: string | null;
}

interface TrendRow { date: string; stress_score: number; ctl: number; atl: number; tsb: number; }

export default function CoachPage() {
  const router = useRouter();
  const { tt } = useI18n();
  const { user, profile, refreshProfile, loading: authLoading } = useAuth();
  const [today, setToday] = useState<CoachingPayload | null>(null);
  const [trend, setTrend] = useState<TrendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [weightInput, setWeightInput] = useState('');
  const [maxHrInput, setMaxHrInput] = useState('');
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login?redirect=/coach');
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user) return;
    setWeightInput(profile?.weight_kg ? String(profile.weight_kg) : '');
    setMaxHrInput(profile?.max_hr ? String(profile.max_hr) : '');
  }, [user, profile?.weight_kg, profile?.max_hr]);

  // 2026-07-11 피드백: RPC 실패 시 화면이 그냥 비어 보였음 — 에러 상태 + 재시도 제공.
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const supabase = getSupabase();
        const [todayRes, trendRes] = await Promise.all([
          supabase.rpc('get_today_coaching'),
          supabase.rpc('get_my_fitness_trend', { p_days: 14 }),
        ]);
        if (cancelled) return;
        if (todayRes.data && !todayRes.data.error) setToday(todayRes.data as CoachingPayload);
        else if (todayRes.error) setLoadError(true);
        if (Array.isArray(trendRes.data)) setTrend(trendRes.data as TrendRow[]);
      } catch (e) {
        console.warn('[coach] load fail', e);
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, reloadKey]);

  const handleSaveSettings = async () => {
    if (!user) return;
    setSavingSettings(true);
    try {
      const supabase = getSupabase();
      const weight = weightInput.trim() ? Number(weightInput) : null;
      const maxHr = maxHrInput.trim() ? Number(maxHrInput) : null;
      if (weight !== null && (isNaN(weight) || weight < 20 || weight > 250)) {
        setToast({ text: tt('체중은 20~250kg 사이로 입력해주세요'), tone: 'warn' });
        setSavingSettings(false);
        return;
      }
      if (maxHr !== null && (isNaN(maxHr) || maxHr < 100 || maxHr > 230)) {
        setToast({ text: tt('최대 심박수는 100~230 사이로 입력해주세요'), tone: 'warn' });
        setSavingSettings(false);
        return;
      }
      const { error } = await supabase
        .from('profiles')
        .update({
          weight_kg: weight,
          max_hr: maxHr,
          coach_opt_in: true,
        })
        .eq('id', user.id);
      if (error) throw error;
      await refreshProfile();
      setToast({ text: tt('저장되었어요'), tone: 'ok' });
      setShowSettings(false);
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : tt('저장 실패'), tone: 'warn' });
    } finally {
      setSavingSettings(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
      </div>
    );
  }

  const scoreColor =
    today && today.score >= 80 ? 'from-emerald-500 to-emerald-600' :
    today && today.score >= 50 ? 'from-teal-500 to-emerald-600' :
    'from-slate-500 to-slate-600';   // 휴식 필요 = 차분한 슬레이트 (주황·빨강 금지 톤 룰)

  return (
    <div className="max-w-lg mx-auto pb-24 bg-[var(--background)] min-h-screen">
      {/* 헤더 */}
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30 flex items-center gap-2 px-3 py-3">
        <button onClick={() => router.back()} aria-label={tt('뒤로')}
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-extrabold tracking-tight flex-1">{tt('러닝 코치')} <span className="text-xs text-emerald-500 font-bold">AI</span></h1>
        <button onClick={() => setShowSettings(s => !s)} aria-label={tt('설정')}
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90">
          <Settings size={18} className="text-emerald-600" />
        </button>
      </header>

      <div className="px-4 pt-4 space-y-4">
        {/* 설정 (펼침) — 2026-07-11 피드백: 이전엔 페이지 맨 아래에 열려서 "클릭이 안 된다"고
            느껴졌음. 기어 탭 즉시 보이도록 최상단으로 이동. */}
        {showSettings && (
          <div className="card p-5 space-y-3 border-emerald-200 dark:border-emerald-900/40">
            <div className="flex items-center gap-2">
              <Settings size={14} className="text-emerald-600" />
              <h3 className="text-sm font-extrabold">{tt('코치 설정')}</h3>
            </div>
            <p className="text-[13px] text-[var(--muted)] leading-relaxed">
              {tt('본인에게만 보여요. 랭킹·비교에 사용되지 않습니다.')}
            </p>

            <div>
              <label className="text-[13px] font-bold text-[var(--muted)] inline-flex items-center gap-1 mb-1">
                <Zap size={11} /> {tt('체중 (kg) — 칼로리 정확도')}
              </label>
              <input
                type="number" inputMode="decimal" min={20} max={250} step={0.1}
                value={weightInput} onChange={e => setWeightInput(e.target.value)}
                placeholder={tt('예: 65')}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--background)] border-2 border-[var(--card-border)] text-sm focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

            <div>
              <label className="text-[13px] font-bold text-[var(--muted)] inline-flex items-center gap-1 mb-1">
                <Heart size={11} /> {tt('최대 심박수 — HR Zones 분석용 (220 - 나이 가능)')}
              </label>
              <input
                type="number" inputMode="numeric" min={100} max={230}
                value={maxHrInput} onChange={e => setMaxHrInput(e.target.value)}
                placeholder={tt('예: 185')}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--background)] border-2 border-[var(--card-border)] text-sm focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

            <button
              onClick={handleSaveSettings} disabled={savingSettings}
              className="w-full py-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-sm active:scale-[0.98] disabled:opacity-50 shadow-md shadow-emerald-500/30 inline-flex items-center justify-center gap-1.5"
            >
              {savingSettings ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {tt('저장')}
            </button>
          </div>
        )}

        {/* 로드 실패 — 재시도 */}
        {loadError && !today && (
          <div className="card p-6 text-center space-y-3">
            <p className="text-sm font-bold text-[var(--foreground)]">{tt('코칭 데이터를 불러오지 못했어요')}</p>
            <button
              onClick={() => setReloadKey(k => k + 1)}
              className="px-5 py-2.5 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-sm font-extrabold active:scale-95"
            >
              {tt('다시 시도')}
            </button>
          </div>
        )}

        {/* 오늘 컨디션 hero — loadError 시엔 위의 재시도 카드가 대신 표시.
            build 302: `card` 의 background 쇼트핸드가 gradient 를 덮어써 흰 카드+흰 글씨였음 — 단독 클래스로 */}
        {today ? (
          <div className={`rounded-[20px] p-6 bg-gradient-to-br ${scoreColor} text-white shadow-lg`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] font-extrabold uppercase tracking-widest text-white/80">Today&apos;s Condition</span>
              <Sparkles size={16} className="text-white/90" />
            </div>
            <div className="flex items-baseline gap-2 mb-2">
              <p className="text-6xl font-extrabold tracking-tight tabular-nums">{today.score}</p>
              <p className="text-xl font-extrabold text-white/85">/ 100</p>
            </div>
            <p className="text-xl font-extrabold mb-1.5">{today.message}</p>
            <p className="text-sm text-white/90 leading-relaxed">{today.advice}</p>

            <div className="mt-4 pt-4 border-t border-white/20 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[12px] font-bold text-white/70 uppercase">{tt('장기 피트니스')}</p>
                <p className="text-lg font-extrabold tabular-nums">{today.ctl}</p>
              </div>
              <div>
                <p className="text-[12px] font-bold text-white/70 uppercase">{tt('최근 부하')}</p>
                <p className="text-lg font-extrabold tabular-nums">{today.atl}</p>
              </div>
              <div>
                <p className="text-[12px] font-bold text-white/70 uppercase">{tt('컨디션')}</p>
                <p className={`text-lg font-extrabold tabular-nums ${today.tsb > 0 ? 'text-white' : 'text-white/85'}`}>
                  {today.tsb > 0 ? '+' : ''}{today.tsb}
                </p>
              </div>
            </div>
          </div>
        ) : !loadError ? (
          <div className="card p-6 text-center text-sm text-[var(--muted)]">
            {tt('아직 분석할 활동이 부족해요. 2~3km 가볍게 달려보세요.')}
          </div>
        ) : null}

        {/* 타겟 레이스 카운트다운 (build 199) */}
        <TargetRaceCard />

        {/* 2026-08-02 hans "내용 빈약": 예상 레이스 기록 (Riegel) + 주간 훈련량/부하 밸런스 */}
        <RacePredictionCard />
        <WeeklyLoadCard />

        {/* 14일 차트 */}
        {trend.length > 0 && (
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-3">
              <Activity size={14} className="text-emerald-600" />
              <h3 className="text-lg font-extrabold">{tt('최근 14일 부하 흐름')}</h3>
            </div>
            <MiniChart data={trend.slice(-14)} />
            <p className="text-[13px] text-[var(--muted)] mt-3 leading-relaxed">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1" /> {tt('장기 피트니스 (꾸준함)')}
              {'  '}<span className="inline-block w-2 h-2 rounded-full bg-slate-400 mr-1" /> {tt('최근 부하 (피로)')}
            </p>
          </div>
        )}

        {/* 안내 카드 */}
        <div className="card p-4 bg-emerald-50/40 dark:bg-emerald-950/15 border-emerald-200/40 dark:border-emerald-900/30 flex items-start gap-2.5">
          <Info size={14} className="text-emerald-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-extrabold text-emerald-700 dark:text-emerald-300">{tt('코칭은 어떻게 계산되나요?')}</p>
            <p className="text-[13px] text-[var(--muted)] mt-1 leading-relaxed">
              {tt('거리 · 시간 기반으로 매일 부하 점수를 매기고, 장기 평균(42일)과 단기 평균(7일)의 차이로 오늘 컨디션을 산출해요. 체중·최대 심박수 입력 시 더 정확해져요.')}
            </p>
          </div>
        </div>

      </div>

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2500} />}
    </div>
  );
}

// 미니 SVG 차트 — CTL (emerald) + ATL (slate) 라인. (2026-08-02 톤 통일)
function MiniChart({ data }: { data: TrendRow[] }) {
  if (data.length === 0) return null;
  const W = 320;
  const H = 80;
  const padX = 8;
  const padY = 10;
  const maxV = Math.max(1, ...data.map(d => Math.max(d.ctl, d.atl)));
  const stepX = (W - padX * 2) / Math.max(1, data.length - 1);

  const pathFor = (key: 'ctl' | 'atl') => data.map((d, i) => {
    const x = padX + i * stepX;
    const y = H - padY - (Number(d[key]) / maxV) * (H - padY * 2);
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20">
      <path d={pathFor('ctl')} stroke="#10B981" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d={pathFor('atl')} stroke="#94A3B8" strokeWidth="2" fill="none" strokeDasharray="3 3" strokeLinecap="round" />
      {data.map((d, i) => (
        <circle key={i} cx={padX + i * stepX} cy={H - padY - (Number(d.ctl) / maxV) * (H - padY * 2)} r="2" fill="#059669" />
      ))}
    </svg>
  );
}
