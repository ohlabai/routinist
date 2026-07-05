-- build 293: 콜드스타트·글로벌 안착 — nearby 국가 스코프.
--
-- fetch_nearby_runners 에 p_scope='country' 추가: profiles.country_code 매칭.
-- 해외 신규 유저는 한국 행정구역(동/구/시) 매칭이 전부 빈 결과 → '같은 나라' 스코프로
-- country_code 만 채워도 러너를 찾을 수 있게 함. 'national' 은 기존대로 무필터(전 세계).
--
-- prod 정의 기반 CREATE OR REPLACE — 변경분은 v_country DECLARE/SELECT + country 분기 한 줄뿐.
-- 시그니처(인자/반환) 동일 → 안전한 in-place replace.

CREATE OR REPLACE FUNCTION public.fetch_nearby_runners(p_scope text DEFAULT 'gu'::text, p_limit integer DEFAULT 50)
 RETURNS TABLE(user_id uuid, display_name text, avatar_url text, region_si text, region_gu text, region_dong text, bio text, birth_year integer, gender text, show_gender boolean, total_runs integer, total_distance_km numeric, runs_30d integer, km_30d numeric, last_active timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_user_id UUID := auth.uid();
  v_si TEXT;
  v_gu TEXT;
  v_dong TEXT;
  v_country TEXT;
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;
  SELECT p.region_si, p.region_gu, p.region_dong, p.country_code
    INTO v_si, v_gu, v_dong, v_country
  FROM public.profiles p WHERE p.id = v_user_id;

  RETURN QUERY
  SELECT
    p.id,
    COALESCE(p.display_name, '익명'),
    p.avatar_url,
    p.region_si,
    p.region_gu,
    p.region_dong,
    p.bio,
    p.birth_year,
    p.gender,
    p.show_gender,
    p.total_runs,
    p.total_distance_km,
    COALESCE((SELECT COUNT(*)::INTEGER FROM public.activities a WHERE a.user_id = p.id AND a.created_at >= now() - INTERVAL '30 days'), 0),
    COALESCE((SELECT SUM(a.distance_km)::NUMERIC(10,1) FROM public.activities a WHERE a.user_id = p.id AND a.created_at >= now() - INTERVAL '30 days'), 0)::NUMERIC,
    (SELECT MAX(a.created_at) FROM public.activities a WHERE a.user_id = p.id)
  FROM public.profiles p
  WHERE p.id <> v_user_id
    AND p.is_public = true
    AND (
      (p_scope = 'dong'     AND v_dong IS NOT NULL    AND p.region_dong = v_dong AND p.region_gu = v_gu) OR
      (p_scope = 'gu'       AND v_gu IS NOT NULL      AND p.region_gu = v_gu) OR
      (p_scope = 'si'       AND v_si IS NOT NULL      AND p.region_si = v_si) OR
      (p_scope = 'country'  AND v_country IS NOT NULL AND p.country_code = v_country) OR
      (p_scope = 'national' AND true)
    )
  ORDER BY
    -- 최근 30일 km 많이 달린 순
    COALESCE((SELECT SUM(a.distance_km) FROM public.activities a WHERE a.user_id = p.id AND a.created_at >= now() - INTERVAL '30 days'), 0) DESC,
    p.total_distance_km DESC NULLS LAST
  LIMIT p_limit;
END;
$function$;
