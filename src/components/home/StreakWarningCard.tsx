'use client';

// 스트릭 위협 카드 — 저녁 18시 이후, 오늘 안 달림 + 연속일 ≥1 일 때 표시.
// 손실회피 효과로 동기부여. 푸시 알림은 별도 backlog. 일단 in-app 카드.
//
// 습관 형성 확장 — 스트릭 보호권:
//  - 경고 모드 (기존): 어제까지 달렸고 오늘 아직 안 달림 → 자정까지가 데드라인.
//    문구 정직성 fix: "오늘 안 달리면" 은 시점이 모호했음 → "오늘 자정까지" 로 조건 정확화
//    (getStreak 은 마지막 러닝이 어제면 오늘까지만 살아있다고 판정).
//  - 구출 모드 (신규): 어제가 비어 스트릭이 이미 죽었지만, 보호권으로 어제를 메우면
//    이어지는 경우 → [보호권 쓰기] 버튼. 하루 종일 급한 상황이라 18시 게이트 없이 표시.

import { useEffect, useMemo, useState } from 'react';
import { Flame, Shield } from 'lucide-react';
import { todayStr, daysAgoStr } from '@/lib/kst';
import { getStreak } from '@/lib/routinist-data';
import type { Activity } from '@/types';
import { useI18n } from '@/lib/i18n';
import AppToast from '@/components/AppToast';

interface Props {
  activities: Activity[];
  /** 보호권 사용일 반영된 현재 스트릭 (dashboard 에서 getStreak(activities, freezeUses)) */
  streak: number;
  /** 보유 보호권 수 (RPC 실패/미배포 시 0 → 기존 카드와 동일하게 동작) */
  freezeCount?: number;
  /** 최근 60일 보호권 사용일 Set */
  freezeUses?: Set<string>;
  /** 보호권 사용 성공 후 호출 — dashboard 가 freeze 상태 재조회 → 스트릭/카드 갱신 */
  onFreezeUsed?: () => void;
}

