'use client';

// 외부(앱 미가입) 클럽 멤버 월별 결산 — 클럽 상세 페이지의 "결산" 탭.
// HTML import 된 데이터를 읽기 전용으로 표시.

import { useEffect, useState, useCallback } from 'react';
import { Trophy, Coffee, Flame, ChevronDown, ChevronUp, Calendar, TrendingUp } from 'lucide-react';
import {
  fetchClubMonthlySummary,
  fetchClubExternalArchives,
  fetchMemberRunEvents,
  type ClubExternalMonthlySummary,
  type ClubExternalRunEvent,
} from '@/lib/club-external';
import { useI18n } from '@/lib/i18n';

interface Props {
  clubId: string;
}

export default function ClubExternalArchive({ clubId }: Props) {
  const { tt, locale } = useI18n();
  const [archives, setArchives] = useState<Array<{ year: number; month: number }>>([]);
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [rows, setRows] = useState<ClubExternalMonthlySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, ClubExternalRunEvent[] | null>>({});

  // 사용 가능한 (year, month) 목록 + 최신 자동 선택
  useEffect(() => {
    let cancelled = false;
    fetchClubExternalArchives(clubId).then(list => {
      if (cancelled) return;
      setArchives(list);
      if (list.length > 0 && year === null) {
        setYear(list[0].year);
        setMonth(list[0].month);
      } else {
        setLoading(false);
      }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clubId, year]);

  // 선택한 월의 결산 로드
  useEffect(() => {
    if (year === null || month === null) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetchClubMonthlySummary(clubId, year, month).then(data => {
      if (!cancelled) {
        setRows(data);
        setExpanded({});
      }
    }).catch(() => {}).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [clubId, year, month]);

  const toggleExpand = useCallback(async (memberId: string) => {
    if (year === null || month === null) return;
    if (expanded[memberId] !== undefined) {
      setExpanded(prev => {
        const next = { ...prev };
        delete next[memberId];
        return next;
      });
      return;
    }
    setExpanded(prev => ({ ...prev, [memberId]: null }));
    try {
      const events = await fetchMemberRunEvents(memberId, year, month);
      setExpanded(prev => ({ ...prev, [memberId]: events }));
    } catch {
      setExpanded(prev => {
        const next = { ...prev };
        delete next[memberId];
        return next;
      });
    }
  }, [year, month, expanded]);

  if (archives.length === 0 && !loading) {
    return (
      <div className="px-4 py-12 text-center">
        <Calendar size={28} className="mx-auto text-[var(--muted)] mb-3" />
        <p className="text-sm font-bold text-[var(--foreground)]">{tt('아직 결산 데이터가 없어요')}</p>
        <p className="text-xs text-[var(--muted)] mt-2 leading-relaxed">
          {tt('관리자가 월별 HTML 결산을 import 하면')}<br/>{tt('여기에서 회원별 기록을 확인할 수 있어요')}
        </p>
      </div>
    );
  }

  // 합계 통계
  const totalKm = rows.reduce((sum, r) => sum + Number(r.total_km), 0);
  const passedCount = rows.filter(r => r.pass50).length;
  const goalAchievedCount = rows.filter(r => r.goal_achieved === true).length;
  const maxKm = rows[0] ? Number(rows[0].total_km) : 1;

  return (
    <div className="px-4 py-3 space-y-4">
      {/* year/month 셀렉터 */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {archives.map(a => {
          const active = a.year === year && a.month === month;
          return (
            <button
              key={`${a.year}-${a.month}`}
              type="button"
              onClick={() => { setYear(a.year); setMonth(a.month); }}
              className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-sm font-semibold transition-all ${
                active
                  ? 'bg-[var(--accent)] text-white shadow-sm'
                  : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--muted)]'
              }`}
            >
              {a.year}.{String(a.month).padStart(2, '0')}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
        </div>
      ) : (
        <>
          {/* 합계 */}
          <div className="grid grid-cols-3 gap-2">
            <Stat icon={<TrendingUp size={16} />} label={tt('총 거리')} value={`${totalKm.toFixed(0)}km`} />
            <Stat icon={<Flame size={16} />} label={tt('50km 통과')} value={`${passedCount}/${rows.length}`} />
            <Stat icon={<Trophy size={16} />} label={tt('목표 달성')} value={locale === 'en' ? `${goalAchievedCount}` : `${goalAchievedCount}명`} />
          </div>

          {/* 멤버 랭킹 */}
          <div className="space-y-2">
            {rows.map((r, i) => {
              const isExpanded = expanded[r.member_id] !== undefined;
              const events = expanded[r.member_id];
              const pct = r.goal_pct === null ? null : Math.min(100, Number(r.goal_pct));
              const barWidth = (Number(r.total_km) / maxKm) * 100;
              return (
                <div
                  key={r.member_id}
                  className="rounded-2xl bg-[var(--card)] border border-[var(--card-border)] overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => toggleExpand(r.member_id)}
                    className="w-full p-3 text-left active:bg-[var(--card-border)]/30 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 text-center font-extrabold ${
                        i === 0 ? 'text-amber-500 text-lg' :
                        i === 1 ? 'text-gray-400 text-base' :
                        i === 2 ? 'text-amber-700 text-base' :
                        'text-[var(--muted)] text-sm'
                      }`}>
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between mb-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-[var(--foreground)]">{r.name}</span>
                            {r.goal_achieved === true && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold inline-flex items-center gap-0.5">
                                <Coffee size={10} /> {tt('쿠폰')}
                              </span>
                            )}
                            {!r.pass50 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 font-semibold">{tt('휴면')}</span>
                            )}
                          </div>
                          <span className="text-base font-extrabold text-[var(--foreground)]">
                            {Number(r.total_km).toFixed(1)}<span className="text-xs text-[var(--muted)] ml-0.5">km</span>
                          </span>
                        </div>
                        <div className="h-2 bg-[var(--card-border)] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${i === 0 ? 'bg-amber-400' : 'bg-[var(--accent)]'}`}
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between mt-1 text-[11px] text-[var(--muted)]">
                          <span>{locale === 'en' ? `${r.run_count} runs · ${r.days_count} days` : `${r.run_count}회 · ${r.days_count}일`}</span>
                          {r.goal_km !== null && pct !== null && (
                            <span className={r.goal_achieved ? 'text-emerald-600 font-semibold' : ''}>
                              {tt('목표')} {Number(r.goal_km)}km · {pct.toFixed(0)}%
                            </span>
                          )}
                        </div>
                      </div>
                      {isExpanded ? <ChevronUp size={16} className="text-[var(--muted)]" /> : <ChevronDown size={16} className="text-[var(--muted)]" />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-[var(--card-border)] px-3 py-2 bg-[var(--background)]">
                      {events === null ? (
                        <div className="py-3 flex justify-center">
                          <div className="animate-spin w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
                        </div>
                      ) : events.length === 0 ? (
                        <p className="py-2 text-xs text-[var(--muted)] text-center">{tt('기록이 없어요')}</p>
                      ) : (
                        <ul className="divide-y divide-[var(--card-border)]">
                          {events.map(e => (
                            <li key={e.id} className="py-1.5 flex items-center justify-between text-sm">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-[11px] text-[var(--muted)]">
                                  {e.activity_date.slice(5)}
                                </span>
                                {e.started_at && (
                                  <span className="font-mono text-[10px] text-[var(--muted)]">
                                    {new Date(e.started_at).toLocaleTimeString(locale === 'en' ? 'en-US' : 'ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}
                                  </span>
                                )}
                              </div>
                              <span className="font-bold text-[var(--foreground)]">
                                {Number(e.distance_km).toFixed(2)}<span className="text-[10px] text-[var(--muted)] ml-0.5">km</span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {rows.length === 0 && (
            <p className="py-8 text-center text-sm text-[var(--muted)]">{tt('이 달은 기록이 없어요')}</p>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[var(--card)] border border-[var(--card-border)] p-2.5">
      <div className="flex items-center gap-1 text-[10px] text-[var(--muted)] mb-0.5">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-base font-extrabold text-[var(--foreground)]">{value}</div>
    </div>
  );
}
