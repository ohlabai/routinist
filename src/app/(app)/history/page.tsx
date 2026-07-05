'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/components/UserDataProvider';
import { getMonthlyDistance, formatDuration } from '@/lib/routinist-data';
import { useDistanceUnit, toDisplayDistance, unitLabel, paceUnitLabel, formatPaceForUnit } from '@/lib/units';
import { getMyClubs } from '@/lib/social-data';
import {
  fetchClubMemberProgress,
  fetchClubSummary,
  fetchMemberRunCounts,
  fetchCumulativeRanking,
  fetchHallOfFame,
  fetchClubCalendar,
  type MemberProgress,
  type ClubSummary,
  type MemberRunCount,
  type CumulativeRanking,
  type HallOfFameEntry,
} from '@/lib/stats-data';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, TrendingUp, Activity, Zap, Users } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export default function HistoryPage() {
  const { user } = useAuth();
  const { tt, locale } = useI18n();
  const unit = useDistanceUnit(); // build 290: 표시 단위 — 클럽 랭킹/목표 바는 km 유지 (서버 정합)
  const { activities, loading } = useUserData();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  // 클럽 데이터
  const [clubId, setClubId] = useState<string | null>(null);
  const [clubSummary, setClubSummary] = useState<ClubSummary | null>(null);
  const [members, setMembers] = useState<MemberProgress[]>([]);
  const [runCounts, setRunCounts] = useState<MemberRunCount[]>([]);
  const [cumRanking, setCumRanking] = useState<CumulativeRanking[]>([]);
  const [hallOfFame, setHallOfFame] = useState<HallOfFameEntry[]>([]);
  const [calendarData, setCalendarData] = useState<Map<string, number>>(new Map());
  const [clubLoading, setClubLoading] = useState(true);

  // 클럽 초기화
  useEffect(() => {
    if (!user) return;
    getMyClubs().then(clubs => {
      if (clubs.length > 0) setClubId(clubs[0].id);
      else setClubLoading(false); // 클럽 없으면 즉시 로딩 종료
    }).catch(() => setClubLoading(false));
  }, [user]);

  // 월 변경 시 클럽 데이터 로드
  const loadClubData = useCallback(async () => {
    if (!clubId) { setClubLoading(false); return; }
    setClubLoading(true);
    try {
      const results = await Promise.allSettled([
        fetchClubSummary(clubId, year, month),
        fetchClubMemberProgress(clubId, year, month),
        fetchMemberRunCounts(clubId, year, month),
        fetchClubCalendar(clubId, year, month),
        fetchHallOfFame(clubId, year, month),
      ]);
      if (results[0].status === 'fulfilled') setClubSummary(results[0].value);
      if (results[1].status === 'fulfilled') setMembers(results[1].value);
      if (results[2].status === 'fulfilled') setRunCounts(results[2].value);
      if (results[3].status === 'fulfilled') setCalendarData(results[3].value);
      if (results[4].status === 'fulfilled') setHallOfFame(results[4].value);

      // 통산 누적
      try {
        const cumData = await fetchCumulativeRanking(clubId);
        setCumRanking(cumData);
      } catch {}
    } catch {} finally {
      setClubLoading(false);
    }
  }, [clubId, year, month]);

  useEffect(() => { loadClubData(); }, [loadClubData]);

  // 개인 월간 데이터
  const monthlyActivities = useMemo(() =>
    activities.filter(a => {
      const d = new Date(a.activity_date);
      return d.getFullYear() === year && d.getMonth() + 1 === month;
    }),
    [activities, year, month]
  );

  const monthlyDistance = getMonthlyDistance(activities, year, month);
  const totalDuration = monthlyActivities.reduce((s, a) => s + (a.duration_seconds || 0), 0);

  // 실제 클럽 데이터가 있는 경우만 클럽 뷰 사용 (멤버 2명 이상)
  const effectiveSummary = clubSummary && clubSummary.totalMembers >= 2 ? clubSummary : null;

  // 캘린더
  const runDates = new Set(monthlyActivities.map(a => a.activity_date));
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const totalMembers = effectiveSummary?.totalMembers || 1;

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  };

  // 거리 순위 정렬
  const sortedByDistance = [...members].sort((a, b) => b.distance_km - a.distance_km);
  const maxDistance = sortedByDistance[0]?.distance_km || 1;
  const maxRunCount = runCounts[0]?.run_count || 1;
  const maxCumDistance = cumRanking[0]?.total_distance_km || 1;

  // 목표 달성률 (목표가 있는 멤버만, 달성률 높은 순)
  const membersWithGoal = members.filter(m => m.goal_km > 0).sort((a, b) => b.progress - a.progress);
  const finishRate = membersWithGoal.length > 0
    ? Math.round((membersWithGoal.filter(m => m.progress >= 100).length / membersWithGoal.length) * 100)
    : 0;

  // en 모드 월 이름 (e.g. "Jul") — "N월" 조합 문자열의 locale 분기용.
  const monthName = new Date(year, month - 1).toLocaleDateString('en-US', { month: 'short' });

  return (
    <div className="p-4 max-w-lg mx-auto space-y-4 pb-8">
      {/* 대시보드 링크 */}
      <div className="flex items-center gap-2">
        <Link href="/dashboard" className="text-xs text-[var(--muted)]">← {tt('대시보드')}</Link>
      </div>

      {/* 월 선택 */}
      <div className="flex items-center justify-between">
        <button onClick={prevMonth} className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-[var(--card-border)] transition-colors">
          <ChevronLeft size={20} />
        </button>
        <span className="text-2xl font-bold text-[var(--foreground)]">
          {locale === 'en' ? `${new Date(year, month - 1).toLocaleDateString('en-US', { month: 'long' })} ${year}` : `${year}년 ${month}월`}
        </span>
        <button onClick={nextMonth} className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-[var(--card-border)] transition-colors">
          <ChevronRight size={20} />
        </button>
      </div>

      {/* ========== 4 요약 카드 ========== */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4 relative overflow-hidden">
          <div className="absolute top-2 right-3 text-[var(--accent)] opacity-30"><TrendingUp size={24} /></div>
          <p className="text-xs text-[var(--muted)] mb-1">{effectiveSummary ? tt('클럽 총 거리') : tt('이달 거리')}</p>
          <p className="text-3xl font-extrabold text-[var(--accent)] italic">
            {effectiveSummary ? toDisplayDistance(effectiveSummary.totalDistance, unit).toFixed(0) : toDisplayDistance(monthlyDistance, unit).toFixed(1)}<span className="text-base font-bold not-italic ml-1">{unitLabel(unit)}</span>
          </p>
          <p className="text-xs text-[var(--muted)] mt-1">
            {effectiveSummary
              ? (locale === 'en' ? `${effectiveSummary.activeMembers} members active` : `${effectiveSummary.activeMembers}명 활동`)
              : (locale === 'en' ? `${monthName} total` : `${month}월 누적`)}
          </p>
        </div>
        <div className="card p-4 relative overflow-hidden">
          <div className="absolute top-2 right-3 text-green-500 opacity-30"><Activity size={24} /></div>
          <p className="text-xs text-[var(--muted)] mb-1">{effectiveSummary ? tt('인당 평균') : tt('이달 러닝')}</p>
          <p className="text-3xl font-extrabold text-green-600 italic">
            {effectiveSummary ? toDisplayDistance(effectiveSummary.avgDistance, unit).toFixed(1) : monthlyActivities.length}<span className="text-base font-bold not-italic ml-1">{effectiveSummary ? unitLabel(unit) : tt('회')}</span>
          </p>
          <p className="text-xs text-[var(--muted)] mt-1">
            {effectiveSummary ? tt('활동 멤버 기준') : (locale === 'en' ? `${monthName} activity` : `${month}월 활동`)}
          </p>
        </div>
        <div className="card p-4 relative overflow-hidden">
          <div className="absolute top-2 right-3 text-purple-500 opacity-30"><Zap size={24} /></div>
          <p className="text-xs text-[var(--muted)] mb-1">{effectiveSummary ? tt('클럽 총 러닝') : tt('이달 시간')}</p>
          <p className="text-3xl font-extrabold text-purple-600 italic">
            {effectiveSummary ? effectiveSummary.totalRuns : (totalDuration > 0 ? formatDuration(totalDuration) : '0')}<span className="text-base font-bold not-italic ml-1">{effectiveSummary ? tt('회') : ''}</span>
          </p>
          <p className="text-xs text-[var(--muted)] mt-1">{effectiveSummary ? `D-${effectiveSummary.daysRemaining}` : tt('운동 시간')}</p>
        </div>
        <div className="card p-4 relative overflow-hidden">
          <div className="absolute top-2 right-3 text-orange-500 opacity-30"><Users size={24} /></div>
          <p className="text-xs text-[var(--muted)] mb-1">{effectiveSummary ? tt('활동 멤버') : tt('러닝 일수')}</p>
          <p className="text-3xl font-extrabold text-orange-600 italic">
            {effectiveSummary ? effectiveSummary.activeMembers : new Set(monthlyActivities.map(a => a.activity_date)).size}<span className="text-base font-bold not-italic ml-1">{effectiveSummary ? tt('명') : tt('일')}</span>
          </p>
          <p className="text-xs text-[var(--muted)] mt-1">
            {effectiveSummary
              ? (locale === 'en' ? `of ${effectiveSummary.totalMembers} total` : `전체 ${effectiveSummary.totalMembers}명`)
              : (locale === 'en' ? `in ${monthName}` : `${month}월 중`)}
          </p>
        </div>
      </div>

      {/* ========== 거리 순위 ========== */}
      <div className="card p-5">
        <h3 className="text-base font-bold text-[var(--foreground)] mb-4">
          {locale === 'en' ? `${monthName} Distance Ranking` : `${month}월 거리 순위`}
        </h3>
        {clubLoading ? (
          <div className="flex justify-center py-6">
            <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
          </div>
        ) : sortedByDistance.length === 0 ? (
          <p className="text-xs text-[var(--muted)] text-center py-4">{tt('데이터 없음')}</p>
        ) : (
          <div className="space-y-2">
            {sortedByDistance.map((m, i) => {
              const barWidth = (m.distance_km / maxDistance) * 100;
              return (
                <div key={m.user_id} className="flex items-center gap-2">
                  <span className={`w-5 text-base font-bold text-center flex-shrink-0 ${
                    i === 0 ? 'text-yellow-500' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-amber-600' : 'text-[var(--muted)]'
                  }`}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                  </span>
                  <span className="w-14 text-sm font-medium text-[var(--foreground)] truncate flex-shrink-0">{m.display_name}</span>
                  <div className="flex-1 h-5 bg-[var(--card-border)] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        m.progress >= 100 ? 'bg-gradient-to-r from-green-400 to-green-500'
                          : i < 3 ? 'bg-gradient-to-r from-blue-400 to-blue-500'
                          : 'bg-gradient-to-r from-gray-300 to-gray-400'
                      }`}
                      style={{ width: `${Math.max(barWidth, 2)}%` }}
                    />
                  </div>
                  <span className="text-xs text-[var(--muted)] w-16 text-right flex-shrink-0">{m.distance_km.toFixed(1)}km</span>
                  {m.progress >= 100 && <span className="text-sm">✅</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ========== 목표 달성률 ========== */}
      {membersWithGoal.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-[var(--foreground)]">
              {locale === 'en' ? `${monthName} Goal Progress` : `${month}월 목표 달성률`}
            </h3>
            <span className="text-xs text-[var(--muted)]">{tt('피니셔율')} {finishRate}%</span>
          </div>
          <div className="space-y-3">
            {membersWithGoal.map(m => (
              <div key={m.user_id}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-[var(--foreground)]">{m.display_name}</span>
                  <span className="text-xs text-[var(--muted)]">
                    {m.distance_km.toFixed(1)} / {m.goal_km}km
                    <span className={`ml-2 font-semibold ${m.progress >= 100 ? 'text-green-500' : 'text-[var(--accent)]'}`}>
                      {m.progress.toFixed(0)}%
                    </span>
                  </span>
                </div>
                <div className="h-3 bg-[var(--card-border)] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      m.progress >= 100 ? 'bg-gradient-to-r from-green-400 to-green-500'
                        : m.progress >= 50 ? 'bg-gradient-to-r from-blue-400 to-blue-500'
                        : 'bg-gradient-to-r from-blue-300 to-blue-400'
                    }`}
                    style={{ width: `${Math.min(m.progress, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========== 러닝 캘린더 (히트맵) ========== */}
      <div className="card p-4">
        <h3 className="text-base font-bold text-[var(--foreground)] mb-3">{tt('러닝 캘린더')}</h3>
        <div className="grid grid-cols-7 gap-1 text-center text-sm mb-2">
          {(locale === 'en' ? ['Su','Mo','Tu','We','Th','Fr','Sa'] : ['일','월','화','수','목','금','토']).map(d => (
            <span key={d} className="text-[var(--muted)] py-1 text-sm">{d}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: firstDay }).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const clubCount = calendarData.get(dateStr) || 0;
            const personalRun = runDates.has(dateStr);
            // 참여율에 따른 색상 (전체 멤버 대비)
            const ratio = totalMembers > 0 ? clubCount / totalMembers : 0;
            let bgClass = 'bg-[var(--card-border)]';
            if (ratio >= 0.5) bgClass = 'bg-green-500 text-white';
            else if (ratio >= 0.15) bgClass = 'bg-green-400 text-white';
            else if (clubCount >= 1) bgClass = 'bg-orange-400 text-white';

            return (
              <div
                key={day}
                className={`aspect-square flex flex-col items-center justify-center rounded-lg text-sm font-medium relative ${bgClass}`}
              >
                <span>{day}</span>
                {clubCount > 0 && (
                  <span className="text-sm opacity-80">{locale === 'en' ? clubCount : `${clubCount}명`}</span>
                )}
              </div>
            );
          })}
        </div>
        {/* 범례 */}
        <div className="flex items-center gap-3 mt-3 text-xs text-[var(--muted)] justify-center">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500 inline-block" /> 50%+</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-400 inline-block" /> 15%+</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-400 inline-block" /> {locale === 'en' ? '1+' : '1명+'}</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[var(--card-border)] inline-block" /> {locale === 'en' ? '0' : '0명'}</span>
        </div>
      </div>

      {/* ========== 러닝 횟수 ========== */}
      {runCounts.length > 0 && (
        <div className="card p-5">
          <h3 className="text-base font-bold text-[var(--foreground)] mb-4">
            {locale === 'en' ? `${monthName} Run Count` : `${month}월 러닝 횟수`}
          </h3>
          <div className="space-y-2">
            {runCounts.map((r, i) => {
              const barWidth = (r.run_count / maxRunCount) * 100;
              return (
                <div key={r.user_id} className="flex items-center gap-2">
                  <span className="w-14 text-sm font-medium text-[var(--foreground)] truncate flex-shrink-0">{r.display_name}</span>
                  <div className="flex-1 h-5 bg-[var(--card-border)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-400 to-blue-500"
                      style={{ width: `${Math.max(barWidth, 4)}%` }}
                    />
                  </div>
                  <span className="text-sm font-semibold text-[var(--foreground)] w-8 text-right flex-shrink-0">{locale === 'en' ? `${r.run_count}x` : `${r.run_count}회`}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ========== 통산 누적 랭킹 ========== */}
      {cumRanking.length > 0 && (
        <div className="card p-5">
          <h3 className="text-base font-bold text-[var(--foreground)] mb-4">{tt('통산 누적 랭킹')}</h3>
          <div className="space-y-2.5">
            {cumRanking.map((r, i) => (
              <div key={r.user_id} className="flex items-center gap-2">
                <span className={`w-5 text-base font-bold text-center flex-shrink-0 ${
                  i === 0 ? 'text-yellow-500' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-amber-600' : 'text-[var(--muted)]'
                }`}>
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                </span>
                <span className="text-sm font-medium text-[var(--foreground)] truncate flex-shrink-0 w-14">{r.display_name}</span>
                <div className="flex-1 h-5 bg-[var(--card-border)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-indigo-600"
                    style={{ width: `${Math.max((r.total_distance_km / maxCumDistance) * 100, 2)}%` }}
                  />
                </div>
                <span className="text-xs text-[var(--muted)] w-16 text-right flex-shrink-0">{r.total_distance_km.toFixed(0)}km</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========== 명예의 전당 ========== */}
      {hallOfFame.length > 0 && (
        <div className="card p-5">
          <h3 className="text-base font-bold text-[var(--foreground)] mb-4">{tt('명예의 전당')}</h3>
          <div className="space-y-5">
            {hallOfFame.map(entry => (
              <div key={entry.category}>
                <div className="flex items-center gap-2 mb-2">
                  <span>{entry.emoji}</span>
                  <span className="text-sm font-semibold text-green-600">{tt(entry.label)}</span>
                </div>
                <p className="text-xs text-[var(--muted)] mb-2">{tt(entry.description)}</p>
                <div className="space-y-1.5">
                  {entry.winners.map((w, i) => (
                    <div key={w.user_id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`text-base font-bold ${
                          i === 0 ? 'text-yellow-500' : i === 1 ? 'text-gray-400' : 'text-amber-600'
                        }`}>
                          {i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}
                        </span>
                        <span className="text-sm font-medium text-[var(--foreground)]">{w.display_name}</span>
                      </div>
                      <span className="text-sm font-semibold text-[var(--accent)]">
                        {entry.category === 'consistent' ? (locale === 'en' ? `${w.count}x` : `${w.count}회`) : `${w.value.toFixed(1)}km`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========== 내 활동 리스트 ========== */}
      <div className="card p-5">
        <h3 className="text-base font-bold text-[var(--foreground)] mb-3">
          {locale === 'en' ? `My ${monthName} Activity` : `내 ${month}월 활동`}
        </h3>
        <div className="grid grid-cols-3 gap-4 text-center mb-4">
          <div>
            <p className="text-2xl font-bold text-[var(--accent)]">{toDisplayDistance(monthlyDistance, unit).toFixed(1)}</p>
            <p className="text-xs text-[var(--muted)]">{unitLabel(unit)}</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-[var(--foreground)]">{monthlyActivities.length}</p>
            <p className="text-xs text-[var(--muted)]">{tt('러닝')}</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-[var(--foreground)]">{totalDuration > 0 ? formatDuration(totalDuration) : '-'}</p>
            <p className="text-xs text-[var(--muted)]">{tt('시간')}</p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-6">
            <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
          </div>
        ) : monthlyActivities.length === 0 ? (
          <p className="text-xs text-[var(--muted)] text-center py-4">{tt('이 달의 기록이 없습니다.')}</p>
        ) : (
          <div className="space-y-2">
            {monthlyActivities.map(a => (
              <Link
                key={a.id}
                href={`/activity?id=${a.id}`}
                className="flex items-center gap-3 p-3 rounded-xl hover:bg-[var(--card-border)]/50 transition-colors"
              >
                <div className="w-9 h-9 rounded-lg bg-[var(--accent)]/10 flex items-center justify-center text-[var(--accent)] flex-shrink-0">
                  <Zap size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--foreground)]">{toDisplayDistance(a.distance_km, unit).toFixed(2)} {unitLabel(unit)}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {new Date(a.activity_date).toLocaleDateString(locale === 'en' ? 'en-US' : 'ko-KR', { month: 'short', day: 'numeric', weekday: 'short' })}
                    {a.duration_seconds && ` · ${formatDuration(a.duration_seconds)}`}
                    {a.pace_avg_sec_per_km && ` · ${formatPaceForUnit(a.pace_avg_sec_per_km, unit)}${paceUnitLabel(unit)}`}
                  </p>
                </div>
                <ChevronRight size={14} className="text-[var(--muted)]" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
