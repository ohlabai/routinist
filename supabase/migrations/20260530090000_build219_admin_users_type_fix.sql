-- build 219 #5: admin_list_users_v2 returns "structure of query does not match function result type"
-- 원인: profiles.total_duration_seconds 가 BIGINT 이지만 RPC declared INTEGER → 0 rows + error toast.
-- 사용자 신고: /admin/users 페이지가 43명 모두 안 보이고 0명 표시.
-- 수정: total_duration_sec 을 BIGINT 로 선언. 기존 RPC 는 DROP 후 재생성 (RETURN TABLE 변경은 OR REPLACE 불가).

DROP FUNCTION IF EXISTS public.admin_list_users_v2(
  TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER,
  BOOLEAN, BOOLEAN, BOOLEAN, TEXT, INTEGER, INTEGER
);

CREATE OR REPLACE FUNCTION public.admin_list_users_v2(
  p_search       TEXT DEFAULT NULL,
  p_region_si    TEXT DEFAULT NULL,
  p_region_gu    TEXT DEFAULT NULL,
  p_gender       TEXT DEFAULT NULL,
  p_age_min      INTEGER DEFAULT NULL,
  p_age_max      INTEGER DEFAULT NULL,
  p_signup_days  INTEGER DEFAULT NULL,
  p_idle_days    INTEGER DEFAULT NULL,
  p_has_club     BOOLEAN DEFAULT NULL,
  p_has_push     BOOLEAN DEFAULT NULL,
  p_is_public    BOOLEAN DEFAULT NULL,
  p_sort         TEXT DEFAULT 'created_desc',
  p_limit        INTEGER DEFAULT 50,
  p_offset       INTEGER DEFAULT 0
)
RETURNS TABLE (
  user_id              UUID,
  email                TEXT,
  display_name         TEXT,
  avatar_url           TEXT,
  region_si            TEXT,
  region_gu            TEXT,
  region_dong          TEXT,
  country_code         TEXT,
  gender               TEXT,
  birth_year           INTEGER,
  age                  INTEGER,
  running_since        DATE,
  bio                  TEXT,
  is_public            BOOLEAN,
  total_runs           INTEGER,
  total_distance_km    NUMERIC,
  total_duration_sec   BIGINT,
  this_month_km        NUMERIC,
  this_month_runs      INTEGER,
  last_activity_date   DATE,
  idle_days            INTEGER,
  mileage_balance      INTEGER,
  total_orders         INTEGER,
  total_paid_krw       BIGINT,
  club_count           INTEGER,
  follower_count       INTEGER,
  following_count      INTEGER,
  report_count_against INTEGER,
  signup_provider      TEXT,
  push_token_count     INTEGER,
  coach_opt_in         BOOLEAN,
  weight_kg            NUMERIC,
  max_hr               INTEGER,
  email_confirmed_at   TIMESTAMPTZ,
  created_at           TIMESTAMPTZ,
  total_count          BIGINT
) AS $$
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      p.id AS user_id,
      u.email::TEXT AS email,
      p.display_name,
      p.avatar_url,
      p.region_si, p.region_gu, p.region_dong,
      p.country_code, p.gender, p.birth_year,
      CASE WHEN p.birth_year IS NOT NULL THEN (EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER - p.birth_year) ELSE NULL END AS age,
      p.running_since, p.bio, p.is_public,
      p.total_runs, p.total_distance_km,
      p.total_duration_seconds::BIGINT AS total_duration_sec,
      COALESCE(p.this_month_distance_km, 0) AS this_month_km,
      COALESCE(p.this_month_runs, 0) AS this_month_runs,
      (SELECT MAX(a.activity_date) FROM public.activities a WHERE a.user_id = p.id) AS last_activity_date,
      p.mileage_balance,
      p.coach_opt_in,
      p.weight_kg, p.max_hr,
      u.email_confirmed_at,
      p.created_at,
      COALESCE(u.raw_app_meta_data->>'provider', 'email')::TEXT AS signup_provider,
      (SELECT COUNT(*)::INTEGER FROM public.push_device_tokens t WHERE t.user_id = p.id) AS push_token_count,
      (SELECT COUNT(*)::INTEGER FROM public.club_members cm WHERE cm.user_id = p.id) AS club_count,
      (SELECT COUNT(*)::INTEGER FROM public.follows f WHERE f.following_id = p.id) AS follower_count,
      (SELECT COUNT(*)::INTEGER FROM public.follows f WHERE f.follower_id = p.id) AS following_count,
      COALESCE((SELECT COUNT(*)::INTEGER FROM public.orders o WHERE o.user_id = p.id AND o.status = 'paid'), 0) AS total_orders,
      COALESCE((SELECT SUM(o.total_krw)::BIGINT FROM public.orders o WHERE o.user_id = p.id AND o.status = 'paid'), 0) AS total_paid_krw,
      COALESCE((
        SELECT COUNT(*)::INTEGER FROM public.content_reports cr
         WHERE (cr.target_type IN ('user','profile') AND cr.target_id::UUID = p.id)
            OR (cr.target_type = 'activity_photo'
                AND EXISTS (SELECT 1 FROM public.activity_photos ap WHERE ap.id::TEXT = cr.target_id AND ap.user_id = p.id))
      ), 0) AS report_count_against
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
  ),
  filtered AS (
    SELECT * FROM base b
    WHERE (p_search IS NULL OR length(trim(p_search)) = 0
            OR b.display_name ILIKE '%' || p_search || '%'
            OR b.email ILIKE '%' || p_search || '%')
      AND (p_region_si IS NULL OR b.region_si = p_region_si)
      AND (p_region_gu IS NULL OR b.region_gu = p_region_gu)
      AND (p_gender IS NULL OR b.gender = p_gender)
      AND (p_age_min IS NULL OR b.age >= p_age_min)
      AND (p_age_max IS NULL OR b.age <= p_age_max)
      AND (p_signup_days IS NULL OR b.created_at >= NOW() - (p_signup_days || ' days')::INTERVAL)
      AND (p_idle_days IS NULL
            OR (b.last_activity_date IS NULL AND b.created_at <= NOW() - (p_idle_days || ' days')::INTERVAL)
            OR b.last_activity_date <= CURRENT_DATE - p_idle_days)
      AND (p_has_club IS NULL OR (p_has_club = true AND b.club_count > 0) OR (p_has_club = false AND b.club_count = 0))
      AND (p_has_push IS NULL OR (p_has_push = true AND b.push_token_count > 0) OR (p_has_push = false AND b.push_token_count = 0))
      AND (p_is_public IS NULL OR b.is_public = p_is_public)
  )
  SELECT
    f.user_id, f.email, f.display_name, f.avatar_url,
    f.region_si, f.region_gu, f.region_dong, f.country_code,
    f.gender, f.birth_year, f.age, f.running_since, f.bio, f.is_public,
    f.total_runs, f.total_distance_km, f.total_duration_sec,
    f.this_month_km, f.this_month_runs, f.last_activity_date,
    CASE WHEN f.last_activity_date IS NULL THEN NULL
         ELSE (CURRENT_DATE - f.last_activity_date) END AS idle_days,
    f.mileage_balance, f.total_orders, f.total_paid_krw,
    f.club_count, f.follower_count, f.following_count, f.report_count_against,
    f.signup_provider, f.push_token_count,
    f.coach_opt_in, f.weight_kg, f.max_hr,
    f.email_confirmed_at, f.created_at,
    COUNT(*) OVER ()::BIGINT AS total_count
  FROM filtered f
  ORDER BY
    CASE WHEN p_sort = 'created_asc'      THEN f.created_at                 END ASC NULLS LAST,
    CASE WHEN p_sort = 'km_asc'           THEN f.total_distance_km          END ASC NULLS LAST,
    CASE WHEN p_sort = 'km_desc'          THEN f.total_distance_km          END DESC NULLS LAST,
    CASE WHEN p_sort = 'runs_desc'        THEN f.total_runs                 END DESC NULLS LAST,
    CASE WHEN p_sort = 'last_active_desc' THEN f.last_activity_date         END DESC NULLS LAST,
    CASE WHEN p_sort = 'mileage_desc'     THEN f.mileage_balance            END DESC NULLS LAST,
    CASE WHEN p_sort = 'created_desc' OR p_sort IS NULL THEN f.created_at   END DESC NULLS LAST,
    f.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.admin_list_users_v2 FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users_v2 TO authenticated;
