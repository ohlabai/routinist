'use client';

// build 227: 다중 사용자 시계열 비교 라인 차트. /social 친구 비교 + /clubs/detail 멤버 비교에서 재사용.
// 일간 14일 / 주간 8주 토글. 사용자 1~5명 동시 표시 (체크박스 hide).
// 본인은 항상 emerald, 친구는 amber/sky/rose/violet/pink 팔레트 순환.

import { useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { fetchUserTimeSeries, type TimeSeriesPoint } from '@/lib/stats-data';
import { TrendingUp, Eye, EyeOff } from 'lucide-react';

export interface CompareUser {
  id: string;
  name: string;
  isMe?: boolean;
}

interface Props {
  users: CompareUser[];      // 본인 + 친구/멤버 list
  defaultSelectedIds?: string[]; // 초기 선택. 미지정 시 처음 5명.
  title?: string;
}

// build 227: 친구 라인 컬러 — 본인은 emerald 고정, 그 외 순환.
const FRIEND_COLORS = ['#f59e0b', '#0ea5e9', '#f43f5e', '#8b5cf6', '#ec4899', '#14b8a6', '#84cc16', '#f97316'];
const ME_COLOR = '#10b981';

export default function MultiUserTimeSeriesChart({ users, defaultSelectedIds, title }: Props) {
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [data, setData] = useState<TimeSeriesPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    if (defaultSelectedIds && defaultSelectedIds.length > 0) return new Set(defaultSelectedIds);
    return new Set(users.slice(0, 5).map(u => u.id));
  });

  // 본인 포함 5명까지만 선택 가능 — 라인 너무 많으면 가독성 ↓.
  const toggleUser = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= 5) return prev; // 5명 초과 차단
        next.add(id);
      }
      return next;
    });
  };

  // 사용자 → 색 매핑 (본인은 emerald, 그 외는 순서대로 친구 팔레트).
  const colorMap = useMemo(() => {
    const m = new Map<string, string>();
    let friendIdx = 0;
    for (const u of users) {
      if (u.isMe) m.set(u.id, ME_COLOR);
      else {
        m.set(u.id, FRIEND_COLORS[friendIdx % FRIEND_COLORS.length]);
        friendIdx++;
      }
    }
    return m;
  }, [users]);

  // 시계열 fetch — 선택된 user 만 (불필요한 쿼리 줄임)
  useEffect(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) { setData([]); return; }
    let cancelled = false;
    setLoading(true);
    const count = period === 'daily' ? 14 : period === 'weekly' ? 8 : 12;
    fetchUserTimeSeries(ids, period, count)
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => console.warn('[TimeSeriesChart] fetch fail', e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedIds, period]);

  const visibleUsers = users.filter(u => selectedIds.has(u.id));

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <TrendingUp size={16} className="text-emerald-600 flex-shrink-0" />
          <h3 className="text-base font-extrabold text-[var(--foreground)] truncate">
            {title ?? (period === 'daily' ? '최근 2주 추이' : period === 'weekly' ? '최근 2개월 추이' : '최근 12개월 추이')}
          </h3>
        </div>
        <div className="flex gap-1 bg-[var(--card-border)]/30 rounded-full p-1 flex-shrink-0">
          <button
            onClick={() => setPeriod('daily')}
            className={`px-2.5 py-1 rounded-full text-xs font-extrabold transition ${
              period === 'daily' ? 'bg-emerald-500 text-white shadow-sm' : 'text-[var(--muted)]'
            }`}
          >일간</button>
          <button
            onClick={() => setPeriod('weekly')}
            className={`px-2.5 py-1 rounded-full text-xs font-extrabold transition ${
              period === 'weekly' ? 'bg-emerald-500 text-white shadow-sm' : 'text-[var(--muted)]'
            }`}
          >주간</button>
          <button
            onClick={() => setPeriod('monthly')}
            className={`px-2.5 py-1 rounded-full text-xs font-extrabold transition ${
              period === 'monthly' ? 'bg-emerald-500 text-white shadow-sm' : 'text-[var(--muted)]'
            }`}
          >월간</button>
        </div>
      </div>

      {/* 차트 */}
      <div className="h-56 -ml-2">
        {data.length === 0 || visibleUsers.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-[var(--muted)]">
            {loading ? '불러오는 중…' : '비교할 사용자를 선택해 주세요'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} unit="km" width={40} />
              <Tooltip
                contentStyle={{
                  background: 'var(--background)',
                  border: '1px solid var(--card-border)',
                  borderRadius: 12,
                  fontSize: 12,
                }}
                formatter={(value, name) => {
                  const v = typeof value === 'number' ? value : Number(value ?? 0);
                  const userKey = typeof name === 'string' ? name : String(name);
                  const user = users.find(u => u.id === userKey);
                  return [`${v.toFixed(1)} km`, user?.name ?? userKey];
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }}
                formatter={(value: string) => {
                  const user = users.find(u => u.id === value);
                  return user?.name ?? value;
                }}
              />
              {visibleUsers.map(u => (
                <Line
                  key={u.id}
                  type="monotone"
                  dataKey={u.id}
                  stroke={colorMap.get(u.id)}
                  strokeWidth={u.isMe ? 3 : 2}
                  dot={{ r: u.isMe ? 4 : 3 }}
                  activeDot={{ r: 5 }}
                  name={u.id}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 사용자 선택 체크박스 */}
      <div className="mt-3 pt-3 border-t border-[var(--card-border)]/40">
        <p className="text-[12px] font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5">
          비교 (최대 5명)
        </p>
        <div className="flex flex-wrap gap-1.5">
          {users.map(u => {
            const isOn = selectedIds.has(u.id);
            const color = colorMap.get(u.id);
            return (
              <button
                key={u.id}
                onClick={() => toggleUser(u.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 h-8 rounded-full text-xs font-extrabold transition active:scale-95 ${
                  isOn
                    ? 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--foreground)]'
                    : 'bg-transparent border border-[var(--card-border)]/40 text-[var(--muted)] opacity-60'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: isOn ? color : 'transparent', border: `2px solid ${color}` }} />
                <span className="truncate max-w-[80px]">{u.name}{u.isMe ? ' (나)' : ''}</span>
                {isOn ? <Eye size={11} /> : <EyeOff size={11} />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
