'use client';

// "마지막 동기화" 시간 기반 stale 표시.
// localStorage 의 last_health_sync 를 현재 시각과 비교해 24시간 + 면 주황 뱃지.
// 사용자가 보고 있는 데이터가 stale 한지 즉시 인지 가능하도록.

import { useEffect, useState } from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { isNativeApp, getPlatform } from '@/lib/health-sync';

export default function SyncStaleBadge() {
  const [lastSyncMs, setLastSyncMs] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(isNativeApp() && getPlatform() === 'ios');
    const read = () => {
      try {
        const saved = localStorage.getItem('last_health_sync');
        if (saved) setLastSyncMs(new Date(saved).getTime());
      } catch {}
    };
    read();
    // 1분마다 갱신 + storage 이벤트 (다른 페이지에서 sync 일어나면 즉시 반영)
    const interval = setInterval(() => { read(); setNow(Date.now()); }, 60_000);
    const onStorage = (e: StorageEvent) => { if (e.key === 'last_health_sync') read(); };
    window.addEventListener('storage', onStorage);
    return () => { clearInterval(interval); window.removeEventListener('storage', onStorage); };
  }, []);

  if (!show || !lastSyncMs) return null;

  const ageMs = now - lastSyncMs;
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  // 1시간 미만 = 표시 안 함 (충분히 신선)
  if (ageMs < HOUR) return null;

  let label: string;
  let tone: 'fresh' | 'stale' | 'very_stale';
  if (ageMs < DAY) {
    const hours = Math.floor(ageMs / HOUR);
    label = `${hours}시간 전 동기화`;
    tone = 'fresh';
  } else if (ageMs < 3 * DAY) {
    const days = Math.floor(ageMs / DAY);
    label = `${days}일 전 동기화 — 새로고침 필요`;
    tone = 'stale';
  } else {
    const days = Math.floor(ageMs / DAY);
    label = `${days}일째 동기화 안 됨 — 권한 확인 필요`;
    tone = 'very_stale';
  }

  const cls =
    tone === 'fresh'
      ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
      : tone === 'stale'
      ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700/50'
      : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-700/50';

  const Icon = tone === 'fresh' ? RefreshCw : AlertCircle;

  return (
    <div className={`mx-4 mt-2 px-3 py-1.5 rounded-full border text-xs font-semibold flex items-center justify-center gap-1.5 ${cls}`}>
      <Icon size={12} />
      <span>{label}</span>
    </div>
  );
}
