-- build 162 #4: 친구 프로필 "최근 7일 러닝 경로" 미니맵 안 보이는 회귀.
-- 기존 created_at 기준은 Apple Health 동기화 시점·import 시점으로 흩어져 정확하지 않음.
-- 사용자가 보는 "최근 7일" 은 실제 러닝 한 날짜 (activity_date) 기준이어야 함.
CREATE OR REPLACE FUNCTION public.fetch_user_recent_routes(p_user_id UUID, p_days INTEGER DEFAULT 30)
RETURNS TABLE (
  activity_id UUID,
  distance_km NUMERIC,
  duration_seconds INTEGER,
  pace_avg_sec_per_km NUMERIC,
  activity_date DATE,
  route_data JSONB
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND is_public = true) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT a.id, a.distance_km::NUMERIC, a.duration_seconds, a.pace_avg_sec_per_km::NUMERIC,
         a.activity_date, a.route_data
  FROM public.activities a
  WHERE a.user_id = p_user_id
    AND a.visibility = 'public'
    AND a.activity_date >= (CURRENT_DATE - p_days)
  ORDER BY a.activity_date DESC, a.created_at DESC
  LIMIT 60;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_user_recent_routes(UUID, INTEGER) TO authenticated;
