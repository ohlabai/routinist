-- build 152: 다중 필터 조합 랭킹 RPC
-- 사용자: 1위 위에 6개 칩 (대한민국/서울/강남/남성/50대/2년차) 토글로 더 넓은 범위 보기.
-- 각 필터를 끄면 그 조건이 빠진 코호트 안에서 다시 RANK.

CREATE OR REPLACE FUNCTION public.find_my_combined_ranking(
  target_user_id uuid,
  time_axis text DEFAULT 'month',
  use_country boolean DEFAULT true,
  use_region_si boolean DEFAULT true,
  use_region_gu boolean DEFAULT true,
  use_gender boolean DEFAULT true,
  use_decade boolean DEFAULT true,
  use_starter boolean DEFAULT true
)
RETURNS TABLE (
  scope_label text,
  rank_position integer,
  total_in_scope integer,
  my_km numeric,
  km_to_top10 numeric,
  km_to_next numeric,
  target_rank integer,
  country_label text,
  region_si_label text,
  region_gu_label text,
  gender_label text,
  decade_label text,
  starter_label text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  u_country text;
  u_si text;
  u_gu text;
  u_gender text;
  u_birth int;
  u_decade int;
  u_signup_date date;
  d_start date;
  d_end date;
  starter_min date;
  starter_max date;
BEGIN
  SELECT country_code, region_si, region_gu, gender, birth_year, created_at::date
  INTO u_country, u_si, u_gu, u_gender, u_birth, u_signup_date
  FROM public.profiles WHERE id = target_user_id;

  u_decade := age_decade(u_birth);
  SELECT start_d, end_d INTO d_start, d_end FROM _hero_date_range(time_axis);

  IF u_signup_date IS NOT NULL THEN
    starter_min := u_signup_date - INTERVAL '60 days';
    starter_max := u_signup_date + INTERVAL '60 days';
  END IF;

  RETURN QUERY
  WITH period AS (
    SELECT a.user_id, SUM(a.distance_km) AS km
    FROM public.activities a
    JOIN public.profiles p ON p.id = a.user_id
    WHERE p.is_public = true
      AND a.visibility = 'public'
      AND a.activity_date BETWEEN d_start AND d_end
      AND (NOT use_country OR u_country IS NULL OR p.country_code = u_country)
      AND (NOT use_region_si OR u_si IS NULL OR p.region_si = u_si)
      AND (NOT use_region_gu OR u_gu IS NULL OR p.region_gu = u_gu)
      AND (NOT use_gender OR u_gender IS NULL OR p.gender = u_gender)
      AND (NOT use_decade OR u_decade IS NULL OR age_decade(p.birth_year) = u_decade)
      AND (NOT use_starter OR starter_min IS NULL OR p.created_at::date BETWEEN starter_min AND starter_max)
    GROUP BY a.user_id
  ),
  ranked AS (
    SELECT user_id, km, RANK() OVER (ORDER BY km DESC) AS r FROM period
  ),
  me AS (SELECT r AS my_r, km AS my_km_val FROM ranked WHERE user_id = target_user_id),
  tot AS (SELECT COUNT(*)::int AS n FROM period),
  top10_km AS (SELECT km AS k FROM period ORDER BY km DESC OFFSET 9 LIMIT 1),
  next_km AS (
    SELECT km AS k FROM period ORDER BY km DESC
    OFFSET GREATEST(COALESCE((SELECT my_r FROM me), 1) - 2, 0) LIMIT 1
  ),
  labels AS (
    SELECT
      array_to_string(ARRAY_REMOVE(ARRAY[
        CASE WHEN use_country AND u_country IS NOT NULL THEN
          CASE u_country WHEN 'KR' THEN '대한민국' WHEN 'US' THEN '미국' WHEN 'JP' THEN '일본' WHEN 'CN' THEN '중국' ELSE u_country END
        END,
        CASE WHEN use_region_si THEN u_si END,
        CASE WHEN use_region_gu THEN u_gu END,
        CASE WHEN use_gender AND u_gender IS NOT NULL THEN
          CASE u_gender WHEN 'male' THEN '남성' WHEN 'female' THEN '여성' ELSE u_gender END
        END,
        CASE WHEN use_decade AND u_decade IS NOT NULL THEN u_decade::text || '대' END,
        CASE WHEN use_starter AND starter_min IS NOT NULL THEN '동기 러너' END
      ], NULL), ' · ') AS combined
  )
  SELECT
    COALESCE(NULLIF((SELECT combined FROM labels), ''), '전체')::text,
    COALESCE((SELECT my_r FROM me), 0)::int,
    COALESCE((SELECT n FROM tot), 0),
    COALESCE((SELECT my_km_val FROM me), 0)::numeric,
    GREATEST(COALESCE((SELECT k FROM top10_km), 0) - COALESCE((SELECT my_km_val FROM me), 0), 0)::numeric,
    GREATEST(COALESCE((SELECT k FROM next_km), 0) - COALESCE((SELECT my_km_val FROM me), 0), 0)::numeric,
    GREATEST(COALESCE((SELECT my_r FROM me), 1) - 1, 1)::int,
    CASE u_country WHEN 'KR' THEN '대한민국' WHEN 'US' THEN '미국' WHEN 'JP' THEN '일본' WHEN 'CN' THEN '중국' ELSE u_country END,
    u_si,
    u_gu,
    CASE u_gender WHEN 'male' THEN '남성' WHEN 'female' THEN '여성' ELSE NULL END,
    CASE WHEN u_decade IS NOT NULL THEN u_decade::text || '대' END,
    CASE WHEN u_signup_date IS NOT NULL THEN
      CASE WHEN u_signup_date > CURRENT_DATE - INTERVAL '90 days' THEN '신규 러너'
           WHEN u_signup_date > CURRENT_DATE - INTERVAL '365 days' THEN '1년차'
           ELSE GREATEST(1, EXTRACT(YEAR FROM age(u_signup_date))::int)::text || '년차'
      END
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.find_my_combined_ranking(uuid, text, boolean, boolean, boolean, boolean, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_my_combined_ranking(uuid, text, boolean, boolean, boolean, boolean, boolean, boolean) TO anon, authenticated;
