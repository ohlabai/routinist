'use client';

// 월드런 코스 상세 sheet (build 112 Phase A).
// 라이브 트래커 (참가자 마커) + 디지털 인증서 PDF + 메달 신청 폼.

import { useEffect, useState, useCallback, useRef } from 'react';
import { X, Trophy, Users, Award, MapPin, Download, Truck, Globe, Crown, Sparkles } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
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

interface Props {
  courseId: string;
  onClose: () => void;
}

const MEDAL_PRICE = 30000;

export default function CourseDetailSheet({ courseId, onClose }: Props) {
  const { user, profile } = useAuth();
  const [course, setCourse] = useState<VirtualCourse | null>(null);
  const [runners, setRunners] = useState<CourseRunner[]>([]);
  const [medal, setMedal] = useState<MedalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [medalFormOpen, setMedalFormOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

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
    setLoading(false);
  }, [courseId, user]);

  useEffect(() => { load(); }, [load]);

  const myRunner = runners.find(r => r.user_id === user?.id);
  const completed = !!myRunner?.completed_at;

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
                <h3 className="text-base font-extrabold tracking-tight truncate">{course?.name ?? '코스'}</h3>
                <p className="text-[11px] text-[var(--muted)] truncate">
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
            <p className="text-center text-sm text-[var(--muted)] py-12">코스를 찾을 수 없어요</p>
          ) : (
            <>
              {/* 큰 지도 + 라이브 트래커 */}
              <LiveTrackerMap
                path={course.preview_path}
                runners={runners}
                myUserId={user?.id ?? null}
              />

              {/* 코스 설명 */}
              {course.description && (
                <div className="rounded-2xl bg-[var(--card)] border border-[var(--card-border)] p-4">
                  <p className="text-[14px] text-[var(--foreground)] leading-relaxed break-keep">{course.description}</p>
                </div>
              )}

              {/* 내 진행 상황 */}
              {myRunner && (
                <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-emerald-50/40 dark:from-emerald-950/40 dark:to-emerald-950/20 border-2 border-emerald-300/60 dark:border-emerald-800/40 p-4">
                  <p className="text-xs font-extrabold text-emerald-700 dark:text-emerald-300 mb-1.5">내 진행</p>
                  <p className="text-2xl font-extrabold tabular-nums">
                    {myRunner.progress_km.toFixed(1)}
                    <span className="text-sm font-bold text-[var(--muted)]"> / {course.distance_km.toFixed(1)}km</span>
                  </p>
                  <div className="mt-2 h-2.5 rounded-full bg-white/60 dark:bg-zinc-900/60 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600" style={{ width: `${Math.min(100, myRunner.ratio * 100)}%` }} />
                  </div>
                  {completed ? (
                    <p className="mt-2 text-sm font-extrabold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1">
                      <Trophy size={14} /> 완주! {myRunner.completed_at && new Date(myRunner.completed_at).toLocaleDateString('ko-KR')}
                    </p>
                  ) : (
                    <p className="mt-1.5 text-xs text-[var(--muted)]">남은 거리 {Math.max(0, course.distance_km - myRunner.progress_km).toFixed(1)}km</p>
                  )}
                </div>
              )}

              {/* 참가자 리더보드 */}
              <div>
                <h4 className="text-sm font-extrabold mb-2 inline-flex items-center gap-1.5">
                  <Users size={14} className="text-emerald-500" /> 같은 코스 도전 중 · {runners.length}명
                </h4>
                {runners.length === 0 ? (
                  <p className="text-xs text-[var(--muted)] italic">아직 도전 중인 사람이 없어요. 첫 번째가 되어보세요.</p>
                ) : (
                  <div className="space-y-1.5">
                    {runners.slice(0, 10).map((r, i) => {
                      const isMe = r.user_id === user?.id;
                      const pct = Math.round(r.ratio * 100);
                      return (
                        <div key={r.user_id} className={`flex items-center gap-2.5 px-3 py-2 rounded-xl ${isMe ? 'bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-800/40' : 'bg-[var(--card)] border border-[var(--card-border)]/40'}`}>
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-extrabold flex-shrink-0 ${
                            i === 0 ? 'bg-amber-100 text-amber-700' :
                            i === 1 ? 'bg-zinc-200 text-zinc-700' :
                            i === 2 ? 'bg-orange-100 text-orange-700' :
                            'bg-[var(--card-border)]/40 text-[var(--muted)]'
                          }`}>{i + 1}</span>
                          <div className="w-8 h-8 rounded-full bg-[var(--card-border)]/40 overflow-hidden flex-shrink-0">
                            {r.avatar_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-xs font-bold text-[var(--muted)]">
                                {r.display_name.slice(0, 1)}
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">
                              {r.display_name}{isMe && <span className="ml-1 text-[10px] text-emerald-600 font-bold">(나)</span>}
                              {r.completed_at && <Crown size={11} className="inline ml-1 text-amber-500" />}
                            </p>
                            <p className="text-[10px] text-[var(--muted)]">{r.progress_km.toFixed(1)}km · {pct}%</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 완주자 인증서 + 메달 신청 */}
              {completed && course && (
                <div className="rounded-2xl bg-gradient-to-br from-amber-50 via-amber-50/60 to-yellow-50/40 dark:from-amber-950/40 dark:to-amber-950/20 border-2 border-amber-300/60 dark:border-amber-800/40 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-md shadow-amber-500/30">
                      <Trophy size={20} className="text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-extrabold text-amber-900 dark:text-amber-200">🎉 완주 축하해요!</p>
                      <p className="text-[11px] text-amber-700/80 dark:text-amber-300/80">디지털 인증서를 다운받거나 실물 메달을 신청하세요</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => downloadCertificate(course, profile?.display_name ?? '러너', myRunner!)}
                      className="py-3 rounded-xl bg-white dark:bg-zinc-900 border-2 border-amber-300/60 dark:border-amber-800/40 text-amber-700 dark:text-amber-300 font-extrabold text-sm active:scale-[0.98] inline-flex items-center justify-center gap-1.5"
                    >
                      <Download size={14} /> 인증서
                    </button>
                    <button
                      onClick={() => setMedalFormOpen(true)}
                      disabled={medal?.request_status === 'paid' || medal?.request_status === 'shipped' || medal?.request_status === 'delivered'}
                      className="py-3 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 text-white font-extrabold text-sm disabled:opacity-50 active:scale-[0.98] inline-flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/30"
                    >
                      <Award size={14} /> {medal?.request_status === 'requested' ? '신청 완료' : '메달 신청'}
                    </button>
                  </div>

                  {medal?.request_status && medal.request_status !== 'none' && (
                    <div className="text-[11px] text-amber-800 dark:text-amber-200 px-2 py-2 rounded-lg bg-white/40 dark:bg-black/20">
                      <span className="font-extrabold">상태:</span> {STATUS_LABEL[medal.request_status]}
                      {medal.shipping_address && <> · {medal.shipping_address.slice(0, 40)}</>}
                    </div>
                  )}

                  <p className="text-[10px] text-amber-700/70 dark:text-amber-300/70 leading-relaxed">
                    💌 실물 메달은 {MEDAL_PRICE.toLocaleString()}원 (배송비 포함). 신청 후 1~2주 내 발송.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {medalFormOpen && course && (
          <MedalRequestForm
            courseId={course.id}
            courseName={course.name}
            initialName={profile?.display_name ?? ''}
            existing={medal}
            onClose={() => setMedalFormOpen(false)}
            onSubmitted={async () => { setMedalFormOpen(false); showToast('✨ 메달 신청이 접수됐어요'); await load(); }}
            onError={(msg) => showToast(msg, 'warn')}
          />
        )}

        {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2200} />}
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
                <div className={`w-full h-full flex items-center justify-center font-extrabold text-[10px] ${isMe ? 'bg-emerald-500 text-white' : 'bg-white text-emerald-600'}`}>
                  {r.display_name.slice(0, 1)}
                </div>
              )}
            </div>
            <div className={`mt-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-extrabold whitespace-nowrap max-w-[80px] truncate ${isMe ? 'bg-emerald-500 text-white' : 'bg-white/95 dark:bg-zinc-900/95 text-[var(--foreground)] shadow-sm'}`}>
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
      onError('받는분 / 연락처 / 주소 모두 입력해주세요');
      return;
    }
    setSubmitting(true);
    try {
      await requestCourseMedal(courseId, form);
      onSubmitted();
    } catch (e) {
      onError(e instanceof Error ? e.message : '신청 실패');
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
                <h3 className="text-base font-extrabold">메달 신청</h3>
                <p className="text-[11px] text-[var(--muted)]">{courseName}</p>
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
              <Sparkles size={14} /> 기념 메달 {MEDAL_PRICE.toLocaleString()}원
            </p>
            <p className="text-[11px] text-amber-700/80 dark:text-amber-300/80 mt-1 leading-relaxed">
              배송비 포함. 신청 접수 후 결제 안내 메시지를 보내드려요. 결제 확인 후 1~2주 내 발송.
            </p>
          </div>

          <Field label="받는 분">
            <input
              value={form.shipping_name}
              onChange={(e) => setForm({ ...form, shipping_name: e.target.value })}
              placeholder="이름"
              className={inputCls}
            />
          </Field>
          <Field label="연락처">
            <input
              type="tel"
              value={form.shipping_phone}
              onChange={(e) => setForm({ ...form, shipping_phone: e.target.value })}
              placeholder="010-0000-0000"
              className={inputCls}
            />
          </Field>
          <Field label="우편번호">
            <input
              value={form.shipping_zipcode}
              onChange={(e) => setForm({ ...form, shipping_zipcode: e.target.value })}
              placeholder="00000"
              className={inputCls}
              maxLength={6}
            />
          </Field>
          <Field label="주소">
            <textarea
              value={form.shipping_address}
              onChange={(e) => setForm({ ...form, shipping_address: e.target.value })}
              placeholder="도로명 + 상세주소"
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
            {submitting ? '접수 중…' : <><Truck size={16} /> 신청하기</>}
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

// ── 인증서 PDF 다운로드 (canvas → png blob → 다운로드) ──────────
function downloadCertificate(course: VirtualCourse, displayName: string, runner: CourseRunner) {
  const W = 1600;
  const H = 1131;  // A4 가로 비율 1.414
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // 배경 — 크림 + 에메랄드 액센트
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#fefce8');
  bg.addColorStop(1, '#f0fdf4');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 테두리 — 에메랄드 두꺼운 + 안쪽 얇은
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 20;
  ctx.strokeRect(40, 40, W - 80, H - 80);
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 4;
  ctx.strokeRect(70, 70, W - 140, H - 140);

  ctx.textAlign = 'center';

  // 헤더 — Routinist
  ctx.fillStyle = '#10b981';
  ctx.font = 'bold 36px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('ROUTINIST · WORLD RUN', W / 2, 160);

  // 타이틀 — CERTIFICATE OF COMPLETION
  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold 92px Georgia, serif';
  ctx.fillText('완주 인증서', W / 2, 300);

  // 부제
  ctx.fillStyle = '#6b7280';
  ctx.font = '32px Georgia, serif';
  ctx.fillText('CERTIFICATE OF COMPLETION', W / 2, 350);

  // 이름
  ctx.fillStyle = '#10b981';
  ctx.font = 'bold 110px Georgia, serif';
  ctx.fillText(displayName, W / 2, 540);

  // "은(는) 다음 코스를 완주하였습니다"
  ctx.fillStyle = '#374151';
  ctx.font = '36px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('님은 다음 가상 코스를 완주하였습니다.', W / 2, 610);

  // 코스명
  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold 72px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(course.name, W / 2, 730);

  // 거리 + 국가
  ctx.fillStyle = '#10b981';
  ctx.font = 'bold 56px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(`${course.distance_km.toFixed(1)} km · ${course.country ?? '세계'}`, W / 2, 820);

  // 완주일
  const dateStr = runner.completed_at
    ? new Date(runner.completed_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  ctx.fillStyle = '#6b7280';
  ctx.font = '32px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(`완주일: ${dateStr}`, W / 2, 920);

  // 푸터 — 사인
  ctx.fillStyle = '#9ca3af';
  ctx.font = '24px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('Run Your Routine.', W / 2, 1020);
  ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillStyle = '#10b981';
  ctx.fillText('routinist.kr', W / 2, 1060);

  // 다운로드
  canvas.toBlob((blob) => {
    if (!blob) return;
    const link = document.createElement('a');
    link.download = `Routinist_${course.name.replace(/\s/g, '_')}_${displayName}.png`;
    link.href = URL.createObjectURL(blob);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }, 'image/png');
}
