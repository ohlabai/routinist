-- 2026-05-14 build 114 — 어드민 분석 대시보드 RPC 묶음
-- Amplitude/Mixpanel 식 핵심 KPI. 모든 RPC 는 is_shop_admin() 만 통과.

------------------------------------------------------------
-- (A) 회원 + 활성도 + 콘텐츠 + 메달/마일리지 overview
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_analytics_overview()
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v JSON;
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;

  SELECT json_build_object(
    'users', json_build_object(
      'total', (SELECT COUNT(*) FROM public.profiles),
      'new_today', (SELECT COUNT(*) FROM public.profiles WHERE created_at >= date_trunc('day', now())),
      'new_7d', (SELECT COUNT(*) FROM public.profiles WHERE created_at >= now() - INTERVAL '7 days'),
      'new_30d', (SELECT COUNT(*) FROM public.profiles WHERE created_at >= now() - INTERVAL '30 days')
    ),
    'active', json_build_object(
      -- DAU: 오늘 활동 1건 이상 + 오늘 사진/명언/제안 등 콘텐츠 액션
      'dau', (
        SELECT COUNT(DISTINCT user_id) FROM (
          SELECT user_id FROM public.activities WHERE created_at >= date_trunc('day', now())
          UNION
          SELECT user_id FROM public.activity_photos WHERE created_at >= date_trunc('day', now())
          UNION
          SELECT user_id FROM public.quotes WHERE user_id IS NOT NULL AND created_at >= date_trunc('day', now())
          UNION
          SELECT user_id FROM public.feedback_posts WHERE created_at >= date_trunc('day', now())
        ) t
      ),
      'wau', (
        SELECT COUNT(DISTINCT user_id) FROM (
          SELECT user_id FROM public.activities WHERE created_at >= now() - INTERVAL '7 days'
          UNION
          SELECT user_id FROM public.activity_photos WHERE created_at >= now() - INTERVAL '7 days'
        ) t
      ),
      'mau', (
        SELECT COUNT(DISTINCT user_id) FROM (
          SELECT user_id FROM public.activities WHERE created_at >= now() - INTERVAL '30 days'
          UNION
          SELECT user_id FROM public.activity_photos WHERE created_at >= now() - INTERVAL '30 days'
        ) t
      ),
      -- 14일 이상 미접속 사용자 (이탈 추정)
      'churned_14d', (
        SELECT COUNT(*) FROM public.profiles p
        WHERE NOT EXISTS (
          SELECT 1 FROM public.activities a
          WHERE a.user_id = p.id AND a.created_at >= now() - INTERVAL '14 days'
        ) AND p.created_at < now() - INTERVAL '14 days'
      )
    ),
    'activity', json_build_object(
      'runs_today', (SELECT COUNT(*) FROM public.activities WHERE created_at >= date_trunc('day', now())),
      'km_today', (SELECT COALESCE(SUM(distance_km), 0)::NUMERIC(10,1) FROM public.activities WHERE created_at >= date_trunc('day', now())),
      'runs_7d', (SELECT COUNT(*) FROM public.activities WHERE created_at >= now() - INTERVAL '7 days'),
      'km_7d', (SELECT COALESCE(SUM(distance_km), 0)::NUMERIC(10,1) FROM public.activities WHERE created_at >= now() - INTERVAL '7 days'),
      'runs_30d', (SELECT COUNT(*) FROM public.activities WHERE created_at >= now() - INTERVAL '30 days'),
      'km_30d', (SELECT COALESCE(SUM(distance_km), 0)::NUMERIC(10,1) FROM public.activities WHERE created_at >= now() - INTERVAL '30 days')
    ),
    'content', json_build_object(
      'photos_total', (SELECT COUNT(*) FROM public.activity_photos),
      'photos_7d', (SELECT COUNT(*) FROM public.activity_photos WHERE created_at >= now() - INTERVAL '7 days'),
      'user_quotes_total', (SELECT COUNT(*) FROM public.quotes WHERE user_id IS NOT NULL),
      'user_quotes_7d', (SELECT COUNT(*) FROM public.quotes WHERE user_id IS NOT NULL AND created_at >= now() - INTERVAL '7 days'),
      'feedback_total', (SELECT COUNT(*) FROM public.feedback_posts),
      'feedback_open', (SELECT COUNT(*) FROM public.feedback_posts WHERE status IN ('open','reviewing')),
      'contests_total', (SELECT COUNT(*) FROM public.daily_contests),
      'world_starts', (SELECT COUNT(*) FROM public.user_course_progress),
      'world_completes', (SELECT COUNT(*) FROM public.user_course_progress WHERE completed_at IS NOT NULL),
      'medals_requested', (SELECT COUNT(*) FROM public.course_medals WHERE request_status IN ('requested','paid','shipped','delivered'))
    ),
    'engagement', json_build_object(
      'photo_likes', (SELECT COUNT(*) FROM public.photo_likes),
      'photo_comments', (SELECT COUNT(*) FROM public.photo_comments)
    )
  ) INTO v;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_analytics_overview() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_analytics_overview() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_analytics_overview() TO authenticated;

