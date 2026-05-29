'use client';

// 홈 상단의 Apple Health 연동 단일 진입점.
// 상태별 UI:
//  - 처음 (activities 비어있음): 큰 배너 "Apple Health 연결하기" — 권한 요청 + 첫 동기화
//  - 사용 중 (activities 존재): 컴팩트 칩 "최신 기록 불러오기" — 재동기화
//  - 권한 거부: 설정 화면 안내
// iOS 네이티브 앱에서만 노출.

import { useEffect, useState } from 'react';
import { RefreshCw, Heart, AlertCircle } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { syncHealthData, connectHealthKit, isNativeApp, getPlatform } from '@/lib/health-sync';
import AppToast from '@/components/AppToast';
import { useI18n } from '@/lib/i18n';

interface Props {
  onSynced?: () => void;
  hasActivities?: boolean;
}

export default function HealthRefreshChip({ onSynced, hasActivities = true }: Props) {
  const { user } = useAuth();
  const { tt, locale } = useI18n();
  const [show, setShow] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const [authDenied, setAuthDenied] = useState(false);

  useEffect(() => {
    setShow(isNativeApp() && getPlatform() === 'ios');
  }, []);

  if (!show || !user) return null;

  const handleSync = async () => {
    setSyncing(true);
    setAuthDenied(false);

    // 안전망: 12초 안에 sync 가 끝나지 않으면 강제 종료. capgo plugin 이 hang 하는 케이스 방지.
    const timeoutId = setTimeout(() => {
      setSyncing(false);
      setToast({ text: tt('동기화가 너무 오래 걸려요. 다시 시도해주세요'), tone: 'warn' });
      setTimeout(() => setToast(null), 4000);
    }, 12000);

    try {
      const connectResult = await connectHealthKit();
      if (connectResult.authDenied) {
        setAuthDenied(true);
        setToast({ text: connectResult.message, tone: 'warn' });
        setTimeout(() => setToast(null), 4000);
        return;
      }
      const result = await syncHealthData(user.id);
      if (result.authDenied) {
        setAuthDenied(true);
        setToast({ text: result.message, tone: 'warn' });
      } else if (result.synced > 0) {
        setToast({ text: locale === 'en' ? `Synced ${result.synced} records!` : `${result.synced}건 동기화 완료!`, tone: 'ok' });
        // sync 성공 시 last_health_sync 갱신 → SyncStaleBadge 가 즉시 반영
        try {
          localStorage.setItem('last_health_sync', new Date().toISOString());
        } catch {}
        onSynced?.();
      } else if (result.success) {
        // 누락 detection: Apple Health 에 워크아웃이 N건 있는데 새 0건 + 중복도 N 보다 작으면 어딘가 빠짐
        const m = result.meta;
        if (m && m.totalFromHealth > 0 && m.candidates === 0 && m.duplicates < m.totalFromHealth) {
          setToast({
            text: locale === 'en'
              ? `Apple Health has ${m.totalFromHealth} records but ${m.totalFromHealth - m.duplicates} missing — try again`
              : `Apple Health 에 ${m.totalFromHealth}건 있는데 ${m.totalFromHealth - m.duplicates}건이 누락 — 다시 시도해보세요`,
            tone: 'warn',
          });
        } else {
          setToast({ text: tt('새 기록이 없어요'), tone: 'ok' });
        }
        try {
          localStorage.setItem('last_health_sync', new Date().toISOString());
        } catch {}
      } else {
        setToast({ text: result.message, tone: 'warn' });
      }
      setTimeout(() => setToast(null), 4000);
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : tt('동기화 실패'), tone: 'warn' });
      setTimeout(() => setToast(null), 3000);
    } finally {
      clearTimeout(timeoutId);
      setSyncing(false);
    }
  };

  // 권한 거부됨: 설정 안내 배너
  if (authDenied) {
    return (
      <>
        <div className="mx-4 mt-3 card p-3 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border-amber-200 dark:border-amber-500/30">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-[var(--foreground)]">{tt('Apple Health 권한이 필요해요')}</p>
              <p className="text-xs text-[var(--muted)] mt-1">
                {locale === 'en'
                  ? 'Settings → Privacy → Health → Routinist: allow all permissions.'
                  : '설정 → 개인정보 보호 → 건강 → Routinist 에서 모든 권한을 허용해주세요.'}
              </p>
            </div>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="text-xs font-bold text-amber-700 dark:text-amber-300 px-2 py-1 rounded-lg bg-amber-100 dark:bg-amber-900/40 disabled:opacity-50"
            >
              {syncing ? '...' : tt('재시도')}
            </button>
          </div>
        </div>
        {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} />}
      </>
    );
  }

  // 첫 사용: 큰 배너 (활동 데이터 없음)
  if (!hasActivities) {
    return (
      <>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="mx-4 mt-3 w-[calc(100%-2rem)] card p-3 bg-gradient-to-r from-emerald-50 to-green-50 dark:from-emerald-950/30 dark:to-green-950/30 border-0 active:scale-[0.99] transition disabled:opacity-60"
        >
          <div className="flex items-center gap-3">
            {syncing ? (
              <RefreshCw size={20} className="text-emerald-600 animate-spin flex-shrink-0" />
            ) : (
              <Heart size={22} className="text-red-500 flex-shrink-0" />
            )}
            <div className="flex-1 text-left">
              <p className="text-sm font-semibold text-[var(--foreground)]">
                {syncing
                  ? (locale === 'en' ? 'Loading from Apple Health...' : 'Apple Health 에서 불러오는 중...')
                  : tt('Apple Health 와 연결해보세요')}
              </p>
              <p className="text-xs text-[var(--muted)]">
                {syncing
                  ? (locale === 'en' ? 'Please wait a moment' : '잠시만 기다려주세요')
                  : (locale === 'en' ? 'Auto import and analyze your runs' : '러닝 기록을 자동으로 가져와 분석합니다')}
              </p>
            </div>
            {!syncing && <span className="text-emerald-600 font-bold text-sm">{locale === 'en' ? 'Connect' : '연결'}</span>}
          </div>
        </button>
        {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} />}
      </>
    );
  }

  // 사용 중: 컴팩트 칩
  return (
    <>
      <button
        type="button"
        onClick={handleSync}
        disabled={syncing}
        className="mx-4 mt-3 w-[calc(100%-2rem)] flex items-center justify-center gap-2 py-2.5 rounded-2xl bg-white border border-emerald-200 text-emerald-700 font-semibold text-sm shadow-sm active:scale-[0.99] transition disabled:opacity-60"
      >
        {syncing ? (
          <>
            <RefreshCw size={16} className="animate-spin" />
            <span>{locale === 'en' ? 'Loading from Apple Health...' : 'Apple Health에서 불러오는 중...'}</span>
          </>
        ) : (
          <>
            <RefreshCw size={16} />
            <span>{tt('Apple Health 최신 기록 불러오기')}</span>
          </>
        )}
      </button>
      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} />}
    </>
  );
}
