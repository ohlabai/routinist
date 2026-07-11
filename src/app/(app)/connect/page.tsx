'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/components/UserDataProvider';
import {
  connectHealthKit, syncHealthData, isNativeApp, getPlatform,
  isWalkingSyncEnabled, setWalkingSyncEnabled,
  checkHealthConnectState, openHealthConnectSettings, HEALTH_CONNECT_PLAY_STORE_URL,
  type SyncProgress,
} from '@/lib/health-sync';
import { useI18n } from '@/lib/i18n';
import { ArrowLeft, Heart, Smartphone, Check, RefreshCw, Footprints, Download, Settings } from 'lucide-react';
import Link from 'next/link';

export default function ConnectPage() {
  const { user } = useAuth();
  const { refresh } = useUserData();
  const { tt } = useI18n();
  const [isNative, setIsNative] = useState(false);
  const [platform, setPlatform] = useState<string>('web');
  const [syncing, setSyncing] = useState(false);
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState('');
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [includeWalking, setIncludeWalking] = useState(false);
  // Android 전용 — Health Connect 앱 미설치/업데이트 필요 → Play 스토어 안내 버튼 표시
  const [needsHealthConnect, setNeedsHealthConnect] = useState(false);

  useEffect(() => {
    const native = isNativeApp();
    const plat = getPlatform();
    setIsNative(native);
    setPlatform(plat);
    setIncludeWalking(isWalkingSyncEnabled());
    // 마지막 동기화 시간 확인
    const saved = localStorage.getItem('last_health_sync');
    if (saved) setLastSync(saved);

    // iOS 네이티브에서 권한 상태 조회 — 이미 권한 있으면 "연결됨" 으로 자동 표시.
    // 이전엔 mount 마다 connected=false 로 초기화돼서 사용자가 매번 "연결하기" 누르고 있었음.
    if (native && plat === 'ios') {
      (async () => {
        try {
          const { Health } = await import('@capgo/capacitor-health');
          const status = await Health.checkAuthorization({
            read: ['workouts', 'distance', 'heartRate', 'calories', 'exerciseTime'],
            write: [],
          });
          if ((status.readAuthorized?.length ?? 0) > 0) {
            setConnected(true);
          }
        } catch {
          // 권한 조회 실패 시에도 그냥 disconnect 상태로 둠 (사용자가 "연결하기" 누르면 다시 시도)
        }
      })();
    }

    // Android — Health Connect 설치/권한 상태 조회 (권한 다이얼로그 안 띄움).
    if (native && plat === 'android') {
      (async () => {
        const state = await checkHealthConnectState();
        if (state.needsInstall) {
          setNeedsHealthConnect(true);
        } else if (state.authorized) {
          setConnected(true);
        }
      })();
    }
  }, []);

  const handleConnect = async () => {
    setSyncing(true);
    setMessage('');
    setProgress(null);
    try {
      const result = await connectHealthKit();
      if (result.needsHealthConnect) setNeedsHealthConnect(true);
      if (result.success) {
        setConnected(true);
        setNeedsHealthConnect(false);
        setMessage('연결 성공! 데이터를 동기화합니다...');

        if (user) {
          const syncResult = await syncHealthData(user.id, { onProgress: setProgress });
          setMessage(syncResult.message);
          if (syncResult.success) {
            if (syncResult.synced > 0) refresh();
            const now = new Date().toISOString();
            localStorage.setItem('last_health_sync', now);
            setLastSync(now);
            // build 298: 건강 연동 성공 = push 권한을 물을 가치 순간 (이미 허용/거부면 no-op)
            import('@/lib/push-notifications').then(m => m.promptPushPermission()).catch(() => {});
          }
        }
      } else {
        setMessage(result.message);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '연결 실패');
    } finally {
      setSyncing(false);
      setTimeout(() => setProgress(null), 1500);
    }
  };

  const handleSync = async () => {
    if (!user) return;
    setSyncing(true);
    setMessage('');
    setProgress({ stage: 'auth', percent: 0, label: '동기화 시작...' });
    try {
      // 30s race — UI 가 너무 오래 멈추지 않게. health-sync 내부에 60s mutex 안전망 있음.
      const result = await Promise.race([
        syncHealthData(user.id, { onProgress: setProgress }),
        new Promise<{ success: false; message: string; synced: 0 }>((resolve) =>
          setTimeout(() => resolve({ success: false, message: '동기화가 30초 초과 — 네트워크 또는 권한 확인 후 다시 시도해주세요', synced: 0 }), 30000)
        ),
      ]);
      setMessage(result.message);
      if (result.success) {
        if (result.synced > 0) refresh();
        const now = new Date().toISOString();
        localStorage.setItem('last_health_sync', now);
        setLastSync(now);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message
        : (e && typeof e === 'object' && 'message' in e) ? String((e as { message: unknown }).message)
        : '동기화 실패';
      setMessage(msg);
    } finally {
      setSyncing(false);
      setTimeout(() => setProgress(null), 1500);
    }
  };

  // Android — Health Connect 미설치/업데이트 필요 시 Play 스토어로 안내 (Android 13 이하는 별도 설치)
  const openPlayStoreForHealthConnect = async () => {
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url: HEALTH_CONNECT_PLAY_STORE_URL });
    } catch {
      window.open(HEALTH_CONNECT_PLAY_STORE_URL, '_blank');
    }
  };

  const formatLastSync = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/profile" className="text-[var(--muted)]"><ArrowLeft size={24} /></Link>
        <h1 className="text-2xl font-bold text-[var(--foreground)]">건강 앱 연동</h1>
      </div>

      <p className="text-base text-[var(--muted)] mb-5 leading-relaxed">
        건강 앱의 러닝 기록을 자동으로 가져옵니다
      </p>

      {/* Apple Health */}
      <div className="card p-5 mb-3">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center flex-shrink-0">
            <Heart size={28} className="text-red-500" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-[var(--foreground)]">Apple Health</h3>
            <p className="text-sm text-[var(--muted)] mt-1">
              러닝 거리·시간·칼로리 자동 가져오기
            </p>

            {isNative && platform === 'ios' ? (
              <div className="mt-4 space-y-3">
                {!connected ? (
                  <button
                    onClick={handleConnect}
                    disabled={syncing}
                    className="w-full py-3.5 rounded-xl bg-emerald-500 text-white font-bold text-base disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
                  >
                    {syncing ? <RefreshCw size={18} className="animate-spin" /> : <Heart size={18} />}
                    {syncing ? '연결 중…' : '연결하기'}
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <div className="flex items-center gap-1.5 text-base text-emerald-600 font-bold flex-1">
                      <Check size={18} /> 연결됨
                    </div>
                    <button
                      onClick={handleSync}
                      disabled={syncing}
                      className="px-5 py-2.5 rounded-xl bg-emerald-500 text-white text-base font-bold disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
                    >
                      <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
                      동기화
                    </button>
                  </div>
                )}
                {progress && (syncing || progress.percent < 100) && (
                  <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2 text-xs text-[var(--muted)]">
                      <span className="font-medium text-[var(--foreground)]">{progress.label}</span>
                      <span className="tabular-nums">{progress.percent}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-emerald-100 dark:bg-emerald-950/40 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-[width] duration-300 ease-out"
                        style={{ width: `${Math.max(progress.percent, 4)}%` }}
                      />
                    </div>
                  </div>
                )}
                {lastSync && !progress && (
                  <p className="text-sm text-[var(--muted)]">마지막 동기화 {formatLastSync(lastSync)}</p>
                )}
                {message && !progress && (
                  <p className={`text-sm font-medium ${message.includes('실패') ? 'text-red-500' : 'text-emerald-600'}`}>
                    {message}
                  </p>
                )}
                {/* build 219 #9: 권한 항목 변경 안내 — iOS 는 앱에서 직접 권한 토글 못 함 */}
                {connected && (
                  <div className="mt-1 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40">
                    <p className="text-xs font-bold text-amber-800 dark:text-amber-200 mb-1.5">권한 항목을 바꾸고 싶다면</p>
                    <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
                      iPhone <span className="font-extrabold">설정 앱 → 개인정보 보호 및 보안 → 건강 → Routinist</span> 에서<br/>
                      가져올 데이터(러닝/심박수/칼로리 등)를 다시 선택할 수 있어요
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-3 flex items-start gap-2 text-sm text-[var(--muted)]">
                <Smartphone size={16} className="flex-shrink-0 mt-0.5" />
                <span>iOS 앱에서만 사용할 수 있어요</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 걷기 동기화 opt-in — 기본은 러닝만 가져옴 */}
      {isNative && (
        <button
          onClick={() => {
            const next = !includeWalking;
            setIncludeWalking(next);
            setWalkingSyncEnabled(next);
          }}
          className="w-full card p-4 mb-3 text-left active:scale-[0.99] transition flex items-center gap-3"
        >
          <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 ${
            includeWalking ? 'bg-gradient-to-br from-emerald-100 to-emerald-50 dark:from-emerald-900/40 dark:to-emerald-950/40 text-emerald-600' : 'bg-[var(--card-border)]/30 text-[var(--muted)]'
          }`}>
            <Footprints size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-extrabold text-[var(--foreground)]">걷기 기록도 가져오기</p>
            <p className="text-[11px] text-[var(--muted)] mt-0.5 leading-snug">
              끄면 러닝 기록만 가져와요 · 걷기는 기록에 &lsquo;걷기&rsquo;로 구분 표시돼요
            </p>
          </div>
          <div className={`w-11 h-6 rounded-full transition relative flex-shrink-0 ${includeWalking ? 'bg-gradient-to-r from-emerald-500 to-emerald-600' : 'bg-[var(--card-border)]'}`}>
            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${includeWalking ? 'left-[22px]' : 'left-0.5'}`} />
          </div>
        </button>
      )}

      {/* Samsung Health / Health Connect */}
      <div className="card p-5 mb-3">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="#3B82F6"/>
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-[var(--foreground)]">Health Connect</h3>
            <p className="text-sm text-[var(--muted)] mt-1">
              {tt('삼성 헬스·갤럭시 워치 러닝 기록 자동 가져오기')}
            </p>

            {isNative && platform === 'android' ? (
              <div className="mt-4 space-y-3">
                {needsHealthConnect ? (
                  <div className="space-y-2">
                    <p className="text-sm text-[var(--muted)] leading-relaxed">
                      {tt('건강 데이터를 가져오려면 Health Connect 앱이 필요해요')}
                    </p>
                    <button
                      onClick={openPlayStoreForHealthConnect}
                      className="w-full py-3.5 rounded-xl bg-emerald-500 text-white font-bold text-base flex items-center justify-center gap-2 shadow-sm"
                    >
                      <Download size={18} />
                      {tt('Play 스토어에서 Health Connect 받기')}
                    </button>
                  </div>
                ) : !connected ? (
                  <button
                    onClick={handleConnect}
                    disabled={syncing}
                    className="w-full py-3.5 rounded-xl bg-emerald-500 text-white font-bold text-base disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
                  >
                    {syncing ? <RefreshCw size={18} className="animate-spin" /> : <Heart size={18} />}
                    {syncing ? tt('연결하는 중…') : tt('연결하기')}
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <div className="flex items-center gap-1.5 text-base text-emerald-600 font-bold flex-1">
                      <Check size={18} /> {tt('연결됨')}
                    </div>
                    <button
                      onClick={handleSync}
                      disabled={syncing}
                      className="px-5 py-2.5 rounded-xl bg-emerald-500 text-white text-base font-bold disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
                    >
                      <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
                      {tt('동기화')}
                    </button>
                  </div>
                )}
                {progress && (syncing || progress.percent < 100) && (
                  <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2 text-xs text-[var(--muted)]">
                      <span className="font-medium text-[var(--foreground)]">{progress.label}</span>
                      <span className="tabular-nums">{progress.percent}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-emerald-100 dark:bg-emerald-950/40 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-[width] duration-300 ease-out"
                        style={{ width: `${Math.max(progress.percent, 4)}%` }}
                      />
                    </div>
                  </div>
                )}
                {lastSync && !progress && (
                  <p className="text-sm text-[var(--muted)]">{tt('마지막 동기화')} {formatLastSync(lastSync)}</p>
                )}
                {message && !progress && (
                  <p className={`text-sm font-medium ${message.includes('실패') ? 'text-red-500' : 'text-emerald-600'}`}>
                    {message}
                  </p>
                )}
                {/* Android 는 Health Connect 앱에서 권한을 직접 관리 — 설정 화면 바로가기 제공 */}
                {connected && !needsHealthConnect && (
                  <button
                    onClick={() => openHealthConnectSettings()}
                    className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-bold text-[var(--muted)]"
                  >
                    <Settings size={14} />
                    {tt('Health Connect에서 권한 관리')}
                  </button>
                )}
              </div>
            ) : (
              <div className="mt-3 flex items-start gap-2 text-sm text-[var(--muted)]">
                <Smartphone size={16} className="flex-shrink-0 mt-0.5" />
                <span>Android 앱에서만 사용할 수 있어요</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 안내 — 간소화 */}
      <p className="mt-6 text-sm text-[var(--muted)] text-center leading-relaxed">
        Nike Run Club·런데이·Garmin 기록도<br/>건강 앱으로 자동 연동됩니다
      </p>
    </div>
  );
}
