-- build 219 #6/7: fetch_user_weekly_recap 이 created_at (import 시각) 기준이라
-- 사용자가 Apple Health bulk import 하면 created_at 가 모두 import 시점 → 이번 주/달 합계가
-- 전체 누적치와 같아짐 (Diana / jane 김수빈 둘 다 1801km / 328km 동일하게 표시되는 회귀).
-- 수정: activity_date (실제 러닝 날짜) 기준으로 필터.

CREATE OR REPLACE FUNCTION public.fetch_user_weekly_recap(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v JSON;
  d_week_start DATE := (date_trunc('week', now() AT TIME ZONE 'Asia/Seoul'))::DATE;
  d_month_start DATE := (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul'))::DATE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND is_public = true) THEN
    RETURN NULL;
  END IF;

  SELECT json_build_object(
    'week_km',       (SELECT COALESCE(SUM(distance_km), 0)::NUMERIC(10,1)
                        FROM public.activities
                       WHERE user_id = p_user_id AND visibility = 'public'
                         AND activity_date >= d_week_start),
    'week_runs',     (SELECT COUNT(*)
                        FROM public.activities
                       WHERE user_id = p_user_id AND visibility = 'public'
                         AND activity_date >= d_week_start),
    'week_longest',  (SELECT COALESCE(MAX(distance_km), 0)::NUMERIC(10,1)
                        FROM public.activities
                       WHERE user_id = p_user_id AND visibility = 'public'
                         AND activity_date >= d_week_start),
    'week_avg_pace', (SELECT AVG(pace_avg_sec_per_km)::NUMERIC(10,1)
                        FROM public.activities
                       WHERE user_id = p_user_id AND visibility = 'public'
                         AND activity_date >= d_week_start
                         AND pace_avg_sec_per_km BETWEEN 240 AND 900),
    'month_km',      (SELECT COALESCE(SUM(distance_km), 0)::NUMERIC(10,1)
                        FROM public.activities
                       WHERE user_id = p_user_id AND visibility = 'public'
                         AND activity_date >= d_month_start),
    'month_runs',    (SELECT COUNT(*)
                        FROM public.activities
                       WHERE user_id = p_user_id AND visibility = 'public'
                         AND activity_date >= d_month_start)
  ) INTO v;
  RETURN v;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fetch_user_weekly_recap FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fetch_user_weekly_recap TO authenticated;
