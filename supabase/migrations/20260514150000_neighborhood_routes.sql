-- 2026-05-14 build 124 — 동네 러너 지도

------------------------------------------------------------
-- (A) fetch_neighborhood_routes — 같은 지역 사용자들의 최근 활동 폴리라인
-- public 활동 + is_public 프로필 + 본인 region_gu 일치만
-- 본인 1명당 가장 최근 활동 1개만 (혼잡 방지)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_neighborhood_routes(p_days INTEGER DEFAULT 7, p_limit INTEGER DEFAULT 30)
RETURNS TABLE (
  user_id UUID,
  display_name TEXT,
  avatar_url TEXT,
  activity_id UUID,
  distance_km NUMERIC,
  activity_date DATE,
  route_data JSONB
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_my_region TEXT;
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;
  SELECT region_gu INTO v_my_region FROM public.profiles WHERE id = v_user_id;
  IF v_my_region IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH ranked AS (
    SELECT
      a.user_id,
      a.id AS activity_id,
      a.distance_km,
      a.activity_date,
      a.route_data,
      ROW_NUMBER() OVER (PARTITION BY a.user_id ORDER BY a.activity_date DESC, a.created_at DESC) AS rn
    FROM public.activities a
    JOIN public.profiles p ON p.id = a.user_id
    WHERE p.region_gu = v_my_region
      AND a.user_id <> v_user_id
      AND p.is_public = true
      AND a.visibility = 'public'
      AND a.route_data IS NOT NULL
      AND a.created_at >= now() - (p_days || ' days')::INTERVAL
  )
  SELECT
    r.user_id,
    COALESCE(p.display_name, '익명'),
    p.avatar_url,
    r.activity_id,
    r.distance_km::NUMERIC,
    r.activity_date,
    r.route_data
  FROM ranked r
  LEFT JOIN public.profiles p ON p.id = r.user_id
  WHERE r.rn = 1
  ORDER BY r.distance_km DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_neighborhood_routes(INTEGER, INTEGER) TO authenticated;

------------------------------------------------------------
-- (B) fetch_user_recent_routes — 친구 프로필 풀화면용
-- 친구의 최근 N일 활동 + 폴리라인. is_public + visibility=public 만.
------------------------------------------------------------
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
    AND a.created_at >= now() - (p_days || ' days')::INTERVAL
  ORDER BY a.activity_date DESC, a.created_at DESC
  LIMIT 60;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_user_recent_routes(UUID, INTEGER) TO authenticated;
