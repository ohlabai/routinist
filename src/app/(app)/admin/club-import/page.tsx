'use client';

// 클럽 결산 HTML import (build 100) — admin 1-click import.
// 기존 supabase/scripts/import-club-monthly-html.mjs 의 핵심 로직을 admin UI 로 노출.
// API endpoint /api/admin/club-import (다음 라운드 추가) 호출.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { isAdminEmail } from '@/lib/admin-emails';
import { ArrowLeft, Upload, AlertCircle } from 'lucide-react';

export default function AdminClubImportPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const [html, setHtml] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (authLoading) return null;
  if (!user || !isAdmin) {
    router.replace('/');
    return null;
  }

  const handleImport = async () => {
    if (!html.trim()) {
      setMsg('HTML 내용을 붙여넣어주세요');
      return;
    }
    setBusy(true);
    setMsg('준비 중 — API endpoint 다음 라운드 활성화');
    // TODO: POST /api/admin/club-import { html, year, month }
    // 백엔드는 기존 import-club-monthly-html.mjs 로직 포팅 필요.
    setTimeout(() => setBusy(false), 1500);
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
        <div className="card p-4 bg-amber-50/50 dark:bg-amber-950/20 border-amber-200/60">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-[var(--foreground)] leading-relaxed">
              매월 BIT Runners 매거진 HTML 을 붙여넣고 import 합니다. 자동화 API endpoint 는 다음 라운드에 추가됩니다 — 지금은 placeholder.
              현재는 <code className="text-[10px] bg-[var(--card-border)]/40 px-1 rounded">supabase/scripts/import-club-monthly-html.mjs</code> 수동 실행.
            </p>
          </div>
        </div>

        <div className="card p-4 space-y-3">
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
          </div>

          <button
            onClick={handleImport}
            disabled={busy || !html.trim()}
            className="w-full py-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-sm disabled:opacity-50 active:scale-[0.98] inline-flex items-center justify-center gap-1.5"
          >
            <Upload size={16} />
            {busy ? 'Import 중…' : `${year}년 ${month}월 결산 import`}
          </button>

          {msg && (
            <p className="text-xs text-center text-[var(--muted)]">{msg}</p>
          )}
        </div>
      </div>
    </div>
  );
}
