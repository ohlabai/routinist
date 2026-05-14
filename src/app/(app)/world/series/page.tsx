'use client';

// 챌린지 시리즈 상세 (build 131).
// /world/series?slug=korea_heritage 형태 query string (output: export 호환)

import { useEffect, useState, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Trophy, MapPin, Sparkles, Coins, Check, Award, X, Truck } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import AppLogo from '@/components/AppLogo';
import AppToast from '@/components/AppToast';
import CourseDetailSheet from '@/components/world/CourseDetailSheet';
import { fetchMySeriesMedalStatus, requestSeriesMedal, type SeriesMedalStatus, type MedalShippingForm } from '@/lib/world-data';
import { useAuth } from '@/components/AuthProvider';

interface SeriesCourse {
  course_id: string;
  name: string;
  country: string | null;
  description: string | null;
  distance_km: number;
  preview_path: { x: number; y: number }[] | null;
  entry_fee_p: number;
  series_name: string;
  series_emoji: string;
  series_description: string;
  my_started_at: string | null;
  my_completed_at: string | null;
  my_progress_km: number;
}

const SERIES_MEDAL_PRICE = 50000;

function SeriesInner() {
  const sp = useSearchParams();
  const slug = sp.get('slug') ?? '';
  const router = useRouter();
  const { profile } = useAuth();
  const [rows, setRows] = useState<SeriesCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [openCourseId, setOpenCourseId] = useState<string | null>(null);
  const [medalStatus, setMedalStatus] = useState<SeriesMedalStatus | null>(null);
  const [seriesIdLocal, setSeriesIdLocal] = useState<string | null>(null);
  const [medalFormOpen, setMedalFormOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2000);
  };

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.rpc('fetch_series_courses', { p_slug: slug });
      if (error) throw error;
      const list = (data ?? []) as SeriesCourse[];
      setRows(list);

      // series_id 찾고 메달 상태 fetch
      const { data: sData } = await supabase.from('course_series').select('id').eq('slug', slug).maybeSingle();
      if (sData?.id) {
        setSeriesIdLocal(sData.id);
        const status = await fetchMySeriesMedalStatus(sData.id).catch(() => null);
        setMedalStatus(status);
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : '조회 실패', 'warn');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  const seriesMeta = rows[0];
  const completed = rows.filter(r => r.my_completed_at).length;
  const started = rows.filter(r => r.my_started_at).length;
  const pct = rows.length > 0 ? Math.round((completed / rows.length) * 100) : 0;
  const allDone = completed > 0 && completed === rows.length;

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/85 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="px-3 py-3 flex items-center gap-2">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full active:bg-[var(--card-border)]/30">
            <ArrowLeft size={20} />
          </button>
          <AppLogo size={24} />
          <h1 className="text-xl font-extrabold tracking-tight">챌린지 시리즈</h1>
        </div>
      </header>

      <div className="p-4 space-y-3">
        {!slug ? (
          <Link href="/ranking?tab=world" className="block card p-5 text-center">
            <p className="text-sm font-bold">시리즈를 선택해주세요</p>
            <p className="text-xs text-emerald-600 mt-1">월드런 탭으로 →</p>
          </Link>
        ) : loading ? (
          <>
            <div className="card p-5 h-40 animate-pulse" />
            {[0,1,2].map(i => <div key={i} className="card p-4 h-32 animate-pulse" />)}
          </>
        ) : !seriesMeta ? (
          <p className="text-center py-12 text-sm text-[var(--muted)]">시리즈를 찾을 수 없어요</p>
        ) : (
          <>
            <div className={`relative overflow-hidden rounded-3xl p-5 shadow-lg ${
              allDone ? 'bg-gradient-to-br from-amber-400 to-orange-500 shadow-amber-500/40' : 'bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-500/30'
            }`}>
              <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/10 blur-2xl" />
              <div className="relative">
                <div className="text-3xl mb-1">{seriesMeta.series_emoji}</div>
                <h2 className="text-xl font-extrabold text-white">{seriesMeta.series_name}</h2>
                <p className="text-xs text-white/90 mt-1 leading-relaxed">{seriesMeta.series_description}</p>
                <div className="mt-3">
                  <div className="flex items-center gap-2 text-xs font-extrabold text-white mb-1.5">
                    <span>진행률 {pct}%</span>
                    <span className="text-white/85">완주 {completed} / {rows.length}</span>
                    {started > completed && <span className="text-white/85">· 진행중 {started - completed}</span>}
                  </div>
                  <div className="h-2.5 rounded-full bg-white/25 overflow-hidden">
                    <div className="h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                {allDone && (
                  <button
                    onClick={() => setMedalFormOpen(true)}
                    disabled={medalStatus?.request_status === 'paid' || medalStatus?.request_status === 'shipped' || medalStatus?.request_status === 'delivered'}
                    className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white text-amber-700 dark:text-amber-800 font-extrabold text-xs disabled:opacity-70 active:scale-95 shadow-md"
                  >
                    <Award size={14} /> {medalStatus?.request_status === 'requested' ? '신청 완료' :
                      medalStatus?.request_status === 'paid' ? '결제 확인됨' :
                      medalStatus?.request_status === 'shipped' ? '발송됨' :
                      medalStatus?.request_status === 'delivered' ? '배송 완료' :
                      `시리즈 메달 신청 · ${SERIES_MEDAL_PRICE.toLocaleString()}원`}
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              {rows.map((c, i) => {
                const done = !!c.my_completed_at;
                const inProgress = !!c.my_started_at && !done;
                const progress = c.distance_km > 0 ? Math.min(100, (c.my_progress_km / c.distance_km) * 100) : 0;
                return (
                  <button
                    key={c.course_id}
                    onClick={() => setOpenCourseId(c.course_id)}
                    className={`w-full rounded-2xl border-2 p-4 text-left active:scale-[0.99] transition ${
                      done ? 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-300/60' :
                      inProgress ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-300/60' :
                      'bg-[var(--card)] border-[var(--card-border)]'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 ${
                        done ? 'bg-gradient-to-br from-amber-400 to-orange-500' : 'bg-emerald-100 dark:bg-emerald-900/40'
                      }`}>
                        {done ? <Trophy size={20} className="text-white" /> : <span className="text-base font-extrabold text-emerald-700 dark:text-emerald-300">{i + 1}</span>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-base font-extrabold truncate">{c.name}</p>
                        <p className="text-xs text-[var(--muted)] inline-flex items-center gap-1 mt-0.5">
                          <MapPin size={11} /> {c.country ?? '세계'} · {c.distance_km.toFixed(1)}km
                          <Coins size={11} className="ml-1 text-amber-500" />
                          <span className="font-bold">{c.entry_fee_p}</span>
                        </p>
                      </div>
                      {done && <Check size={18} className="text-amber-600 flex-shrink-0 mt-1" />}
                    </div>
                    {inProgress && (
                      <div className="mt-3">
                        <div className="h-1.5 rounded-full bg-[var(--card-border)]/30 overflow-hidden">
                          <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600" style={{ width: `${progress}%` }} />
                        </div>
                        <p className="text-[10px] text-emerald-600 font-bold mt-1">{c.my_progress_km.toFixed(1)} / {c.distance_km.toFixed(1)}km · {progress.toFixed(0)}%</p>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {openCourseId && (
        <CourseDetailSheet courseId={openCourseId} onClose={() => { setOpenCourseId(null); load(); }} />
      )}

      {medalFormOpen && seriesIdLocal && seriesMeta && (
        <SeriesMedalRequestForm
          seriesId={seriesIdLocal}
          seriesName={seriesMeta.series_name}
          initialName={profile?.display_name ?? ''}
          existing={medalStatus}
          onClose={() => setMedalFormOpen(false)}
          onSubmitted={async () => { setMedalFormOpen(false); showToast('✨ 시리즈 메달 신청됨'); await load(); }}
          onError={(m) => showToast(m, 'warn')}
        />
      )}

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2000} />}
    </div>
  );
}

function SeriesMedalRequestForm({ seriesId, seriesName, initialName, existing, onClose, onSubmitted, onError }: {
  seriesId: string;
  seriesName: string;
  initialName: string;
  existing: SeriesMedalStatus | null;
  onClose: () => void;
  onSubmitted: () => void;
  onError: (m: string) => void;
}) {
  const [form, setForm] = useState<MedalShippingForm>({
    shipping_name: existing?.shipping_name ?? initialName,
    shipping_phone: '',
    shipping_address: existing?.shipping_address ?? '',
    shipping_zipcode: '',
    payment_amount: SERIES_MEDAL_PRICE,
  });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!form.shipping_name || !form.shipping_phone || !form.shipping_address) {
      onError('이름·연락처·주소 모두 입력해주세요');
      return;
    }
    setBusy(true);
    try {
      await requestSeriesMedal(seriesId, form);
      onSubmitted();
    } catch (e) {
      onError(e instanceof Error ? e.message : '신청 실패');
    } finally {
      setBusy(false);
    }
  };

  const fieldCls = 'w-full px-4 py-3.5 rounded-xl border-2 border-[var(--card-border)] bg-[var(--card)] text-[15px] focus:outline-none focus:border-amber-500';

  return (
    <div className="fixed inset-0 z-[80] bg-black/65 flex items-end sm:items-center justify-center sm:p-3" onClick={() => !busy && onClose()}>
      <div className="w-full sm:max-w-md bg-[var(--background)] rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 px-5 pt-4 pb-3 bg-[var(--background)] border-b border-amber-100 dark:border-amber-950/40 rounded-t-3xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                <Award size={20} className="text-white" />
              </div>
              <div>
                <h3 className="text-base font-extrabold">시리즈 메달 신청</h3>
                <p className="text-[11px] text-[var(--muted)] mt-0.5 truncate">{seriesName}</p>
              </div>
            </div>
            <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[var(--card-border)]/40 active:scale-90"><X size={18} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div className="rounded-2xl bg-gradient-to-br from-amber-50 to-amber-50/60 dark:from-amber-950/30 dark:to-amber-950/10 border border-amber-200/60 dark:border-amber-800/40 p-4">
            <p className="text-sm font-extrabold text-amber-900 dark:text-amber-200 inline-flex items-center gap-1.5">
              <Sparkles size={14} /> 시리즈 완주 메달 {SERIES_MEDAL_PRICE.toLocaleString()}원
            </p>
            <p className="text-[11px] text-amber-700/80 dark:text-amber-300/80 mt-1 leading-relaxed">
              실물 메달 + 디스플레이 케이스 + 배송비 포함. 신청 접수 후 결제 안내 메시지를 보내드려요.
            </p>
          </div>

          <div>
            <label className="block text-xs font-extrabold text-[var(--muted)] mb-1">받는 분</label>
            <input value={form.shipping_name} onChange={(e) => setForm({ ...form, shipping_name: e.target.value })} className={fieldCls} />
          </div>
          <div>
            <label className="block text-xs font-extrabold text-[var(--muted)] mb-1">연락처</label>
            <input type="tel" value={form.shipping_phone} onChange={(e) => setForm({ ...form, shipping_phone: e.target.value })} className={fieldCls} placeholder="010-0000-0000" />
          </div>
          <div>
            <label className="block text-xs font-extrabold text-[var(--muted)] mb-1">우편번호</label>
            <input value={form.shipping_zipcode} onChange={(e) => setForm({ ...form, shipping_zipcode: e.target.value })} className={fieldCls} maxLength={6} />
          </div>
          <div>
            <label className="block text-xs font-extrabold text-[var(--muted)] mb-1">주소</label>
            <textarea value={form.shipping_address} onChange={(e) => setForm({ ...form, shipping_address: e.target.value })} rows={3} className={`${fieldCls} resize-none`} />
          </div>
        </div>
        <div className="sticky bottom-0 px-5 py-4 bg-[var(--background)] border-t border-[var(--card-border)]/40" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}>
          <button
            onClick={submit}
            disabled={busy}
            className="w-full py-4 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 text-white font-extrabold text-base disabled:opacity-50 active:scale-[0.98] inline-flex items-center justify-center gap-1.5 shadow-lg shadow-amber-500/30"
          >
            {busy ? '접수 중…' : <><Truck size={16} /> 신청하기</>}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SeriesDetailPage() {
  return (
    <Suspense fallback={<div className="p-8 flex justify-center"><div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" /></div>}>
      <SeriesInner />
    </Suspense>
  );
}
