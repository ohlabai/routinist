'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useState, useMemo, Suspense } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine, LabelList, ComposedChart } from 'recharts';
import { useData, getTotalDistance, getMemberRecords, getMemberBadges } from '@/components/DataProvider';
import { useTheme } from '@/components/ThemeProvider';
import { getTooltipStyle, getAxisColor, getTextColor } from '@/lib/chart-theme';
import Badges from '@/components/Badges';
import { useI18n } from '@/lib/i18n';

function MemberPageContent() {
  const searchParams = useSearchParams();
  const name = searchParams.get('name') || '';
  const { theme } = useTheme();
  const { tt, locale } = useI18n();
  const { members, records, runningLogs, loading } = useData();
  const isDark = theme === 'dark';
  const member = members.find(m => m.name === name);

  if (loading) return <div className="max-w-5xl mx-auto px-6 py-6"><div className="card animate-pulse h-96" /></div>;
  if (!member) return <div className="max-w-4xl mx-auto px-4 py-16 text-center"><h2 className="text-xl">{tt('멤버를 찾을 수 없습니다')}</h2><Link href="/" className="text-[var(--accent)] hover:underline mt-4 inline-block">{tt('대시보드로 돌아가기')}</Link></div>;

  const memberRecords = getMemberRecords(records, member.id);
  const activeRecords = memberRecords.filter(r => r.achieved_km > 0);
  const totalDistance = getTotalDistance(records, member.id);
  const totalMonths = activeRecords.length;
  const avgPerMonth = totalMonths > 0 ? totalDistance / totalMonths : 0;
  const bestMonth = activeRecords.length > 0 ? activeRecords.reduce((max, r) => r.achieved_km > max.achieved_km ? r : max, activeRecords[0]) : null;
  const finisherMonths = memberRecords.filter(r => r.goal_km > 0 && r.achieved_km >= r.goal_km).length;
  const totalGoalMonths = memberRecords.filter(r => r.goal_km > 0).length;

  const chartData = memberRecords.map(r => ({ label: r.year === 2025 ? `'25.${r.month}` : `'26.${r.month}`, 목표: r.goal_km, 달성: r.achieved_km }));

  const rank = members.map(m => ({ name: m.name, total: getTotalDistance(records, m.id) })).sort((a, b) => b.total - a.total).findIndex(r => r.name === member.name) + 1;

  return (
    <div className="max-w-5xl mx-auto px-3 md:px-6 py-4 md:py-6 space-y-4 md:space-y-6">
      <Link href="/" className="inline-flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--accent)]"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>{tt('대시보드')}</Link>
      <div className="card bg-gradient-to-r from-blue-500/10 to-purple-500/10 dark:from-blue-500/5 dark:to-purple-500/5 !border-blue-200 dark:!border-blue-500/20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-lg font-bold">{member.name[0]}</div>
            <div>
              <h1 className="text-xl font-bold text-[var(--foreground)]">
                {member.name}
                {member.status === 'dormant' && <span className="ml-2 text-sm font-normal text-[var(--muted)] bg-amber-500/10 px-2 py-0.5 rounded-full">{tt('휴면')}</span>}
              </h1>
              <p className="text-xs text-[var(--muted)]">#{member.member_number} · {member.join_location || '-'}{member.join_date && ` · ${member.join_date}`}</p>
              <div className="mt-1.5"><Badges {...getMemberBadges(members, records, runningLogs, member.id)} /></div>
            </div>
          </div>
          <div className="flex gap-5 sm:gap-8">
            <div className="text-center"><p className="text-xl md:text-2xl font-extrabold text-blue-600 dark:text-blue-400">{totalDistance.toFixed(0)}<span className="text-sm font-medium">km</span></p><p className="text-xs text-[var(--muted)]">{tt('통산')}</p></div>
            <div className="text-center"><p className="text-xl md:text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">#{rank}</p><p className="text-xs text-[var(--muted)]">{tt('순위')}</p></div>
            <div className="text-center"><p className="text-xl md:text-2xl font-extrabold text-amber-600 dark:text-amber-400">{avgPerMonth.toFixed(0)}<span className="text-sm font-medium">km</span></p><p className="text-xs text-[var(--muted)]">{tt('월평균')}</p></div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[{ l: tt('활동 기간'), v: locale === 'en' ? `${totalMonths} mo` : `${totalMonths}개월`, c: '' }, { l: tt('피니셔 달성'), v: `${finisherMonths}/${totalGoalMonths}`, c: 'text-emerald-600 dark:text-emerald-400' },
          { l: tt('월 최고'), v: bestMonth ? `${bestMonth.achieved_km.toFixed(0)}km` : '-', c: 'text-amber-600 dark:text-amber-400' },
          { l: tt('피니셔 확률'), v: totalGoalMonths > 0 ? `${((finisherMonths / totalGoalMonths) * 100).toFixed(0)}%` : '-', c: 'text-purple-600 dark:text-purple-400' }
        ].map(card => <div key={card.l} className="card text-center !p-4"><p className={`text-lg md:text-xl font-extrabold ${card.c || 'text-[var(--foreground)]'}`}>{card.v}</p><p className="text-xs text-[var(--muted)] mt-0.5">{card.l}</p></div>)}
      </div>
      <div className="card">
        <h3 className="text-base font-bold text-[var(--foreground)] mb-4">{tt('월별 목표 vs 달성')}</h3>
        <div className="h-56 md:h-72"><ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 20, right: 5, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={getAxisColor(isDark)} />
            <XAxis dataKey="label" tick={{ fill: getTextColor(isDark), fontSize: 14 }} axisLine={{ stroke: getAxisColor(isDark) }} />
            <YAxis tick={{ fill: getTextColor(isDark), fontSize: 14 }} axisLine={{ stroke: getAxisColor(isDark) }} unit="km" />
            <Tooltip contentStyle={getTooltipStyle(isDark)} formatter={(value, name) => [`${Number(value).toFixed(1)}km`, String(name)]} />
            <Bar dataKey="목표" name={tt('목표')} fill={isDark ? '#334155' : '#cbd5e1'} radius={[6, 6, 0, 0]} barSize={18} />
            <Bar dataKey="달성" name={tt('달성')} radius={[6, 6, 0, 0]} barSize={18}>
              {chartData.map((e, i) => <Cell key={i} fill={e.달성 >= e.목표 && e.목표 > 0 ? '#10b981' : '#3b82f6'} />)}
              <LabelList dataKey="달성" position="top" formatter={(v: unknown) => Number(v) > 0 ? `${Number(v).toFixed(0)}` : ''} style={{ fill: getTextColor(isDark), fontSize: 13, fontWeight: 600 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer></div>
      </div>
      <div className="card">
        <h3 className="text-base font-bold text-[var(--foreground)] mb-4">{tt('거리 성장 추이')}</h3>
        <div className="h-48 md:h-56"><ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 20, right: 5, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={getAxisColor(isDark)} />
            <XAxis dataKey="label" tick={{ fill: getTextColor(isDark), fontSize: 14 }} axisLine={{ stroke: getAxisColor(isDark) }} />
            <YAxis tick={{ fill: getTextColor(isDark), fontSize: 14 }} axisLine={{ stroke: getAxisColor(isDark) }} unit="km" />
            <Tooltip contentStyle={getTooltipStyle(isDark)} formatter={(value) => [`${Number(value).toFixed(1)}km`]} />
            <ReferenceLine y={avgPerMonth} stroke="#d97706" strokeDasharray="5 5" label={{ value: `${tt('평균')} ${avgPerMonth.toFixed(0)}km`, fill: '#d97706', fontSize: 14 }} />
            <Line type="monotone" dataKey="달성" name={tt('달성')} stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 4, fill: '#3b82f6' }} activeDot={{ r: 6 }}>
              <LabelList dataKey="달성" position="top" formatter={(v: unknown) => Number(v) > 0 ? `${Number(v).toFixed(0)}` : ''} style={{ fill: getTextColor(isDark), fontSize: 13, fontWeight: 600 }} />
            </Line>
          </LineChart>
        </ResponsiveContainer></div>
      </div>
      <div className="card overflow-hidden !p-0">
        <h3 className="text-base font-bold text-[var(--foreground)] p-4 pb-0">{tt('월별 기록')}</h3>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-[var(--muted)] text-left border-b border-[var(--card-border)]">
          <th className="py-3 px-4 font-medium">{tt('월')}</th><th className="py-3 px-4 text-right font-medium">{tt('목표')}</th><th className="py-3 px-4 text-right font-medium">{tt('달성')}</th><th className="py-3 px-4 text-right font-medium">{tt('달성률')}</th><th className="py-3 px-4 text-center font-medium">{tt('상태')}</th>
        </tr></thead><tbody>
          {memberRecords.map((r, i) => {
            const rate = r.goal_km > 0 ? (r.achieved_km / r.goal_km) * 100 : 0;
            const isF = r.goal_km > 0 && r.achieved_km >= r.goal_km;
            return <tr key={i} className="border-b border-[var(--card-border)] last:border-0 hover:bg-[var(--card-border)]/50">
              <td className="py-2.5 px-4 font-medium">{locale === 'en' ? `'${r.year % 100}.${r.month}` : (r.year === 2025 ? `'25.${r.month}월` : `'26.${r.month}월`)}</td>
              <td className="py-2.5 px-4 text-right text-[var(--muted)] font-mono text-sm">{r.goal_km > 0 ? `${r.goal_km}km` : '-'}</td>
              <td className="py-2.5 px-4 text-right font-mono text-sm font-semibold">{r.achieved_km > 0 ? `${r.achieved_km.toFixed(1)}km` : '-'}</td>
              <td className={`py-2.5 px-4 text-right font-mono text-sm font-semibold ${isF ? 'text-emerald-600 dark:text-emerald-400' : rate >= 80 ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--muted)]'}`}>{r.goal_km > 0 && r.achieved_km > 0 ? `${rate.toFixed(0)}%` : '-'}</td>
              <td className="py-2.5 px-4 text-center">{isF ? <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">{tt('달성')}</span> : r.achieved_km === 0 ? <span className="text-xs text-[var(--muted)]">-</span> : <span className="text-xs text-[var(--muted)] bg-slate-500/10 px-2 py-0.5 rounded-full">{tt('미달')}</span>}</td>
            </tr>;
          })}
        </tbody></table></div>
      </div>
      <DailyRunSection memberId={member.id} runningLogs={runningLogs} isDark={isDark} />
    </div>
  );
}

