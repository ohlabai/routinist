'use client';

// build 297: 진행 중 러닝 전역 배너 (hans 실주행 신고 — 1시간 달리고 앱 열었더니
// 홈이 세션 존재를 전혀 안 보여줌. /track 재부착은 되지만 진입 경로가 "달리기 시작"
// 버튼뿐이라 기록이 사라진 것처럼 보임).
// native RunSession 스냅샷을 mount + 포그라운드 복귀 시 조회 → active 면 하단 탭바 위에
// 떠 있는 pill. 탭하면 /track (재부착은 track 페이지가 함). /track 에서는 숨김.

import { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { isRunSessionAvailable, getRunSnapshot } from '@/lib/run-session';
import { useI18n } from '@/lib/i18n';
import { useDistanceUnit, toDisplayDistance, unitLabel } from '@/lib/units';

function formatMin(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function ActiveRunBanner() {
  const router = useRouter();
  const pathname = usePathname();
  const { tt } = useI18n();
  const unit = useDistanceUnit();
  const [run, setRun] = useState<{ distanceM: number; activeSec: number; state: string } | null>(null);

  const check = useCallback(async () => {
    if (!isRunSessionAvailable()) return;
    try {
      const snap = await getRunSnapshot();
      setRun(snap.active ? { distanceM: snap.distanceM, activeSec: snap.activeSec, state: snap.state } : null);
    } catch {
      setRun(null);
    }
  }, []);

  useEffect(() => {
    void check();
    // 포그라운드 복귀마다 재확인 — 러닝 중 앱 재진입이 정확히 이 배너의 존재 이유.
    const onVis = () => { if (!document.hidden) void check(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', check);
    // 배너가 떠 있는 동안 20s 마다 거리 갱신 (가벼운 폴링 — active 아닐 땐 아래에서 정리됨)
    const interval = window.setInterval(() => { void check(); }, 20000);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', check);
      window.clearInterval(interval);
    };
  }, [check]);

  const onTrack = pathname === '/track' || pathname.startsWith('/track/') || pathname.startsWith('/track?');
  if (!run || onTrack) return null;

  return (
    <button
      onClick={() => router.push('/track')}
      className="fixed left-1/2 -translate-x-1/2 z-40 flex items-center gap-2.5 pl-3 pr-4 py-2.5 rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-600/40 active:scale-95 transition"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 76px)' }}
      aria-label={tt('진행 중인 러닝으로 돌아가기')}
    >
      <span className="relative flex h-2.5 w-2.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white/70" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
      </span>
      <span className="text-sm font-extrabold">
        {run.state === 'running' ? tt('달리는 중') : tt('일시정지 중')}
        {' · '}{toDisplayDistance(run.distanceM / 1000, unit).toFixed(2)} {unitLabel(unit)}
        {' · '}{formatMin(run.activeSec)}
      </span>
    </button>
  );
}
