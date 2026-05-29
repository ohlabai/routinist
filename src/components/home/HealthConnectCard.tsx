'use client';

// 홈 최상단 HealthKit 안내 카드 (build 62 — 1차 거절 2.5.1 fix).
// Apple 가이드 2.5.1: HealthKit 사용을 앱 UI 에서 명확히 indicate. 메뉴 깊은 곳이 아니라
// 첫 화면에서 즉시 보이게.
//
// 두 상태:
//   - 미연동: 큰 emerald CTA 카드 → 클릭 시 connect 페이지
//   - 연동됨: 작은 회색 status 배지 + 마지막 동기화 시각 + 동기화 버튼

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Heart, RefreshCw, Check } from 'lucide-react';
import { useUserData } from '@/components/UserDataProvider';
import { useAuth } from '@/components/AuthProvider';
import { syncHealthData, isNativeApp, getPlatform, type SyncProgress } from '@/lib/health-sync';
import { useI18n, type Locale } from '@/lib/i18n';

type Status = 'unknown' | 'not_connected' | 'connected';

function formatAgo(ts: number, now: number, locale: Locale): string {
  const sec = Math.floor((now - ts) / 1000);
  if (sec < 60) return locale === 'en' ? 'Just synced' : '방금 동기화됨';
  const min = Math.floor(sec / 60);
  if (min < 60) return locale === 'en' ? `${min}m ago` : `${min}분 전 동기화`;
  const h = Math.floor(min / 60);
  if (h < 24) return locale === 'en' ? `${h}h ago` : `${h}시간 전 동기화`;
  const d = Math.floor(h / 24);
  return locale === 'en' ? `${d}d ago` : `${d}일 전 동기화`;
}

export default function HealthConnectCard() {
  const router = useRouter();
  const { user } = useAuth();
  const { activities, refresh } = useUserData();
  const { tt, locale } = useI18n();
  const [status, setStatus] = useState<Status>('unknown');
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [lastSyncTs, setLastSyncTs] = useState<number | null>(null);

  // 초기: localStorage 의 first_sync_done flag + activities 보유 여부로 빠르게 판단
  useEffect(() => {
    if (!user) return;
    if (typeof window === 'undefined') return;

    const flag = window.localStorage.getItem(`first_sync_done:${user.id}`);
    const lastSync = window.localStorage.getItem('last_health_sync');
    const tsParsed = lastSync ? Date.parse(lastSync) : (flag ? parseInt(flag, 10) : NaN);
    if (!isNaN(tsParsed)) setLastSyncTs(tsParsed);

    // 권한 + 활동 둘 중 하나라도 있으면 연동된 걸로 간주 (낙관적 — 다음 sync 시도 시 실 검증)
    if (flag || (activities.length > 0)) {
      setStatus('connected');
    } else if (!isNativeApp() || getPlatform() !== 'ios') {
      // 웹에선 HealthKit 자체 불가 → 카드 숨김
      setStatus('connected');
    } else {
      setStatus('not_connected');
    }
  }, [user, activities.length]);

  // 1분마다 "N분 전" 라벨 재계산
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // PullToRefresh 등 외부에서 sync 발사 시 즉시 라벨 갱신.
  useEffect(() => {
    const handler = (e: Event) => {
      const ts = (e as CustomEvent<{ ts: number }>).detail?.ts;
      if (ts) {
        setLastSyncTs(ts);
        setNow(Date.now());
      }
    };
    window.addEventListener('routinist:lastSync', handler);
    return () => window.removeEventListener('routinist:lastSync', handler);
  }, []);

  // 미네이티브 또는 unknown 일 땐 자리 차지 안 함
  if (status === 'unknown') return null;
  if (!isNativeApp() || getPlatform() !== 'ios') return null;

  const handleConnect = () => {
    router.push('/connect');
  };

  const handleSync = async () => {
    if (!user || syncing) return;
    // 클릭 즉시 lastSyncTs 를 "지금" 으로 갱신 (낙관적) — UI 가 "방금 동기화" 로 즉시 변함.
    // syncHealthData 가 실제 끝날 때까지 기다리지 않음. 사용자 신고 #3: 동기화 클릭 후 라벨이
    // 결과 반영까지 늦어 "3시간 전" 으로 보이는 문제.
    const optimisticTs = Date.now();
    // 낙관 갱신은 try 밖 — syncHealthData 가 throw 해도 localStorage 는 저장됨.
    // 사용자가 동기화를 "시도" 한 시각이 보존돼 다음 마운트에서도 "방금" 으로 표시.
    setLastSyncTs(optimisticTs);
    window.localStorage.setItem('last_health_sync', new Date(optimisticTs).toISOString());
    window.localStorage.setItem(`first_sync_done:${user.id}`, String(optimisticTs));
    setSyncing(true);
    setProgress({ stage: 'auth', percent: 0, label: tt('동기화 시작...') });
    try {
      const r = await Promise.race([
        syncHealthData(user.id, { onProgress: setProgress }),
        new Promise<{ success: false; synced: 0; message: string }>((resolve) =>
          setTimeout(() => resolve({ success: false, synced: 0, message: '30초 초과' }), 30000)
        ),
      ]);
      if (r.success) {
        setStatus('connected');
        if (r.synced > 0) refresh();
      } else {
        console.warn('[HealthConnectCard] sync failed:', r.message);
      }
    } finally {
      setSyncing(false);
      setTimeout(() => setProgress(null), 1500);
    }
  };

  // 미연동: 큰 강조 카드 (홈 진입 시 즉시 보임)
  if (status === 'not_connected') {
    return (
      <div className="mx-4 mt-3 mb-1">
        <button
          onClick={handleConnect}
          className="w-full flex items-center gap-3 p-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-md active:scale-[0.99] transition-transform"
          aria-label={tt('Apple 건강 앱 연동하기')}
        >
          <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
            <Heart size={24} className="text-white" />
          </div>
          <div className="flex-1 text-left">
            <p className="text-base font-bold">{tt('Apple 건강 앱 연동하기')}</p>
            <p className="text-xs text-white/85 mt-0.5">{tt('러닝·걷기·심박·GPS 자동으로 가져옵니다')}</p>
          </div>
          <span className="text-2xl">→</span>
        </button>
      </div>
    );
  }

  // 연동됨: 작은 status 배지 (사용자에게 부담 안 주면서 HealthKit 사용 명시)
  return (
    <div className="mx-4 mt-3 mb-1">
      <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-900/40">
        <div className="w-7 h-7 rounded-lg bg-white dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
          <Heart size={15} className="text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200 flex items-center gap-1">
            <Check size={11} /> {tt('Apple Health 연동됨')}
          </p>
          <p className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80 truncate">
            {syncing && progress
              ? `${progress.label} · ${progress.percent}%`
              : lastSyncTs
                ? formatAgo(lastSyncTs, now, locale)
                : (locale === 'en' ? 'Ready to sync' : '동기화 준비됨')}
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-200 text-xs font-semibold border border-emerald-200/60 dark:border-emerald-800 active:scale-95 disabled:opacity-50"
        >
          <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} />
          {locale === 'en' ? 'Sync' : '동기화'}
        </button>
      </div>
    </div>
  );
}
