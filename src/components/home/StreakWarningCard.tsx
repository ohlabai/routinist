'use client';

// 스트릭 위협 카드 — 저녁 18시 이후, 오늘 안 달림 + 연속일 ≥1 일 때 표시.
// 손실회피 효과로 동기부여. 사용자가 "오늘 안 달리면 X일 연속이 끊겨요" 메시지 보면 행동.
// 푸시 알림은 별도 backlog (LocalNotifications + iOS 권한). 일단 in-app 카드.

import { useEffect, useState } from 'react';
import { Flame } from 'lucide-react';
import { todayStr } from '@/lib/kst';
import type { Activity } from '@/types';
import { useI18n } from '@/lib/i18n';

interface Props {
  activities: Activity[];
  streak: number;
}

export default function StreakWarningCard({ activities, streak }: Props) {
  const { tt, locale } = useI18n();
  // 1분 간격 tick 으로 hour 변화 감지 — 사용자가 17:55 에 mount 후 18:00 넘어가도 표시.
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => {
    const id = setInterval(() => setHour(new Date().getHours()), 60_000);
    return () => clearInterval(id);
  }, []);

  // 조건:
  // 1) 저녁 18시 이후 (오전엔 아직 시간 충분 → 알림 부담)
  // 2) 오늘 활동 0건
  // 3) streak >= 1 (끊길 게 있어야 위협)
  if (hour < 18) return null;
  if (streak < 1) return null;
  const today = todayStr();
  const ranToday = activities.some(a => a.activity_date === today);
  if (ranToday) return null;

  return (
    <div className="card p-4 flex items-center gap-3 bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-950/30 dark:to-red-950/30 border-orange-200 dark:border-orange-800/50">
      <div className="w-10 h-10 rounded-full bg-orange-500/15 flex items-center justify-center flex-shrink-0">
        <Flame size={22} className="text-orange-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-[var(--foreground)]">
          {locale === 'en'
            ? `Don't run today and your ${streak}-day streak breaks`
            : `오늘 안 달리면 ${streak}일 연속이 끊겨요`}
        </p>
        <p className="text-xs text-[var(--muted)] mt-0.5">
          {locale === 'en'
            ? `${tt('짧게라도 1km 만 달려보세요')} — keeping the streak is the strongest motivator`
            : `${tt('짧게라도 1km 만 달려보세요')} — 연속 유지가 가장 큰 동력이에요`}
        </p>
      </div>
    </div>
  );
}
