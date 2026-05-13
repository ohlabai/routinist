-- 2026-05-14 build 131 — 시리즈 상세 데이터

CREATE OR REPLACE FUNCTION public.fetch_series_courses(p_slug TEXT)
RETURNS TABLE (
  course_id UUID,
  name TEXT,
  country TEXT,
  description TEXT,
  distance_km NUMERIC,
  preview_path JSONB,
  entry_fee_p INTEGER,
  series_name TEXT,
  series_emoji TEXT,
  series_description TEXT,
  my_started_at TIMESTAMPTZ,
  my_completed_at TIMESTAMPTZ,
  my_progress_km NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  RETURN QUERY
  SELECT
    vc.id,
    vc.name,
    vc.country,
    vc.description,
    vc.distance_km,
    vc.preview_path,
    vc.entry_fee_p,
    s.name,
    s.emoji,
    s.description,
    ucp.started_at,
    ucp.completed_at,
    COALESCE((
      SELECT SUM(a.distance_km)::NUMERIC(10,1) FROM public.activities a
       WHERE a.user_id = v_user_id AND a.created_at >= ucp.started_at
    ), 0)::NUMERIC
  FROM public.virtual_courses vc
  JOIN public.course_series s ON s.id = vc.series_id
  LEFT JOIN public.user_course_progress ucp ON ucp.course_id = vc.id AND ucp.user_id = v_user_id
  WHERE s.slug = p_slug AND vc.is_active
  ORDER BY vc.sort_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_series_courses(TEXT) TO authenticated, anon;
