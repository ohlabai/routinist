// build 280: 이달의 라이벌 (Phase 1).
// Duolingo Leagues 식 1:1 랜덤 매칭. 모르는 사용자와 한 달 동안 km 경쟁.

import { getSupabase } from './supabase';
import { logClientWarn } from './error-logger';

export interface MonthlyRival {
  rivalUserId: string;
  rivalDisplayName: string | null;
  rivalAvatarUrl: string | null;
  myKm: number;
  rivalKm: number;
  month: string;       // 'YYYY-MM'
  daysLeft: number;
}

export async function fetchMyMonthlyRival(): Promise<MonthlyRival | null> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('fetch_my_monthly_rival');
    if (error || !data || data.length === 0) return null;
    const r = data[0] as {
      rival_user_id: string;
      rival_display_name: string | null;
      rival_avatar_url: string | null;
      my_km: number | string;
      rival_km: number | string;
      month: string;
      days_left: number;
    };
    return {
      rivalUserId: r.rival_user_id,
      rivalDisplayName: r.rival_display_name,
      rivalAvatarUrl: r.rival_avatar_url,
      myKm: Number(r.my_km) || 0,
      rivalKm: Number(r.rival_km) || 0,
      month: r.month,
      daysLeft: r.days_left,
    };
  } catch (e) {
    void logClientWarn('rival', 'fetch fail', {
      message: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