export default function MemberPage() {
  return (
    <Suspense fallback={<div className="max-w-5xl mx-auto px-6 py-6"><div className="card animate-pulse h-96" /></div>}>
      <MemberPageContent />
    </Suspense>
  );
}

function DailyRunSection({ memberId, runningLogs, isDark }: { memberId: string; runningLogs: { run_date: string; member_id: string; distance_km: number; duration_minutes: number | null; memo: string | null }[]; isDark: boolean }) {
  const { tt, locale } = useI18n();
  const memberLogs = useMemo(() =>
    runningLogs.filter(l => l.member_id === memberId).sort((a, b) => a.run_date.localeCompare(b.run_date)),
    [runningLogs, memberId]
  );

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    memberLogs.forEach(l => { const [y, m] = l.run_date.split('-'); set.add(`${Number(y)}-${Number(m)}`); });
    return Array.from(set).sort().reverse().map(k => {
      const [y, m] = k.split('-').map(Number);
      return { key: k, label: locale === 'en' ? `'${y % 100}.${m}` : (y === 2025 ? `'25.${m}월` : `'26.${m}월`), year: y, month: m };
    });
  }, [memberLogs, locale]);

  const [filterMonth, setFilterMonth] = useState<string>('all');

  const chartData = useMemo(() => {
    let logs = memberLogs;
    if (filterMonth !== 'all') {
      const [fy, fm] = filterMonth.split('-').map(Number);
      logs = logs.filter(l => l.run_date.startsWith(`${fy}-${String(fm).padStart(2, '0')}`));
    }
    let cumulative = 0;
    return logs.map(l => {
      cumulative += l.distance_km;
      const [, mm, dd] = l.run_date.split('-').map(Number);
      return {
        date: `${mm}/${dd}`,
        fullDate: l.run_date,
        거리: l.distance_km,
        누적: Math.round(cumulative * 10) / 10,
        duration: l.duration_minutes,
        memo: l.memo,
      };
    });
  }, [memberLogs, filterMonth]);

  const avg = chartData.length > 0 ? chartData.reduce((s, d) => s + d.거리, 0) / chartData.length : 0;
  const tableLogs = useMemo(() => [...chartData].reverse(), [chartData]);

  if (memberLogs.length === 0) return null;

  return (
    <>
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-[var(--foreground)]">{tt('일별 러닝 거리')}</h3>
          <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}
            className="bg-[var(--background)] border border-[var(--card-border)] text-[var(--foreground)] text-sm rounded-lg px-2 py-1 focus:outline-none">
            <option value="all">{tt('전체')}</option>
            {monthOptions.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </div>
        <div className="h-56 md:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 20, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={getAxisColor(isDark)} />
              <XAxis dataKey="date" tick={{ fill: getTextColor(isDark), fontSize: 14 }} axisLine={{ stroke: getAxisColor(isDark) }} interval={chartData.length > 30 ? Math.floor(chartData.length / 15) : 0} />
              <YAxis yAxisId="left" tick={{ fill: getTextColor(isDark), fontSize: 14 }} axisLine={{ stroke: getAxisColor(isDark) }} unit="km" />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: '#8b5cf6', fontSize: 14 }} axisLine={{ stroke: '#8b5cf6' }} unit="km" />
              <Tooltip contentStyle={getTooltipStyle(isDark)} formatter={(value, name) => [`${Number(value).toFixed(1)}km`, String(name)]} labelFormatter={(label) => {
                const item = chartData.find(d => d.date === label);
                return item ? item.fullDate : label;
              }} />
              <ReferenceLine yAxisId="left" y={avg} stroke="#d97706" strokeDasharray="5 5" label={{ value: `${tt('평균')} ${avg.toFixed(1)}km`, fill: '#d97706', fontSize: 14 }} />
              <Bar yAxisId="left" dataKey="거리" name={tt('거리')} radius={[4, 4, 0, 0]} barSize={chartData.length > 50 ? 6 : 14}>
                {chartData.map((e, i) => <Cell key={i} fill={e.거리 >= avg ? '#3b82f6' : isDark ? '#334155' : '#93c5fd'} />)}
              </Bar>
              <Line yAxisId="right" type="monotone" dataKey="누적" name={locale === 'en' ? 'Cumulative' : '누적'} stroke="#8b5cf6" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="flex gap-4 mt-3 text-xs text-[var(--muted)] justify-center">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500 inline-block" /> {tt('일별 거리')}</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-purple-500 inline-block" /> {tt('누적 거리')}</span>
          <span className="flex items-center gap-1"><span className="w-5 h-0 border-t-2 border-dashed border-amber-500 inline-block" /> {tt('평균')} {avg.toFixed(1)}km</span>
        </div>
      </div>

      <div className="card overflow-hidden !p-0">
        <h3 className="text-base font-bold text-[var(--foreground)] p-4 pb-0">{tt('일별 러닝 기록')} <span className="font-normal text-[var(--muted)]">({tableLogs.length}{locale === 'en' ? ' runs' : '건'})</span></h3>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-[var(--muted)] text-left border-b border-[var(--card-border)]">
          <th className="py-3 px-4 font-medium text-sm">{tt('날짜')}</th>
          <th className="py-3 px-4 text-right font-medium text-sm">{tt('거리')}</th>
          <th className="py-3 px-4 text-right font-medium text-sm">{locale === 'en' ? 'Cumulative' : '누적'}</th>
          <th className="py-3 px-4 text-right font-medium text-sm">{tt('시간')}</th>
          <th className="py-3 px-4 font-medium text-sm">{tt('메모')}</th>
        </tr></thead><tbody>
          {tableLogs.slice(0, 100).map((l, i) => (
            <tr key={i} className="border-b border-[var(--card-border)] last:border-0 hover:bg-[var(--card-border)]/50">
              <td className="py-2 px-4 font-mono text-xs text-[var(--muted)]">{l.fullDate}</td>
              <td className="py-2 px-4 text-right font-mono text-sm font-semibold text-[var(--accent)]">+{l.거리.toFixed(2)}km</td>
              <td className="py-2 px-4 text-right font-mono text-sm text-purple-600 dark:text-purple-400">{l.누적.toFixed(1)}km</td>
              <td className="py-2 px-4 text-right font-mono text-xs text-[var(--muted)]">{l.duration ? (locale === 'en' ? `${l.duration} min` : `${l.duration}분`) : '-'}</td>
              <td className="py-2 px-4 text-xs text-[var(--muted)] truncate max-w-[200px]">{l.memo || '-'}</td>
            </tr>
          ))}
        </tbody></table></div>
      </div>
    </>
  );
}
