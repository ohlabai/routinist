'use client';

// 동네 러너 지도 (build 124 — #9, #11).
// 본인 + 같은 region_gu 다른 러너의 최근 N일 폴리라인을 SVG 로 색별 표시.
// Google Maps 통합은 별도 build — 일단 가벼운 SVG 로 직관적 시각화.

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, MapPin, Users, Activity as ActivityIcon, ChevronRight } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { fetchRoutesForUser } from '@/lib/map-data';
import type { Activity } from '@/types';
import AppLogo from '@/components/AppLogo';
import AppToast from '@/components/AppToast';
import { track } from '@/lib/analytics';

interface NeighborhoodRoute {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  activity_id: string;
  distance_km: number;
  activity_date: string;
  route_data: { coordinates?: [number, number][] } | null;
}

type DaysFilter = 3 | 7 | 30;

// 12색 팔레트 — 본인은 emerald, 타인은 색 순환
const PALETTE = ['#3b82f6', '#f97316', '#a855f7', '#ec4899', '#06b6d4', '#84cc16', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9', '#22c55e', '#eab308'];

export default function NeighborhoodMapPage() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [days, setDays] = useState<DaysFilter>(7);
  const [myActivities, setMyActivities] = useState<Activity[]>([]);
  const [neighborRoutes, setNeighborRoutes] = useState<NeighborhoodRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [highlightUserId, setHighlightUserId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2000);
  };

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [mine, nb] = await Promise.all([
        fetchRoutesForUser(user.id, { daysBack: days, pageSize: days }).catch(() => [] as Activity[]),
        (async () => {
          const supabase = getSupabase();
          const { data, error } = await supabase.rpc('fetch_neighborhood_routes', { p_days: days, p_limit: 20 });
          if (error) throw error;
          return (data ?? []) as NeighborhoodRoute[];
        })().catch(() => [] as NeighborhoodRoute[]),
      ]);
      setMyActivities(mine);
      setNeighborRoutes(nb);
      track('neighborhood_map_view', { days, mine_count: mine.length, neighbor_count: nb.length });
    } catch (e) {
      showToast(e instanceof Error ? e.message : '조회 실패', 'warn');
    } finally {
      setLoading(false);
    }
  }, [user, days]);

  useEffect(() => { load(); }, [load]);

  // SVG viewBox 계산 — 본인 + 이웃 모든 좌표 모아서 bbox
  const svgData = useMemo(() => {
    const all: { lng: number; lat: number }[] = [];
    myActivities.forEach(a => {
      a.route_data?.coordinates?.forEach(([lng, lat]) => all.push({ lng, lat }));
    });
    neighborRoutes.forEach(r => {
      r.route_data?.coordinates?.forEach(([lng, lat]) => all.push({ lng, lat }));
    });
    if (all.length === 0) return null;
    const lngs = all.map(c => c.lng);
    const lats = all.map(c => c.lat);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    return { minLng, maxLng, minLat, maxLat };
  }, [myActivities, neighborRoutes]);

  const VBW = 100, VBH = 60;
  const PAD = 3;
  const toPath = (coords: [number, number][]): string => {
    if (!svgData || coords.length < 2) return '';
    const { minLng, maxLng, minLat, maxLat } = svgData;
    const spanLng = maxLng - minLng || 0.001;
    const spanLat = maxLat - minLat || 0.001;
    const scaleX = (VBW - PAD * 2) / spanLng;
    const scaleY = (VBH - PAD * 2) / spanLat;
    const scale = Math.min(scaleX, scaleY);
    const offX = PAD + ((VBW - PAD * 2) - spanLng * scale) / 2;
    const offY = PAD + ((VBH - PAD * 2) - spanLat * scale) / 2;
    return coords.map(([lng, lat], i) => {
      const x = offX + (lng - minLng) * scale;
      const y = VBH - (offY + (lat - minLat) * scale);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(' ');
  };

  const myCoords = myActivities.flatMap(a => a.route_data?.coordinates ?? []);
  const noRegion = !profile?.region_gu;

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/85 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="px-3 py-3 flex items-center gap-2">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full active:bg-[var(--card-border)]/30">
            <ArrowLeft size={20} />
          </button>
          <AppLogo size={24} />
          <h1 className="text-xl font-extrabold tracking-tight">동네 러너 지도</h1>
        </div>
        <div className="px-4 pb-3 flex items-center gap-1.5">
          {([3, 7, 30] as const).map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold active:scale-95 ${
                days === d ? 'bg-emerald-500 text-white shadow' : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
              }`}
            >
              최근 {d}일
            </button>
          ))}
          <span className="ml-auto text-[11px] text-[var(--muted)] font-bold">
            {profile?.region_gu ?? '지역 미설정'}
          </span>
        </div>
      </header>

      <div className="p-4 space-y-3">
        {noRegion ? (
          <Link href="/profile/edit" className="block rounded-2xl bg-gradient-to-br from-emerald-100/80 to-emerald-50/40 dark:from-emerald-950/30 dark:to-emerald-950/10 border border-emerald-200/60 p-5 active:scale-[0.99]">
            <p className="text-base font-extrabold inline-flex items-center gap-1.5">
              <MapPin size={16} className="text-emerald-600" /> 우리 동네부터 설정해주세요
            </p>
            <p className="text-sm text-[var(--muted)] mt-1.5 leading-relaxed">
              지역을 입력하면 같은 동네 러너의 코스를 보여드려요.
            </p>
            <p className="text-xs font-bold text-emerald-600 mt-2">프로필 편집 →</p>
          </Link>
        ) : (
          <>
            {/* 안내 */}
            <div className="rounded-2xl bg-gradient-to-br from-emerald-50/60 to-emerald-50/20 dark:from-emerald-950/30 dark:to-emerald-950/10 border border-emerald-200/50 dark:border-emerald-900/40 p-3">
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                <span className="font-extrabold text-emerald-700 dark:text-emerald-300">{profile?.region_gu}</span>에서 최근 {days}일 달린 러너들의 코스. 본인은 <span className="font-extrabold text-emerald-600">에메랄드</span>, 다른 러너는 색별로 구분돼요.
              </p>
            </div>

            {/* 지도 SVG */}
            <div className="rounded-2xl bg-gradient-to-br from-emerald-50/40 via-white to-teal-50/30 dark:from-zinc-900 dark:via-zinc-900 dark:to-zinc-900 border-2 border-[var(--card-border)] overflow-hidden">
              {loading ? (
                <div className="h-72 animate-pulse bg-[var(--card-border)]/30" />
              ) : !svgData ? (
                <div className="h-72 flex flex-col items-center justify-center text-[var(--muted)] gap-2 px-6">
                  <MapPin size={32} className="opacity-30" />
                  <p className="text-sm font-bold text-center">아직 동네에 GPS 활동이 없어요</p>
                  <p className="text-xs text-center">달리고 동기화하면 여기 표시돼요</p>
                </div>
              ) : (
                <svg viewBox={`0 0 ${VBW} ${VBH}`} preserveAspectRatio="xMidYMid meet" className="w-full" style={{ height: 320 }}>
                  <defs>
                    <pattern id="nb-grid" width="10" height="10" patternUnits="userSpaceOnUse">
                      <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(16,185,129,0.1)" strokeWidth="0.2" />
                    </pattern>
                  </defs>
                  <rect width={VBW} height={VBH} fill="url(#nb-grid)" />

                  {/* 이웃 러너 폴리라인 */}
                  {neighborRoutes.map((r, i) => {
                    const coords = r.route_data?.coordinates ?? [];
                    if (coords.length < 2) return null;
                    const color = PALETTE[i % PALETTE.length];
                    const opacity = highlightUserId && highlightUserId !== r.user_id ? 0.15 : 0.85;
                    return (
                      <path
                        key={r.user_id}
                        d={toPath(coords)}
                        fill="none"
                        stroke={color}
                        strokeWidth={highlightUserId === r.user_id ? 1.4 : 0.9}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={opacity}
                      />
                    );
                  })}

                  {/* 본인 폴리라인 (위) — 에메랄드 두꺼움 */}
                  {myCoords.length >= 2 && myActivities.map((a, i) => {
                    const raw = a.route_data?.coordinates ?? [];
                    const coords: [number, number][] = raw.map(c => [c[0], c[1]]);
                    if (coords.length < 2) return null;
                    return (
                      <path
                        key={`me-${i}`}
                        d={toPath(coords)}
                        fill="none"
                        stroke="#10b981"
                        strokeWidth={highlightUserId ? 1.3 : 1.8}
                        opacity={highlightUserId ? 0.4 : 1}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    );
                  })}
                </svg>
              )}
            </div>

            {/* 러너 list — 클릭 시 highlight */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-extrabold inline-flex items-center gap-1.5">
                  <Users size={14} className="text-emerald-500" /> 동네 러너 · {neighborRoutes.length}명
                </h3>
                {highlightUserId && (
                  <button onClick={() => setHighlightUserId(null)} className="text-[11px] font-bold text-emerald-600 active:scale-95">
                    전체 보기
                  </button>
                )}
              </div>

              {/* 본인 row */}
              {myActivities.length > 0 && (
                <div className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border-2 ${highlightUserId === null ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-300/60' : 'bg-[var(--card)] border-[var(--card-border)]/40'}`}>
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 flex-shrink-0" />
                  <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/40 overflow-hidden flex-shrink-0">
                    {profile?.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-sm font-bold text-emerald-700">{profile?.display_name?.slice(0,1) ?? '나'}</div>
                    )}
                  </div>
                  <span className="text-sm font-extrabold flex-1 truncate">나 ({profile?.display_name ?? '러너'})</span>
                  <span className="text-xs font-bold text-emerald-600 tabular-nums">
                    {myActivities.reduce((s, a) => s + Number(a.distance_km), 0).toFixed(1)}km
                  </span>
                </div>
              )}

              {/* 이웃 러너 rows */}
              {loading ? (
                [0,1,2].map(i => <div key={i} className="h-12 bg-[var(--card-border)]/30 animate-pulse rounded-xl" />)
              ) : neighborRoutes.length === 0 ? (
                <p className="text-center text-xs text-[var(--muted)] italic py-4">동네에 다른 러너가 아직 없어요</p>
              ) : (
                neighborRoutes.map((r, i) => {
                  const color = PALETTE[i % PALETTE.length];
                  const active = highlightUserId === r.user_id;
                  return (
                    <button
                      key={r.user_id}
                      onClick={() => setHighlightUserId(active ? null : r.user_id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border-2 transition active:scale-[0.99] ${
                        active ? 'border-emerald-300/60 bg-emerald-50/40 dark:bg-emerald-950/20' : 'border-[var(--card-border)]/40 bg-[var(--card)]'
                      }`}
                    >
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                      <div className="w-9 h-9 rounded-full bg-[var(--card-border)]/40 overflow-hidden flex-shrink-0">
                        {r.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-sm font-bold text-[var(--muted)]">{r.display_name.slice(0,1)}</div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-sm font-bold truncate">{r.display_name}</p>
                        <p className="text-[10px] text-[var(--muted)]">{r.activity_date} · {r.distance_km.toFixed(1)}km</p>
                      </div>
                      <Link
                        href={`/social/user?id=${r.user_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[11px] font-bold text-emerald-600 px-2 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 active:scale-95 inline-flex items-center gap-0.5"
                      >
                        프로필 <ChevronRight size={10} />
                      </Link>
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2000} />}
    </div>
  );
}
