-- build 170 #1: find_hero_rank 의 모든 코호트 케이스에서 v_rank IS NULL (= 사용자가 그 기간 미달리기)
-- 이면 v_total + 1 (코호트 마지막 자리) 로 fallback. "내 랭킹 조건" 빈 카드 대신 "꼴찌라도 표시" UX.
-- 코호트가 유효한 좁은 순서대로 fall-through 후 매칭 케이스에서 0km 끝자리 반환.

CREATE OR REPLACE FUNCTION public.find_hero_rank(target_user_id uuid, time_axis text DEFAULT 'month'::text)
 RETURNS TABLE(scope_label text, scope_type text, rank_position integer, total_in_scope integer, my_km numeric, km_to_next numeric, target_rank integer, time_axis_out text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
  u_country TEXT;
  u_si TEXT;
  u_gu TEXT;
  u_gender TEXT;
  u_decade INT;
  u_birth INT;
  d_start DATE;
  d_end DATE;
  v_rank INT;
  v_total INT;
  v_total_active INT;  -- 실제 달린 사람 수 (period CTE 의 row 수)
  v_cohort_total INT;  -- 코호트 전체 (달렸든 안 달렸든)
  v_my_km NUMERIC;
  v_next_km NUMERIC;
  v_last_km NUMERIC;
  v_target_rank INT;
  v_label TEXT;
  v_type TEXT;
BEGIN
  SELECT country_code, region_si, region_gu, gender, birth_year
  INTO u_country, u_si, u_gu, u_gender, u_birth
  FROM profiles WHERE id = target_user_id;

  u_decade := age_decade(u_birth);
  SELECT start_d, end_d INTO d_start, d_end FROM _hero_date_range(time_axis);

  v_rank := NULL;

  -- 케이스 1: 구+성별+연령대
  IF u_gu IS NOT NULL AND u_gender IS NOT NULL AND u_decade IS NOT NULL THEN
    SELECT COUNT(*)::INT INTO v_cohort_total
    FROM profiles p
    WHERE p.region_gu = u_gu AND p.gender = u_gender AND age_decade(p.birth_year) = u_decade
      AND p.is_public = true;

    WITH period AS (
      SELECT a.user_id, SUM(a.distance_km) AS km
      FROM activities a
      JOIN profiles p ON p.id = a.user_id
      WHERE p.region_gu = u_gu
        AND p.gender = u_gender
        AND age_decade(p.birth_year) = u_decade
        AND p.is_public = true
        AND a.visibility = 'public'
        AND a.activity_date BETWEEN d_start AND d_end
      GROUP BY a.user_id
    ),
    ranked AS (
      SELECT user_id, km, RANK() OVER (ORDER BY km DESC) AS r FROM period
    )
    SELECT r::INT, (SELECT COUNT(*)::INT FROM period), km
    INTO v_rank, v_total_active, v_my_km
    FROM ranked WHERE user_id = target_user_id LIMIT 1;

    -- 미달리기 fallback: 코호트에 본인이 속해있으니 끝자리(active + 1)
    IF v_rank IS NULL AND v_cohort_total >= 1 THEN
      v_rank := COALESCE(v_total_active, 0) + 1;
      v_my_km := 0;
    END IF;

    IF v_rank IS NOT NULL AND v_rank <= 10 THEN
      v_label := u_gu || ' ' || u_decade::text || '대 ' ||
                 CASE u_gender WHEN 'male' THEN '남성' WHEN 'female' THEN '여성' ELSE '' END;
      v_type := 'gu_gender_decade';
      WITH period AS (
        SELECT a.user_id, SUM(a.distance_km) AS km
        FROM activities a
        JOIN profiles p ON p.id = a.user_id
        WHERE p.region_gu = u_gu AND p.gender = u_gender AND age_decade(p.birth_year) = u_decade
          AND p.is_public = true AND a.visibility = 'public'
          AND a.activity_date BETWEEN d_start AND d_end
        GROUP BY a.user_id
      )
      SELECT (SELECT km FROM period ORDER BY km DESC OFFSET GREATEST(v_rank - 2, 0) LIMIT 1) - COALESCE(v_my_km, 0)
      INTO v_next_km FROM (SELECT 1) _;
      v_target_rank := GREATEST(v_rank - 1, 1);
      v_total := GREATEST(v_cohort_total, COALESCE(v_total_active, 0));
      RETURN QUERY SELECT v_label, v_type, v_rank, v_total, COALESCE(v_my_km, 0)::NUMERIC,
                          COALESCE(v_next_km, 0)::NUMERIC, v_target_rank, time_axis;
      RETURN;
    END IF;
  END IF;

  -- 케이스 2: 구+성별
  IF u_gu IS NOT NULL AND u_gender IS NOT NULL THEN
    SELECT COUNT(*)::INT INTO v_cohort_total
    FROM profiles p
    WHERE p.region_gu = u_gu AND p.gender = u_gender AND p.is_public = true;

    WITH period AS (
      SELECT a.user_id, SUM(a.distance_km) AS km
      FROM activities a
      JOIN profiles p ON p.id = a.user_id
      WHERE p.region_gu = u_gu AND p.gender = u_gender
        AND p.is_public = true AND a.visibility = 'public'
        AND a.activity_date BETWEEN d_start AND d_end
      GROUP BY a.user_id
    ),
    ranked AS (SELECT user_id, km, RANK() OVER (ORDER BY km DESC) AS r FROM period)
    SELECT r::INT, (SELECT COUNT(*)::INT FROM period), km
    INTO v_rank, v_total_active, v_my_km
    FROM ranked WHERE user_id = target_user_id LIMIT 1;

    IF v_rank IS NULL AND v_cohort_total >= 1 THEN
      v_rank := COALESCE(v_total_active, 0) + 1;
      v_my_km := 0;
    END IF;

    IF v_rank IS NOT NULL AND v_rank <= 10 THEN
      v_label := u_gu || ' ' ||
                 CASE u_gender WHEN 'male' THEN '남성' WHEN 'female' THEN '여성' ELSE '' END;
      v_type := 'gu_gender';
      WITH period AS (
        SELECT a.user_id, SUM(a.distance_km) AS km
        FROM activities a
        JOIN profiles p ON p.id = a.user_id
        WHERE p.region_gu = u_gu AND p.gender = u_gender
          AND p.is_public = true AND a.visibility = 'public'
          AND a.activity_date BETWEEN d_start AND d_end
        GROUP BY a.user_id
      )
      SELECT (SELECT km FROM period ORDER BY km DESC OFFSET GREATEST(v_rank - 2, 0) LIMIT 1) - COALESCE(v_my_km, 0)
      INTO v_next_km FROM (SELECT 1) _;
      v_target_rank := GREATEST(v_rank - 1, 1);
      v_total := GREATEST(v_cohort_total, COALESCE(v_total_active, 0));
      RETURN QUERY SELECT v_label, v_type, v_rank, v_total, COALESCE(v_my_km, 0)::NUMERIC,
                          COALESCE(v_next_km, 0)::NUMERIC, v_target_rank, time_axis;
      RETURN;
    END IF;
  END IF;

  -- 케이스 3: 구 (동네 전체)
  IF u_gu IS NOT NULL THEN
    SELECT COUNT(*)::INT INTO v_cohort_total
    FROM profiles p WHERE p.region_gu = u_gu AND p.is_public = true;

    WITH period AS (
      SELECT a.user_id, SUM(a.distance_km) AS km
      FROM activities a
      JOIN profiles p ON p.id = a.user_id
      WHERE p.region_gu = u_gu
        AND p.is_public = true AND a.visibility = 'public'
        AND a.activity_date BETWEEN d_start AND d_end
      GROUP BY a.user_id
    ),
    ranked AS (SELECT user_id, km, RANK() OVER (ORDER BY km DESC) AS r FROM period)
    SELECT r::INT, (SELECT COUNT(*)::INT FROM period), km
    INTO v_rank, v_total_active, v_my_km
    FROM ranked WHERE user_id = target_user_id LIMIT 1;

    IF v_rank IS NULL AND v_cohort_total >= 1 THEN
      v_rank := COALESCE(v_total_active, 0) + 1;
      v_my_km := 0;
    END IF;

    IF v_rank IS NOT NULL AND v_rank <= 10 THEN
      v_label := u_gu;
      v_type := 'gu';
      WITH period AS (
        SELECT a.user_id, SUM(a.distance_km) AS km
        FROM activities a
        JOIN profiles p ON p.id = a.user_id
        WHERE p.region_gu = u_gu
          AND p.is_public = true AND a.visibility = 'public'
          AND a.activity_date BETWEEN d_start AND d_end
        GROUP BY a.user_id
      )
      SELECT (SELECT km FROM period ORDER BY km DESC OFFSET GREATEST(v_rank - 2, 0) LIMIT 1) - COALESCE(v_my_km, 0)
      INTO v_next_km FROM (SELECT 1) _;
      v_target_rank := GREATEST(v_rank - 1, 1);
      v_total := GREATEST(v_cohort_total, COALESCE(v_total_active, 0));
      RETURN QUERY SELECT v_label, v_type, v_rank, v_total, COALESCE(v_my_km, 0)::NUMERIC,
                          COALESCE(v_next_km, 0)::NUMERIC, v_target_rank, time_axis;
      RETURN;
    END IF;
  END IF;

  -- 케이스 4: 시
  IF u_si IS NOT NULL THEN
    SELECT COUNT(*)::INT INTO v_cohort_total
    FROM profiles p WHERE p.region_si = u_si AND p.is_public = true;

    WITH period AS (
      SELECT a.user_id, SUM(a.distance_km) AS km
      FROM activities a
      JOIN profiles p ON p.id = a.user_id
      WHERE p.region_si = u_si
        AND p.is_public = true AND a.visibility = 'public'
        AND a.activity_date BETWEEN d_start AND d_end
      GROUP BY a.user_id
    ),
    ranked AS (SELECT user_id, km, RANK() OVER (ORDER BY km DESC) AS r FROM period)
    SELECT r::INT, (SELECT COUNT(*)::INT FROM period), km
    INTO v_rank, v_total_active, v_my_km
    FROM ranked WHERE user_id = target_user_id LIMIT 1;

    IF v_rank IS NULL AND v_cohort_total >= 1 THEN
      v_rank := COALESCE(v_total_active, 0) + 1;
      v_my_km := 0;
    END IF;

    IF v_rank IS NOT NULL AND v_rank <= 10 THEN
      v_label := u_si;
      v_type := 'si';
      WITH period AS (
        SELECT a.user_id, SUM(a.distance_km) AS km
        FROM activities a
        JOIN profiles p ON p.id = a.user_id
        WHERE p.region_si = u_si
          AND p.is_public = true AND a.visibility = 'public'
          AND a.activity_date BETWEEN d_start AND d_end
        GROUP BY a.user_id
      )
      SELECT (SELECT km FROM period ORDER BY km DESC OFFSET GREATEST(v_rank - 2, 0) LIMIT 1) - COALESCE(v_my_km, 0)
      INTO v_next_km FROM (SELECT 1) _;
      v_target_rank := GREATEST(v_rank - 1, 1);
      v_total := GREATEST(v_cohort_total, COALESCE(v_total_active, 0));
      RETURN QUERY SELECT v_label, v_type, v_rank, v_total, COALESCE(v_my_km, 0)::NUMERIC,
                          COALESCE(v_next_km, 0)::NUMERIC, v_target_rank, time_axis;
      RETURN;
    END IF;
  END IF;

  -- 케이스 5: 전국 성별+연령대
  IF u_gender IS NOT NULL AND u_decade IS NOT NULL THEN
    SELECT COUNT(*)::INT INTO v_cohort_total
    FROM profiles p WHERE p.gender = u_gender AND age_decade(p.birth_year) = u_decade AND p.is_public = true;

    WITH period AS (
      SELECT a.user_id, SUM(a.distance_km) AS km
      FROM activities a
      JOIN profiles p ON p.id = a.user_id
      WHERE p.gender = u_gender AND age_decade(p.birth_year) = u_decade
        AND p.is_public = true AND a.visibility = 'public'
        AND a.activity_date BETWEEN d_start AND d_end
      GROUP BY a.user_id
    ),
    ranked AS (SELECT user_id, km, RANK() OVER (ORDER BY km DESC) AS r FROM period)
    SELECT r::INT, (SELECT COUNT(*)::INT FROM period), km
    INTO v_rank, v_total_active, v_my_km
    FROM ranked WHERE user_id = target_user_id LIMIT 1;

    IF v_rank IS NULL AND v_cohort_total >= 1 THEN
      v_rank := COALESCE(v_total_active, 0) + 1;
      v_my_km := 0;
    END IF;

    IF v_rank IS NOT NULL AND v_rank <= 10 THEN
      v_label := '전국 ' || u_decade::text || '대 ' ||
                 CASE u_gender WHEN 'male' THEN '남성' WHEN 'female' THEN '여성' ELSE '' END;
      v_type := 'nation_gender_decade';
      WITH period AS (
        SELECT a.user_id, SUM(a.distance_km) AS km
        FROM activities a
        JOIN profiles p ON p.id = a.user_id
        WHERE p.gender = u_gender AND age_decade(p.birth_year) = u_decade
          AND p.is_public = true AND a.visibility = 'public'
          AND a.activity_date BETWEEN d_start AND d_end
        GROUP BY a.user_id
      )
      SELECT (SELECT km FROM period ORDER BY km DESC OFFSET GREATEST(v_rank - 2, 0) LIMIT 1) - COALESCE(v_my_km, 0)
      INTO v_next_km FROM (SELECT 1) _;
      v_target_rank := GREATEST(v_rank - 1, 1);
      v_total := GREATEST(v_cohort_total, COALESCE(v_total_active, 0));
      RETURN QUERY SELECT v_label, v_type, v_rank, v_total, COALESCE(v_my_km, 0)::NUMERIC,
                          COALESCE(v_next_km, 0)::NUMERIC, v_target_rank, time_axis;
      RETURN;
    END IF;
  END IF;

  -- 최종 fallback: 구 fallback (10위 초과여도 반환)
  IF u_gu IS NOT NULL THEN
    SELECT COUNT(*)::INT INTO v_cohort_total
    FROM profiles p WHERE p.region_gu = u_gu AND p.is_public = true;

    WITH period AS (
      SELECT a.user_id, SUM(a.distance_km) AS km
      FROM activities a
      JOIN profiles p ON p.id = a.user_id
      WHERE p.region_gu = u_gu
        AND p.is_public = true AND a.visibility = 'public'
        AND a.activity_date BETWEEN d_start AND d_end
      GROUP BY a.user_id
    ),
    ranked AS (SELECT user_id, km, RANK() OVER (ORDER BY km DESC) AS r FROM period)
    SELECT r::INT, (SELECT COUNT(*)::INT FROM period), km
    INTO v_rank, v_total_active, v_my_km
    FROM ranked WHERE user_id = target_user_id LIMIT 1;

    IF v_rank IS NULL AND v_cohort_total >= 1 THEN
      v_rank := COALESCE(v_total_active, 0) + 1;
      v_my_km := 0;
    END IF;

    IF v_rank IS NOT NULL THEN
      v_label := u_gu;
      v_type := 'gu_fallback';
      v_target_rank := GREATEST(v_rank - 1, 1);
      WITH period AS (
        SELECT a.user_id, SUM(a.distance_km) AS km
        FROM activities a
        JOIN profiles p ON p.id = a.user_id
        WHERE p.region_gu = u_gu
          AND p.is_public = true AND a.visibility = 'public'
          AND a.activity_date BETWEEN d_start AND d_end
        GROUP BY a.user_id
      )
      SELECT (SELECT km FROM period ORDER BY km DESC OFFSET GREATEST(v_rank - 2, 0) LIMIT 1) - COALESCE(v_my_km, 0)
      INTO v_next_km FROM (SELECT 1) _;
      v_total := GREATEST(v_cohort_total, COALESCE(v_total_active, 0));
      RETURN QUERY SELECT v_label, v_type, v_rank, v_total, COALESCE(v_my_km, 0)::NUMERIC,
                          COALESCE(v_next_km, 0)::NUMERIC, v_target_rank, time_axis;
      RETURN;
    END IF;
  END IF;

  RETURN;
END;
$function$;
