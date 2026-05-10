'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useData, getTotalDistance } from '@/components/DataProvider';
import { updateMemberStatus, addMember } from '@/lib/supabase-data';
import type { MemberStatus } from '@/types';

export default function AdminPage() {
  const { members, records, refresh } = useData();
  const [filter, setFilter] = useState<'all' | 'active' | 'dormant'>('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const allMembers = members.map(m => {
    const memberRecords = records.filter(r => r.member_id === m.id && r.achieved_km > 0);
    const lastActive = memberRecords.length > 0
      ? memberRecords.sort((a, b) => (b.year * 100 + b.month) - (a.year * 100 + a.month))[0]
      : null;
    return { ...m, totalDistance: getTotalDistance(records, m.id), activeMonths: memberRecords.length, lastActive: lastActive ? `${lastActive.year}.${lastActive.month}월` : '-' };
  });

  const filtered = allMembers.filter(m => filter === 'all' || m.status === filter);
  const activeCount = allMembers.filter(m => m.status === 'active').length;
  const dormantCount = allMembers.filter(m => m.status === 'dormant').length;

  const handleStatusToggle = async (id: string, current: MemberStatus) => {
    const pw = prompt('관리자 비밀번호를 입력하세요');
    if (pw !== 'bit1004') { if (pw !== null) setSuccessMsg('비밀번호가 틀립니다'); return; }
    setLoading(true);
    try {
      await updateMemberStatus(id, current === 'active' ? 'dormant' : 'active');
      await refresh();
      setSuccessMsg('상태가 변경되었습니다');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch { setSuccessMsg('오류 발생'); }
    setLoading(false);
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const pw = prompt('관리자 비밀번호를 입력하세요');
    if (pw !== 'bit1004') { if (pw !== null) setSuccessMsg('비밀번호가 틀립니다'); return; }
    setLoading(true);
    try {
      await addMember(newName, newLocation || null, newDate || null);
      await refresh();
      setShowAddForm(false);
      setNewName(''); setNewLocation('');
      setSuccessMsg(`${newName} 회원이 등록되었습니다`);
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch { setSuccessMsg('등록 실패'); }
    setLoading(false);
  };

  return (
    <div className="max-w-5xl mx-auto px-3 md:px-6 py-4 md:py-6 space-y-5">
      <Link href="/" className="inline-flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--accent)] transition-colors">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>대시보드
      </Link>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-[var(--foreground)]">회원 관리</h1>
        <button onClick={() => setShowAddForm(!showAddForm)} className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-[var(--accent)] hover:opacity-90 rounded-xl transition-all shadow-sm">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>신규 등록
        </button>
      </div>
      {successMsg && <div className="bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-2xl p-3 text-center"><p className="text-emerald-600 dark:text-emerald-400 font-medium text-sm">{successMsg}</p></div>}
      <div className="grid grid-cols-3 gap-3">
        {[{ f: 'all' as const, label: '전체', count: allMembers.length, color: 'text-[var(--foreground)]' },
          { f: 'active' as const, label: '활동', count: activeCount, color: 'text-emerald-600 dark:text-emerald-400' },
          { f: 'dormant' as const, label: '휴면', count: dormantCount, color: 'text-amber-600 dark:text-amber-400' }
        ].map(item => (
          <button key={item.f} onClick={() => setFilter(item.f)}
            className={`card text-center !p-4 transition-all ${filter === item.f ? '!border-[var(--accent)] ring-1 ring-[var(--accent)]' : ''}`}>
            <p className={`text-2xl font-extrabold ${item.color}`}>{item.count}</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">{item.label}</p>
          </button>
        ))}
      </div>
      {showAddForm && (
        <form onSubmit={handleAddMember} className="card space-y-3">
          <h3 className="text-base font-bold text-[var(--foreground)]">신규 회원 등록</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label className="block text-sm font-medium text-[var(--foreground)] mb-1">이름 *</label>
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} required placeholder="홍길동" className="w-full bg-[var(--background)] border border-[var(--card-border)] text-[var(--foreground)] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" /></div>
            <div><label className="block text-sm font-medium text-[var(--foreground)] mb-1">합류 장소</label>
              <input type="text" value={newLocation} onChange={(e) => setNewLocation(e.target.value)} placeholder="서울" className="w-full bg-[var(--background)] border border-[var(--card-border)] text-[var(--foreground)] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" /></div>
            <div><label className="block text-sm font-medium text-[var(--foreground)] mb-1">합류일</label>
              <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="w-full bg-[var(--background)] border border-[var(--card-border)] text-[var(--foreground)] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" /></div>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowAddForm(false)} className="px-4 py-2 text-xs text-[var(--muted)]">취소</button>
            <button type="submit" disabled={loading} className="px-4 py-2 text-sm font-medium text-white bg-[var(--accent)] hover:opacity-90 rounded-xl disabled:opacity-50">{loading ? '등록 중...' : '등록'}</button>
          </div>
        </form>
      )}
      <div className="card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-[var(--muted)] text-left border-b border-[var(--card-border)] bg-[var(--sidebar-bg)]">
              <th className="py-3 px-4 font-medium text-sm">번호</th><th className="py-3 px-4 font-medium text-sm">이름</th>
              <th className="py-3 px-4 font-medium text-sm hidden sm:table-cell">합류</th><th className="py-3 px-4 font-medium text-sm text-right">통산</th>
              <th className="py-3 px-4 font-medium text-sm text-center hidden sm:table-cell">활동</th><th className="py-3 px-4 font-medium text-sm text-center hidden md:table-cell">최근</th>
              <th className="py-3 px-4 font-medium text-sm text-center">상태</th><th className="py-3 px-4 font-medium text-sm text-center">관리</th>
            </tr></thead>
            <tbody>
              {filtered.map(m => (
                <tr key={m.id} className={`border-b border-[var(--card-border)] last:border-0 transition-colors ${m.status === 'dormant' ? 'opacity-60' : 'hover:bg-[var(--card-border)]/50'}`}>
                  <td className="py-3 px-4 text-[var(--muted)] font-mono text-sm">#{m.member_number}</td>
                  <td className="py-3 px-4"><Link href={`/member/${encodeURIComponent(m.name)}`} className="text-sm font-medium text-[var(--foreground)] hover:text-[var(--accent)]">{m.name}</Link></td>
                  <td className="py-3 px-4 text-xs text-[var(--muted)] hidden sm:table-cell">{m.join_location || '-'}{m.join_date && <span className="block text-sm">{m.join_date}</span>}</td>
                  <td className="py-3 px-4 text-right font-mono text-sm font-semibold">{m.totalDistance.toFixed(0)}km</td>
                  <td className="py-3 px-4 text-center text-xs text-[var(--muted)] hidden sm:table-cell">{m.activeMonths}개월</td>
                  <td className="py-3 px-4 text-center text-xs text-[var(--muted)] hidden md:table-cell">{m.lastActive}</td>
                  <td className="py-3 px-4 text-center">
                    <span className={`inline-flex text-sm font-semibold px-2 py-0.5 rounded-full ${m.status === 'active' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}>{m.status === 'active' ? '활동' : '휴면'}</span>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <button onClick={() => handleStatusToggle(m.id, m.status)} disabled={loading}
                      className={`text-sm font-medium px-2.5 py-1 rounded-lg transition-colors ${m.status === 'active' ? 'text-amber-600 dark:text-amber-400 hover:bg-amber-500/10' : 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10'}`}>
                      {m.status === 'active' ? '휴면 처리' : '복귀'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
