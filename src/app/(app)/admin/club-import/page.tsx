'use client';

// 클럽 결산 HTML import (build 100) — admin 1-click import.
// 기존 supabase/scripts/import-club-monthly-html.mjs 의 핵심 로직을 admin UI 로 노출.
// API endpoint /api/admin/club-import (다음 라운드 추가) 호출.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { isAdminEmail } from '@/lib/admin-emails';
import { getSupabase } from '@/lib/supabase';
import { ArrowLeft, Upload, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function AdminClubImportPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const [html, setHtml] = useState('');
  const [clubName, setClubName] = useState('BIT RUNNERS');
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    text: string;
    summary?: { members: number; new_members: number; goals: number; activities: number };
  } | null>(null);

  if (authLoading) return null;
  if (!user || !isAdmin) {
    router.replace('/');
    return null;
  }

  const handleImport = async () => {
    if (!html.trim()) {
      setResult({ ok: false, text: 'HTML 내용을 붙여넣어주세요' });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setResult({ ok: false, text: '인증 정보 없음 — 다시 로그인하세요' });
        return;
      }
      const res = await fetch('/api/admin/club-import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ html, clubName, year, month }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ ok: false, text: data?.error ?? `HTTP ${res.status}` });
        return;
      }
      setResult({
        ok: !!data.success,
        text: data.success ? '✅ Import 완료' : (data.errors ?? []).join('\n'),
        summary: data.summary,
      });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : '실패' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/85 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="px-3 py-3 flex items-center gap-2">
          <Link href="/admin" className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--card-border)]/30 active:scale-90 transition">
            <ArrowLeft size={18} />
          </Link>
          <h1 className="text-base font-extrabold tracking-tight">클럽 결산 import</h1>
        </div>
      </header>

      <div className="px-4 pt-4 space-y-4">
        <div className="card p-4 bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/60">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="text-emerald-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-[var(--foreground)] leading-relaxed">
              매월 BIT RUNNERS 매거진 HTML 을 붙여넣고 import 합니다. HTML 안 <code className="text-[10px] bg-[var(--card-border)]/40 px-1 rounded">const MEMBERS_DATA = [...]</code> JSON 자동 추출.
              같은 월 재실행 시 멱등 (이전 활동 자동 삭제 후 재insert).
            </p>
          </div>
        </div>

        <div className="card p-4 space-y-3">
          <div>
            <label className="block text-xs font-bold text-[var(--muted)] mb-1">클럽 이름</label>
            <input
              type="text"
              value={clubName}
              onChange={(e) => setClubName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-[var(--card-border)] bg-[var(--background)] text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-[var(--muted)] mb-1">연도</label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl border border-[var(--card-border)] bg-[var(--background)] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[var(--muted)] mb-1">월</label>
              <input
                type="number"
                value={month}
                min={1} max={12}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl border border-[var(--card-border)] bg-[var(--background)] text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[var(--muted)] mb-1">HTML 내용</label>
            <textarea
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              placeholder="<html>...</html> 전체 붙여넣기"
              rows={10}
              className="w-full px-3 py-2 rounded-xl border border-[var(--card-border)] bg-[var(--background)] text-xs font-mono resize-none"
            />
            <p className="text-[10px] text-[var(--muted)] mt-1">{html.length.toLocaleString()} 문자</p>
          </div>

          <button
            onClick={handleImport}
            disabled={busy || !html.trim() || !clubName.trim()}
            className="w-full py-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-sm disabled:opacity-50 active:scale-[0.98] inline-flex items-center justify-center gap-1.5"
          >
            <Upload size={16} />
            {busy ? 'Import 중…' : `${year}년 ${month}월 결산 import`}
          </button>

          {result && (
            <div className={`mt-2 p-3 rounded-xl text-xs ${
              result.ok
                ? 'bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/60 text-emerald-700 dark:text-emerald-400'
                : 'bg-rose-50 dark:bg-rose-950/30 border border-rose-200/60 text-rose-700 dark:text-rose-400'
            }`}>
              <div className="flex items-start gap-1.5">
                {result.ok && <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />}
                <div className="flex-1">
                  <p className="font-bold whitespace-pre-wrap break-all">{result.text}</p>
                  {result.summary && (
                    <p className="mt-1 text-[10px] opacity-80">
                      멤버 {result.summary.members}명 (신규 {result.summary.new_members}) · 목표 {result.summary.goals} · 활동 {result.summary.activities}건
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