export default function StreakWarningCard({ activities, streak, freezeCount = 0, freezeUses, onFreezeUsed }: Props) {
  const { tt, locale } = useI18n();
  // 1분 간격 tick 으로 hour 변화 감지 — 사용자가 17:55 에 mount 후 18:00 넘어가도 표시.
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => {
    const id = setInterval(() => setHour(new Date().getHours()), 60_000);
    return () => clearInterval(id);
  }, []);

  const [using, setUsing] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const today = todayStr();
  const yesterday = daysAgoStr(1);
  const ranToday = activities.some(a => a.activity_date === today);
  const yesterdayCovered =
    activities.some(a => a.activity_date === yesterday) || (freezeUses?.has(yesterday) ?? false);

  // 구출 모드: 어제가 비었고 보호권이 있을 때, "어제를 보호권으로 메우면" 살아나는 스트릭.
  // >=2 (보호권 하루 + 그 전의 실제 러닝 체인) 여야 지킬 가치가 있음.
  const rescueStreak = useMemo(() => {
    if (ranToday || yesterdayCovered || freezeCount <= 0) return 0;
    const merged = new Set(freezeUses ?? []);
    merged.add(yesterday);
    return getStreak(activities, merged);
  }, [activities, ranToday, yesterdayCovered, freezeCount, freezeUses, yesterday]);
  const rescueMode = rescueStreak >= 2;

  const handleUseFreeze = async () => {
    if (using) return;
    setUsing(true);
    try {
      const { spendStreakFreeze } = await import('@/lib/streak-freeze');
      const r = await spendStreakFreeze(yesterday);
      if (r.ok) {
        const remainTail = typeof r.remaining === 'number'
          ? (locale === 'en' ? ` (${r.remaining} left)` : ` (남은 보호권 ${r.remaining}개)`)
          : '';
        setToast({
          text: (locale === 'en'
            ? `Yesterday is safe — streak protected! 🛡️`
            : `보호권으로 어제를 지켰어요! 🛡️`) + remainTail,
          tone: 'ok',
        });
        onFreezeUsed?.();
      } else if (r.reason === 'already_covered') {
        setToast({ text: tt('어제는 이미 지켜져 있어요'), tone: 'ok' });
        onFreezeUsed?.();
      } else if (r.reason === 'no_freezes') {
        setToast({ text: tt('남은 보호권이 없어요'), tone: 'warn' });
        onFreezeUsed?.();
      } else {
        setToast({ text: tt('지금은 보호권을 쓸 수 없어요. 잠시 후 다시 시도해주세요'), tone: 'warn' });
      }
    } finally {
      setUsing(false);
    }
  };

  if (ranToday) return null;

  // ---- 구출 모드 (18시 게이트 없음 — 오늘이 지나면 어제 보호권도 소용 없어짐) ----
  if (rescueMode) {
    return (
      <>
        <div className="card p-4 bg-gradient-to-r from-sky-50 to-emerald-50 dark:from-sky-950/30 dark:to-emerald-950/30 border-emerald-200 dark:border-emerald-800/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
              <Shield size={22} className="text-emerald-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-[var(--foreground)]">
                {locale === 'en'
                  ? `Yesterday was a rest day — you can still save your ${rescueStreak}-day streak`
                  : `어제 하루 쉬었어요 — 아직 ${rescueStreak}일 연속을 지킬 수 있어요`}
              </p>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                {locale === 'en'
                  ? `${freezeCount} freeze${freezeCount === 1 ? '' : 's'} left · cover yesterday and keep going`
                  : `보호권 ${freezeCount}개 보유 · 어제를 지킬 수 있어요`}
              </p>
            </div>
            <button
              onClick={handleUseFreeze}
              disabled={using}
              className="flex-shrink-0 px-3.5 py-2 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-sm font-extrabold shadow-md shadow-emerald-500/30 active:scale-95 transition disabled:opacity-50"
            >
              {using ? tt('사용 중...') : tt('보호권 쓰기')}
            </button>
          </div>
        </div>
        {toast && (
          <AppToast text={toast.text} tone={toast.tone} position="top" onClose={() => setToast(null)} durationMs={3000} />
        )}
      </>
    );
  }

  // ---- 경고 모드 (기존) ----
  // 조건:
  // 1) 저녁 18시 이후 (오전엔 아직 시간 충분 → 알림 부담)
  // 2) 오늘 활동 0건 (위에서 체크)
  // 3) streak >= 1 (끊길 게 있어야 위협)
  if (hour < 18) return null;
  if (streak < 1) return null;

  return (
    <>
      <div className="card p-4 bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-950/30 dark:to-red-950/30 border-orange-200 dark:border-orange-800/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-orange-500/15 flex items-center justify-center flex-shrink-0">
            <Flame size={22} className="text-orange-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-[var(--foreground)]">
              {locale === 'en'
                ? `Run before midnight or your ${streak}-day streak breaks`
                : `오늘 자정까지 안 달리면 ${streak}일 연속이 끊겨요`}
            </p>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              {locale === 'en'
                ? `${tt('짧게라도 1km 만 달려보세요')} — keeping the streak is the strongest motivator`
                : `${tt('짧게라도 1km 만 달려보세요')} — 연속 유지가 가장 큰 동력이에요`}
            </p>
            {/* 보호권 보유 안내 — 어제까지는 지켜져 있으니 버튼 없이 안심 문구만 (오늘은 달려야 지켜짐) */}
            {freezeCount > 0 && (
              <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 mt-1 flex items-center gap-1">
                <Shield size={12} className="flex-shrink-0" />
                {locale === 'en'
                  ? `${freezeCount} streak freeze${freezeCount === 1 ? '' : 's'} in your pocket — a missed day can still be saved tomorrow`
                  : `보호권 ${freezeCount}개 보유 — 하루 놓쳐도 내일 지킬 수 있어요`}
              </p>
            )}
          </div>
        </div>
      </div>
      {toast && (
        <AppToast text={toast.text} tone={toast.tone} position="top" onClose={() => setToast(null)} durationMs={3000} />
      )}
    </>
  );
}
