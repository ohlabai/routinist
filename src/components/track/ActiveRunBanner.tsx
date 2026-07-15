'use client';

// build 297: 진행 중 러닝 전역 배너 (hans 실주행 신고 — 1시간 달리고 앱 열었더니
// 홈이 세션 존재를 전혀 안 보여줌. /track 재부착은 되지만 진입 경로가 "달리기 시작"
// 버튼뿐이라 기록이 사라진 것처럼 보임).
// native RunSession 스냅샷을 mount + 포그라운드 복귀 시 조회 → active 면 하단 탭바 위에
// 떠 있는 pill. 탭하면 /track (재부착은 track 페이지가 함). /track 에서는 숨김.

import { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { isRunSessionAvailable, getRunSnapshot } from '@/lib/run-session';
import { loadState as loadLegacyTrackState } from '@/lib/gps-tracking';
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
  const [run, setRun] = useState<{ distanceM: number; activeSec: number; state: string; isStale: boolean } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const check = useCallback(async () => {
    await Promise.resolve(); // effect 동기 구간에서 setState 하지 않기 위한 microtask 양보
    // 2026-07-15 리뷰 fix: native start 실패 → 레거시 JS 엔진 폴백 중인 세션은 배너가
    // 아예 안 떴음 — localStorage 상태도 병행 확인.
    if (!isRunSessionAvailable()) {
      try {
        const legacy = loadLegacyTrackState();
        const staleLegacy = !!legacy?.startedAt && Date.now() - legacy.startedAt > 24 * 60 * 60 * 1000;
        setRun(legacy && legacy.status !== 'idle'
          ? { distanceM: legacy.distanceMeters, activeSec: legacy.elapsedSeconds, state: legacy.status, isStale: staleLegacy }
          : null);
      } catch { setRun(null); }
      return;
    }
    try {
      const snap = await getRunSnapshot();
      const startedAtMs = (snap as { startedAtMs?: number }).startedAtMs ?? null;
      setRun(snap.active
        ? { distanceM: snap.distanceM, activeSec: snap.activeSec, state: snap.state, isStale: startedAtMs !== null && Date.now() - startedAtMs > 24 * 60 * 60 * 1000 }
        : null);
    } catch {
      setRun(null);
    }
  }, []);

  useEffect(() => {
    // setState-in-effect 룰 회피 — 첫 확인도 태스크 큐로 (즉시성 체감 차이 없음)
    const t0 = setTimeout(() => { void check(); }, 0);
    // 포그라운드 복귀마다 재확인 — 러닝 중 앱 재진입이 정확히 이 배너의 존재 이유.
    const onVis = () => { if (!document.hidden) void check(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', check);
    // 배너가 떠 있는 동안 20s 마다 거리 갱신 (가벼운 폴링 — active 아닐 땐 아래에서 정리됨)
    const interval = window.setInterval(() => { void check(); }, 20000);
    return () => {
      clearTimeout(t0);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', check);
      window.clearInterval(interval);
    };
  }, [check]);

  const onTrack = pathname === '/track' || pathname.startsWith('/track/') || pathname.startsWith('/track?');
  if (!run || onTrack || dismissed) return null;
  // 2026-07-15: 어제 강제종료된 세션 (복원 paused) 이 무기한 배너로 남던 문제 —
  // 24시간 넘은 세션은 "이전 러닝" 으로 표시 (탭하면 /track 에서 종료/저장 가능).

  const isStale = run.isStale;

  return (
    <div
      className={`fixed left-1/2 -translate-x-1/2 z-40 flex items-center gap-2.5 pl-3 pr-2 py-2 rounded-full text-white shadow-lg active:scale-95 transition ${
        isStale ? 'bg-zinc-600 shadow-zinc-600/40' : 'bg-emerald-600 shadow-emerald-600/40'
      }`}
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 76px)' }}
    >
      <button
        onClick={() => router.push('/track')}
        className="flex items-center gap-2.5"
        aria-label={tt('진행 중인 러닝으로 돌아가기')}
      >
        <span className="relative flex h-2.5 w-2.5">
          {!isStale && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white/70" />}
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
        </span>
        <span className="text-sm font-extrabold">
          {isStale ? tt('이전 러닝 정리하기') : run.state === 'running' ? tt('달리는 중') : tt('일시정지 중')}
          {' · '}{toDisplayDistance(run.distanceM / 1000, unit).toFixed(2)} {unitLabel(unit)}
          {' · '}{formatMin(run.activeSec)}
        </span>
      </button>
      {isStale && (
        <button
          onClick={() => setDismissed(true)}
          aria-label={tt('닫기')}
          className="w-7 h-7 rounded-full bg-white/15 flex items-center justify-center text-white text-sm font-bold"
        >
          ×
        </button>
      )}
    </div>
  );
}
