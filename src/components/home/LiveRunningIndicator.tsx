'use client';

// "지금 달리는 중" 인디케이터 — 경쟁 자극 장치.
// 최근 30분 내 activities 업로드된 러너 수 표시 (같은 지역 기준).

import { useEffect, useState } from 'react';
import { Radio } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';

export default function LiveRunningIndicator() {
  const { user, profile } = useAuth();
  const { locale } = useI18n();
  const [count, setCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !profile?.region_gu) { setLoading(false); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval>;

    const fetchCount = async () => {
      try {
        const supabase = getSupabase();
        const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const { count: n } = await supabase
          .from('activities')
          .select('user_id', { count: 'exact', head: true })
          .neq('user_id', user.id)
          .gte('created_at', since);
        if (!cancelled) {
          setCount(n ?? 0);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };

    fetchCount();
    timer = setInterval(fetchCount, 60_000); // 1분마다 갱신

    return () => { cancelled = true; clearInterval(timer); };
  }, [user, profile?.region_gu]);

  if (loading || count === 0 || !profile?.region_gu) return null;

  return (
    <div className="mx-4 mt-3 flex items-center gap-2 px-4 py-2.5 rounded-full bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900/50">
      <div className="relative flex-shrink-0">
        <Radio size={14} className="text-green-600 dark:text-green-400" />
        <span className="absolute inset-0 rounded-full bg-green-400 animate-ping opacity-60" />
      </div>
      <p className="text-xs font-semibold text-green-700 dark:text-green-300">
        {locale === 'en' ? (
          <>
            <span className="font-extrabold">{count}</span> runners are running right now 🏃‍♂️
          </>
        ) : (
          <>
            지금 <span className="font-extrabold">{count}명</span>의 러너가 달리는 중이에요 🏃‍♂️
          </>
        )}
      </p>
    </div>
  );
}
