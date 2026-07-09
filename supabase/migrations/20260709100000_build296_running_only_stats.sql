-- build 296: 러닝 전용 집계 서버 통일 + 프로필 캐시 백필
--
-- 배경 (hans 신고): 홈 상단 "이달 km" 가 프로필 캐시 (this_month_*) 기준이라 걷기 포함
-- 26.15km 표시 vs 클라 정합 계산 (러닝만) 18.63km — build 291 에서 클라 집계만 러닝
-- 전용으로 바꾸고 서버 트리거를 빠뜨린 누락. 통산 (total_*) 과 랭킹 RPC 도 동일 계열.
-- 원칙: 거리·횟수·랭킹 = 러닝만 (walking 제외, NULL=러닝). 달력/기록 목록은 전 활동 표시.

-- 1. 이달 캐시 재계산 — 러닝만
CREATE OR REPLACE FUNCTION public._recompute_profile_this_month(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_km NUMERIC;
  v_runs INTEGER;
  v_today_kst DATE;
BEGIN
  v_today_kst := (now() AT TIME ZONE 'Asia/Seoul')::date;

  SELECT COALESCE(SUM(distance_km), 0)::numeric, COUNT(*)::int
  INTO v_km, v_runs
  FROM public.activities
  WHERE user_id = p_user_id
    AND activity_date >= DATE_TRUNC('month', v_today_kst)::date
    AND activity_date <= v_today_kst
    AND (activity_type IS NULL OR activity_type <> 'walking');

  UPDATE public.profiles
  SET this_month_distance_km = v_km,
      this_month_runs = v_runs,
      this_month_updated_at = now()
  WHERE id = p_user_id;
END;
$function$;

-- 2. 통산 증분 트리거 — walking 기여도 0 으로 (UPDATE 는 전이 처리: 러닝↔걷기 재태깅 대응)
CREATE OR REPLACE FUNCTION public.update_profile_stats()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old_counts BOOLEAN := (TG_OP <> 'INSERT') AND (OLD.activity_type IS NULL OR OLD.activity_type <> 'walking');
  v_new_counts BOOLEAN := (TG_OP <> 'DELETE') AND (NEW.activity_type IS NULL OR NEW.activity_type <> 'walking');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_new_counts THEN
      UPDATE profiles SET
        total_distance_km = total_distance_km + NEW.distance_km,
        total_runs = total_runs + 1,
        total_duration_seconds = total_duration_seconds + COALESCE(NEW.duration_seconds, 0),
        updated_at = NOW()
      WHERE id = NEW.user_id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF v_old_counts THEN
      UPDATE profiles SET
        total_distance_km = total_distance_km - OLD.distance_km,
        total_runs = total_runs - 1,
        total_duration_seconds = total_duration_seconds - COALESCE(OLD.duration_seconds, 0),
        updated_at = NOW()
      WHERE id = OLD.user_id;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE profiles SET
      total_distance_km = total_distance_km
        + (CASE WHEN v_new_counts THEN NEW.distance_km ELSE 0 END)
        - (CASE WHEN v_old_counts THEN OLD.distance_km ELSE 0 END),
      total_runs = total_runs
        + (CASE WHEN v_new_counts THEN 1 ELSE 0 END)
        - (CASE WHEN v_old_counts THEN 1 ELSE 0 END),
      total_duration_seconds = total_duration_seconds
        + (CASE WHEN v_new_counts THEN COALESCE(NEW.duration_seconds, 0) ELSE 0 END)
        - (CASE WHEN v_old_counts THEN COALESCE(OLD.duration_seconds, 0) ELSE 0 END),
      updated_at = NOW()
    WHERE id = NEW.user_id;
  END IF;
  RETURN NULL;
END;
$function$;

-- 3. 랭킹 RPC — 러닝만 (prod 정의 기반, WHERE 에 한 줄 추가)
CREATE OR REPLACE FUNCTION public.find_my_combined_ranking(target_user_id uuid, time_axis text DEFAULT 'month'::text, use_country boolean DEFAULT true, use_region_si boolean DEFAULT true, use_region_gu boolean DEFAULT true, use_gender boolean DEFAULT true, use_decade boolean DEFAULT true, use_starter boolean DEFAULT true)
 RETURNS TABLE(scope_label text, rank_position integer, total_in_scope integer, my_km numeric, km_to_top10 numeric, km_to_next numeric, target_rank integer, country_label text, region_si_label text, region_gu_label text, gender_label text, decade_label text, starter_label text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      AND (a.activity_type IS NULL OR a.activity_type <> 'walking')  -- build 296: 랭킹은 러닝만
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
$function$
;


-- 4. 전 유저 백필 — 통산 + 이달 캐시를 러닝 전용으로 재계산
UPDATE public.profiles p SET
  total_distance_km = COALESCE(s.km, 0),
  total_runs = COALESCE(s.runs, 0),
  total_duration_seconds = COALESCE(s.dur, 0),
  updated_at = NOW()
FROM (
  SELECT pr.id,
         SUM(a.distance_km) FILTER (WHERE a.activity_type IS NULL OR a.activity_type <> 'walking') AS km,
         COUNT(a.id) FILTER (WHERE a.activity_type IS NULL OR a.activity_type <> 'walking') AS runs,
         SUM(COALESCE(a.duration_seconds, 0)) FILTER (WHERE a.activity_type IS NULL OR a.activity_type <> 'walking') AS dur
  FROM public.profiles pr
  LEFT JOIN public.activities a ON a.user_id = pr.id
  GROUP BY pr.id
) s
WHERE s.id = p.id;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.profiles LOOP
    PERFORM public._recompute_profile_this_month(r.id);
  END LOOP;
END $$;
