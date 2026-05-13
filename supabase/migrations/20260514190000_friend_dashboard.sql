-- 2026-05-14 build 130 — 친구 dashboard 카드 데이터

------------------------------------------------------------
-- (A) fetch_user_weekly_recap — 친구 이번 주 회고
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_user_weekly_recap(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v JSON;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND is_public = true) THEN RETURN NULL; END IF;

  -- 한국시간 월요일 기준 이번 주
  SELECT json_build_object(
    'week_km', (SELECT COALESCE(SUM(distance_km), 0)::NUMERIC(10,1) FROM public.activities WHERE user_id = p_user_id AND visibility = 'public' AND created_at >= date_trunc('week', now() AT TIME ZONE 'Asia/Seoul')),
    'week_runs', (SELECT COUNT(*) FROM public.activities WHERE user_id = p_user_id AND visibility = 'public' AND created_at >= date_trunc('week', now() AT TIME ZONE 'Asia/Seoul')),
    'week_longest', (SELECT COALESCE(MAX(distance_km), 0)::NUMERIC(10,1) FROM public.activities WHERE user_id = p_user_id AND visibility = 'public' AND created_at >= date_trunc('week', now() AT TIME ZONE 'Asia/Seoul')),
    'week_avg_pace', (SELECT AVG(pace_avg_sec_per_km)::NUMERIC(10,1) FROM public.activities WHERE user_id = p_user_id AND visibility = 'public' AND created_at >= date_trunc('week', now() AT TIME ZONE 'Asia/Seoul') AND pace_avg_sec_per_km BETWEEN 240 AND 900),
    'month_km', (SELECT COALESCE(SUM(distance_km), 0)::NUMERIC(10,1) FROM public.activities WHERE user_id = p_user_id AND visibility = 'public' AND created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Seoul')),
    'month_runs', (SELECT COUNT(*) FROM public.activities WHERE user_id = p_user_id AND visibility = 'public' AND created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Seoul'))
  ) INTO v;
  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_user_weekly_recap(UUID) TO authenticated, anon;

------------------------------------------------------------
-- (B) fetch_user_courses_public — 친구가 도전 중·완주한 월드런 코스
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_user_courses_public(p_user_id UUID)
RETURNS TABLE (
  course_id UUID,
  name TEXT,
  country TEXT,
  distance_km NUMERIC,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND is_public = true) THEN RETURN; END IF;

  RETURN QUERY
  SELECT vc.id, vc.name, vc.country, vc.distance_km, ucp.started_at, ucp.completed_at
  FROM public.user_course_progress ucp
  JOIN public.virtual_courses vc ON vc.id = ucp.course_id
  WHERE ucp.user_id = p_user_id AND vc.is_active
  ORDER BY ucp.completed_at DESC NULLS FIRST, ucp.started_at DESC
  LIMIT 20;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_user_courses_public(UUID) TO authenticated, anon;