------------------------------------------------------------
-- (B) 일별 가입 시계열 (30일)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_analytics_signups_daily(p_days INTEGER DEFAULT 30)
RETURNS TABLE (day DATE, count INTEGER)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;
  RETURN QUERY
  WITH d AS (
    SELECT generate_series(date_trunc('day', now() - (p_days || ' days')::INTERVAL),
                           date_trunc('day', now()),
                           '1 day')::DATE AS day
  )
  SELECT d.day, COUNT(p.id)::INTEGER
  FROM d
  LEFT JOIN public.profiles p ON date_trunc('day', p.created_at)::DATE = d.day
  GROUP BY d.day
  ORDER BY d.day;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_analytics_signups_daily(INTEGER) TO authenticated;

------------------------------------------------------------
-- (C) 일별 활동 시계열 (30일) — DAU + 활동 수 + km
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_analytics_activity_daily(p_days INTEGER DEFAULT 30)
RETURNS TABLE (day DATE, dau INTEGER, runs INTEGER, km NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;
  RETURN QUERY
  WITH d AS (
    SELECT generate_series(date_trunc('day', now() - (p_days || ' days')::INTERVAL),
                           date_trunc('day', now()),
                           '1 day')::DATE AS day
  )
  SELECT
    d.day,
    COUNT(DISTINCT a.user_id)::INTEGER,
    COUNT(a.id)::INTEGER,
    COALESCE(SUM(a.distance_km), 0)::NUMERIC(10,1)
  FROM d
  LEFT JOIN public.activities a ON date_trunc('day', a.created_at)::DATE = d.day
  GROUP BY d.day
  ORDER BY d.day;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_analytics_activity_daily(INTEGER) TO authenticated;

------------------------------------------------------------
-- (D) 리텐션 funnel — D0 가입 → D1/D7/D30 활동
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_analytics_retention()
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v JSON;
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;
  WITH base AS (
    -- 가입 후 ≥30일 지난 사용자만 cohort 비교 의미 있음
    SELECT id AS user_id, created_at FROM public.profiles WHERE created_at <= now() - INTERVAL '30 days'
  ),
  d1 AS (
    SELECT b.user_id FROM base b
    WHERE EXISTS (SELECT 1 FROM public.activities a WHERE a.user_id = b.user_id AND a.created_at BETWEEN b.created_at AND b.created_at + INTERVAL '1 day')
  ),
  d7 AS (
    SELECT b.user_id FROM base b
    WHERE EXISTS (SELECT 1 FROM public.activities a WHERE a.user_id = b.user_id AND a.created_at BETWEEN b.created_at AND b.created_at + INTERVAL '7 days')
  ),
  d30 AS (
    SELECT b.user_id FROM base b
    WHERE EXISTS (SELECT 1 FROM public.activities a WHERE a.user_id = b.user_id AND a.created_at BETWEEN b.created_at AND b.created_at + INTERVAL '30 days')
  )
  SELECT json_build_object(
    'cohort_size', (SELECT COUNT(*) FROM base),
    'd1', (SELECT COUNT(*) FROM d1),
    'd7', (SELECT COUNT(*) FROM d7),
    'd30', (SELECT COUNT(*) FROM d30)
  ) INTO v;
  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_analytics_retention() TO authenticated;

------------------------------------------------------------
-- (E) 시간대별 활동 히트맵 (0~23시) — 사용자가 가장 많이 달리는 시간
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_analytics_hour_heatmap()
RETURNS TABLE (hour INTEGER, runs INTEGER)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;
  RETURN QUERY
  WITH h AS (SELECT generate_series(0, 23) AS hour)
  SELECT
    h.hour::INTEGER,
    COUNT(a.id)::INTEGER
  FROM h
  LEFT JOIN public.activities a
    ON EXTRACT(HOUR FROM (a.created_at AT TIME ZONE 'Asia/Seoul'))::INTEGER = h.hour
    AND a.created_at >= now() - INTERVAL '30 days'
  GROUP BY h.hour
  ORDER BY h.hour;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_analytics_hour_heatmap() TO authenticated;

------------------------------------------------------------
-- (F) 가입 후 첫 활동까지 시간 — 첫 활동 비율 (활성화율)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_analytics_activation()
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v JSON;
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;
  WITH base AS (
    SELECT p.id AS user_id, p.created_at,
           (SELECT MIN(a.created_at) FROM public.activities a WHERE a.user_id = p.id) AS first_activity
    FROM public.profiles p
  )
  SELECT json_build_object(
    'total', (SELECT COUNT(*) FROM base),
    'activated', (SELECT COUNT(*) FROM base WHERE first_activity IS NOT NULL),
    'never_ran', (SELECT COUNT(*) FROM base WHERE first_activity IS NULL),
    'activated_within_1d', (SELECT COUNT(*) FROM base WHERE first_activity IS NOT NULL AND first_activity - created_at < INTERVAL '1 day'),
    'activated_within_7d', (SELECT COUNT(*) FROM base WHERE first_activity IS NOT NULL AND first_activity - created_at < INTERVAL '7 days')
  ) INTO v;
  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_analytics_activation() TO authenticated;

------------------------------------------------------------
-- (G) 인기 콘텐츠 top — 사진 + 명언
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_analytics_top_content(p_limit INTEGER DEFAULT 5)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v JSON;
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;
  SELECT json_build_object(
    'photos', (
      SELECT json_agg(t) FROM (
        SELECT ph.id, ph.photo_url, p.display_name, ph.like_count, ph.created_at
        FROM public.activity_photos ph
        JOIN public.profiles p ON p.id = ph.user_id
        WHERE ph.share_in_gallery = true
        ORDER BY ph.like_count DESC NULLS LAST, ph.created_at DESC
        LIMIT p_limit
      ) t
    ),
    'quotes', (
      SELECT json_agg(t) FROM (
        SELECT q.id, q.text, q.author, q.like_count, q.created_at
        FROM public.quotes q
        WHERE q.user_id IS NOT NULL AND q.status = 'approved'
        ORDER BY q.like_count DESC NULLS LAST, q.created_at DESC
        LIMIT p_limit
      ) t
    ),
    'top_runners_30d', (
      SELECT json_agg(t) FROM (
        SELECT p.display_name, p.avatar_url,
               COUNT(a.id) AS runs,
               SUM(a.distance_km)::NUMERIC(10,1) AS total_km
        FROM public.activities a
        JOIN public.profiles p ON p.id = a.user_id
        WHERE a.created_at >= now() - INTERVAL '30 days'
        GROUP BY p.id, p.display_name, p.avatar_url
        ORDER BY total_km DESC
        LIMIT p_limit
      ) t
    )
  ) INTO v;
  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_analytics_top_content(INTEGER) TO authenticated;
