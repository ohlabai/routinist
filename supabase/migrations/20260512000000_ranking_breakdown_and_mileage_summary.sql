-- 2026-05-12 (build 100): 랭킹 다축 + 마일리지 카테고리 요약 RPC
-- 1) find_my_rankings_breakdown — /ranking 내 랭킹 탭 다축 시각화 (전체/지역/나이대/시작기간)
-- 2) fetch_user_mileage_summary — 마일리지 랭킹에서 상위 클릭 시 카테고리별 합계만 노출 (개인 트랜잭션 X)

BEGIN;

-- ============================================================================
-- 1. 다축 랭킹 — 전국/지역/나이대/시작기간 동시 반환
-- ============================================================================
CREATE OR REPLACE FUNCTION public.find_my_rankings_breakdown(
  target_user_id UUID,
  time_axis TEXT DEFAULT 'month'
)
RETURNS TABLE (
  scope_type TEXT,
  scope_label TEXT,
  rank_position INT,
  total_in_scope INT,
  my_km NUMERIC,
  km_to_top10 NUMERIC,
  km_to_next NUMERIC,
  target_rank INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  u_country TEXT;
  u_si TEXT;
  u_gu TEXT;
  u_gender TEXT;
  u_birth INT;
  u_decade INT;
  u_signup_date DATE;
  d_start DATE;
  d_end DATE;
  starter_label TEXT;
  starter_min_date DATE;
  starter_max_date DATE;
BEGIN
  SELECT country_code, region_si, region_gu, gender, birth_year, created_at::DATE
  INTO u_country, u_si, u_gu, u_gender, u_birth, u_signup_date
  FROM public.profiles WHERE id = target_user_id;

  u_decade := age_decade(u_birth);
  SELECT start_d, end_d INTO d_start, d_end FROM _hero_date_range(time_axis);

  -- 시작 기간 코호트: 가입일 기준 ±60일 범위의 러너끼리
  -- (= "비슷한 시기에 시작한 러너들과 비교" — 신규/베테랑 mix 방지)
  IF u_signup_date IS NOT NULL THEN
    starter_min_date := u_signup_date - INTERVAL '60 days';
    starter_max_date := u_signup_date + INTERVAL '60 days';
    IF u_signup_date > CURRENT_DATE - INTERVAL '90 days' THEN
      starter_label := '함께 시작한 러너 (최근 가입)';
    ELSIF u_signup_date > CURRENT_DATE - INTERVAL '365 days' THEN
      starter_label := '함께 시작한 러너 (1년 이내)';
    ELSE
      starter_label := '함께 시작한 러너';
    END IF;
  END IF;

  -- 1) 전국 전체
  RETURN QUERY
  WITH period AS (
    SELECT a.user_id, SUM(a.distance_km) AS km
    FROM public.activities a
    JOIN public.profiles p ON p.id = a.user_id
    WHERE p.is_public = true
      AND a.visibility = 'public'
      AND a.activity_date BETWEEN d_start AND d_end
    GROUP BY a.user_id
  ),
  ranked AS (
    SELECT user_id, km, RANK() OVER (ORDER BY km DESC) AS r FROM period
  ),
  me AS (SELECT r AS my_r, km AS my_km_val FROM ranked WHERE user_id = target_user_id),
  tot AS (SELECT COUNT(*)::INT AS n FROM period),
  top10_km AS (SELECT km AS k FROM period ORDER BY km DESC OFFSET 9 LIMIT 1),
  next_km AS (
    SELECT km AS k FROM period ORDER BY km DESC
    OFFSET GREATEST((SELECT my_r FROM me) - 2, 0) LIMIT 1
  )
  SELECT 'nation'::TEXT,
         '전국 전체'::TEXT,
         (SELECT my_r FROM me)::INT,
         (SELECT n FROM tot),
         COALESCE((SELECT my_km_val FROM me), 0)::NUMERIC,
         GREATEST(COALESCE((SELECT k FROM top10_km), 0) - COALESCE((SELECT my_km_val FROM me), 0), 0)::NUMERIC,
         GREATEST(COALESCE((SELECT k FROM next_km), 0) - COALESCE((SELECT my_km_val FROM me), 0), 0)::NUMERIC,
         GREATEST((SELECT my_r FROM me) - 1, 1)::INT
  WHERE (SELECT my_r FROM me) IS NOT NULL;

  -- 2) 지역 (region_gu)
  IF u_gu IS NOT NULL THEN
    RETURN QUERY
    WITH period AS (
      SELECT a.user_id, SUM(a.distance_km) AS km
      FROM public.activities a
      JOIN public.profiles p ON p.id = a.user_id
      WHERE p.region_gu = u_gu
        AND p.is_public = true
        AND a.visibility = 'public'
        AND a.activity_date BETWEEN d_start AND d_end
      GROUP BY a.user_id
    ),
    ranked AS (SELECT user_id, km, RANK() OVER (ORDER BY km DESC) AS r FROM period),
    me AS (SELECT r AS my_r, km AS my_km_val FROM ranked WHERE user_id = target_user_id),
    tot AS (SELECT COUNT(*)::INT AS n FROM period),
    top10_km AS (SELECT km AS k FROM period ORDER BY km DESC OFFSET 9 LIMIT 1),
    next_km AS (
      SELECT km AS k FROM period ORDER BY km DESC
      OFFSET GREATEST((SELECT my_r FROM me) - 2, 0) LIMIT 1
    )
    SELECT 'region'::TEXT,
           u_gu::TEXT,
           (SELECT my_r FROM me)::INT,
           (SELECT n FROM tot),
           COALESCE((SELECT my_km_val FROM me), 0)::NUMERIC,
           GREATEST(COALESCE((SELECT k FROM top10_km), 0) - COALESCE((SELECT my_km_val FROM me), 0), 0)::NUMERIC,
           GREATEST(COALESCE((SELECT k FROM next_km), 0) - COALESCE((SELECT my_km_val FROM me), 0), 0)::NUMERIC,
           GREATEST((SELECT my_r FROM me) - 1, 1)::INT
    WHERE (SELECT my_r FROM me) IS NOT NULL;
  END IF;

  -- 3) 나이대 (전국 같은 성별+10년대)
  IF u_decade IS NOT NULL AND u_gender IS NOT NULL THEN
    RETURN QUERY
    WITH period AS (
      SELECT a.user_id, SUM(a.distance_km) AS km
      FROM public.activities a
      JOIN public.profiles p ON p.id = a.user_id
      WHERE p.gender = u_gender
        AND age_decade(p.birth_year) = u_decade
        AND p.is_public = true
        AND a.visibility = 'public'
        AND a.activity_date BETWEEN d_start AND d_end
      GROUP BY a.user_id
    ),
    ranked AS (SELECT user_id, km, RANK() OVER (ORDER BY km DESC) AS r FROM period),
    me AS (SELECT r AS my_r, km AS my_km_val FROM ranked WHERE user_id = target_user_id),
    tot AS (SELECT COUNT(*)::INT AS n FROM period),
    top10_km AS (SELECT km AS k FROM period ORDER BY km DESC OFFSET 9 LIMIT 1),
    next_km AS (
      SELECT km AS k FROM period ORDER BY km DESC
      OFFSET GREATEST((SELECT my_r FROM me) - 2, 0) LIMIT 1
    )
    SELECT 'decade'::TEXT,
           ('전국 ' || u_decade::text || '대 ' ||
            CASE u_gender WHEN 'male' THEN '남성' WHEN 'female' THEN '여성' ELSE '' END)::TEXT,
           (SELECT my_r FROM me)::INT,
           (SELECT n FROM tot),
           COALESCE((SELECT my_km_val FROM me), 0)::NUMERIC,
           GREATEST(COALESCE((SELECT k FROM top10_km), 0) - COALESCE((SELECT my_km_val FROM me), 0), 0)::NUMERIC,
           GREATEST(COALESCE((SELECT k FROM next_km), 0) - COALESCE((SELECT my_km_val FROM me), 0), 0)::NUMERIC,
           GREATEST((SELECT my_r FROM me) - 1, 1)::INT
    WHERE (SELECT my_r FROM me) IS NOT NULL;
  END IF;

  -- 4) 시작 기간 (가입일 ±60일 코호트)
  IF u_signup_date IS NOT NULL THEN
    RETURN QUERY
    WITH period AS (
      SELECT a.user_id, SUM(a.distance_km) AS km
      FROM public.activities a
      JOIN public.profiles p ON p.id = a.user_id
      WHERE p.created_at::DATE BETWEEN starter_min_date AND starter_max_date
        AND p.is_public = true
        AND a.visibility = 'public'
        AND a.activity_date BETWEEN d_start AND d_end
      GROUP BY a.user_id
    ),
    ranked AS (SELECT user_id, km, RANK() OVER (ORDER BY km DESC) AS r FROM period),
    me AS (SELECT r AS my_r, km AS my_km_val FROM ranked WHERE user_id = target_user_id),
    tot AS (SELECT COUNT(*)::INT AS n FROM period),
    top10_km AS (SELECT km AS k FROM period ORDER BY km DESC OFFSET 9 LIMIT 1),
    next_km AS (
      SELECT km AS k FROM period ORDER BY km DESC
      OFFSET GREATEST((SELECT my_r FROM me) - 2, 0) LIMIT 1
    )
    SELECT 'starter'::TEXT,
           starter_label::TEXT,
           (SELECT my_r FROM me)::INT,
           (SELECT n FROM tot),
           COALESCE((SELECT my_km_val FROM me), 0)::NUMERIC,
           GREATEST(COALESCE((SELECT k FROM top10_km), 0) - COALESCE((SELECT my_km_val FROM me), 0), 0)::NUMERIC,
           GREATEST(COALESCE((SELECT k FROM next_km), 0) - COALESCE((SELECT my_km_val FROM me), 0), 0)::NUMERIC,
           GREATEST((SELECT my_r FROM me) - 1, 1)::INT
    WHERE (SELECT my_r FROM me) IS NOT NULL;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.find_my_rankings_breakdown(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_my_rankings_breakdown(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.find_my_rankings_breakdown(UUID, TEXT) TO authenticated;


-- ============================================================================
-- 2. 사용자 마일리지 카테고리 요약 — 타인 클릭 시에도 안전하게 (개인 트랜잭션 X)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fetch_user_mileage_summary(target_user_id UUID)
RETURNS TABLE (
  display_name TEXT,
  avatar_url TEXT,
  region_gu TEXT,
  total_balance BIGINT,
  running_earned BIGINT,
  reward_earned BIGINT,
  spent BIGINT,
  recent_30d_earned BIGINT,
  signup_days INT,
  total_runs INT,
  total_distance_km NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
#variable_conflict use_column
DECLARE
  v_is_public BOOLEAN;
BEGIN
  -- public 프로필만 조회 가능 (개인정보 보호)
  SELECT is_public INTO v_is_public FROM public.profiles WHERE id = target_user_id;
  IF v_is_public IS NOT TRUE AND target_user_id <> auth.uid() THEN
    RETURN;
  END IF;

  -- CTE alias 로 RETURNS TABLE 컬럼명과 충돌 회피 (PL/pgSQL ambiguous column).
  -- #variable_conflict use_column directive 와 조합.
  RETURN QUERY
  WITH p AS (
    SELECT pp.display_name AS dn,
           pp.avatar_url AS au,
           pp.region_gu AS rg,
           pp.mileage_balance AS mb,
           pp.created_at AS ca,
           pp.total_runs AS tr,
           pp.total_distance_km AS td
    FROM public.profiles pp
    WHERE pp.id = target_user_id
  ),
  txs AS (
    SELECT mt.amount, mt.tx_type, mt.event_type, mt.created_at AS tx_at
    FROM public.mileage_transactions mt
    WHERE mt.user_id = target_user_id
  )
  SELECT
    p.dn,
    p.au,
    p.rg,
    COALESCE(p.mb, 0)::BIGINT,
    COALESCE((
      SELECT SUM(amount)::BIGINT FROM txs
      WHERE amount > 0 AND (
        tx_type = 'run_earn'
        OR (tx_type = 'reward' AND (
          event_type = 'distance_km'
          OR event_type = 'monthly_goal_complete'
          OR event_type LIKE 'first_%'
          OR event_type LIKE 'streak_%'
        ))
      )
    ), 0),
    COALESCE((
      SELECT SUM(amount)::BIGINT FROM txs
      WHERE amount > 0 AND (
        tx_type IN ('gift_receive', 'admin_adjust', 'refund')
        OR (tx_type = 'reward' AND (
          event_type IS NULL OR (
            event_type NOT IN ('distance_km', 'monthly_goal_complete')
            AND event_type NOT LIKE 'first_%'
            AND event_type NOT LIKE 'streak_%'
          )
        ))
      )
    ), 0),
    COALESCE((
      SELECT ABS(SUM(amount))::BIGINT FROM txs
      WHERE amount < 0
    ), 0),
    COALESCE((
      SELECT SUM(amount)::BIGINT FROM txs
      WHERE amount > 0 AND tx_at > NOW() - INTERVAL '30 days'
    ), 0),
    GREATEST(0, EXTRACT(DAY FROM (NOW() - p.ca))::INT),
    COALESCE(p.tr, 0),
    COALESCE(p.td, 0)::NUMERIC
  FROM p;
END;
$$;

REVOKE ALL ON FUNCTION public.fetch_user_mileage_summary(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fetch_user_mileage_summary(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fetch_user_mileage_summary(UUID) TO authenticated;

-- ============================================================================
-- 3. 코호트 리더보드 — RankingBreakdown 카드 클릭 시 해당 코호트 TOP N (build 100)
-- scope_type: nation/region/decade/starter/gender
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fetch_cohort_leaderboard(
  caller_user_id UUID,
  scope_type TEXT,
  time_axis TEXT DEFAULT 'month',
  result_limit INT DEFAULT 50
)
RETURNS TABLE (
  user_id UUID,
  display_name TEXT,
  avatar_url TEXT,
  region_gu TEXT,
  km NUMERIC,
  rank_position INT,
  is_me BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
#variable_conflict use_column
DECLARE
  u_gu TEXT;
  u_si TEXT;
  u_country TEXT;
  u_gender TEXT;
  u_birth INT;
  u_decade INT;
  u_signup_date DATE;
  d_start DATE;
  d_end DATE;
  starter_min DATE;
  starter_max DATE;
BEGIN
  SELECT pp.country_code, pp.region_si, pp.region_gu, pp.gender, pp.birth_year, pp.created_at::DATE
    INTO u_country, u_si, u_gu, u_gender, u_birth, u_signup_date
  FROM public.profiles pp WHERE pp.id = caller_user_id;

  u_decade := age_decade(u_birth);
  SELECT start_d, end_d INTO d_start, d_end FROM _hero_date_range(time_axis);

  IF u_signup_date IS NOT NULL THEN
    starter_min := u_signup_date - INTERVAL '60 days';
    starter_max := u_signup_date + INTERVAL '60 days';
  END IF;

  RETURN QUERY
  WITH period AS (
    SELECT a.user_id AS uid, SUM(a.distance_km) AS sum_km
    FROM public.activities a
    JOIN public.profiles p ON p.id = a.user_id
    WHERE p.is_public = true
      AND a.visibility = 'public'
      AND a.activity_date BETWEEN d_start AND d_end
      AND CASE scope_type
        WHEN 'nation' THEN TRUE
        WHEN 'region' THEN u_gu IS NOT NULL AND p.region_gu = u_gu
        WHEN 'decade' THEN u_decade IS NOT NULL AND u_gender IS NOT NULL
                          AND age_decade(p.birth_year) = u_decade
                          AND p.gender = u_gender
        WHEN 'starter' THEN u_signup_date IS NOT NULL
                           AND p.created_at::DATE BETWEEN starter_min AND starter_max
        WHEN 'gender' THEN u_gender IS NOT NULL AND p.gender = u_gender
        ELSE TRUE
      END
    GROUP BY a.user_id
  ),
  ranked AS (
    SELECT uid, sum_km, RANK() OVER (ORDER BY sum_km DESC)::INT AS r FROM period
  )
  SELECT pp.id, pp.display_name, pp.avatar_url, pp.region_gu,
         ROUND(ranked.sum_km, 1), ranked.r, (pp.id = caller_user_id)
  FROM ranked
  JOIN public.profiles pp ON pp.id = ranked.uid
  ORDER BY ranked.r ASC
  LIMIT result_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.fetch_cohort_leaderboard(UUID, TEXT, TEXT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fetch_cohort_leaderboard(UUID, TEXT, TEXT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.fetch_cohort_leaderboard(UUID, TEXT, TEXT, INT) TO authenticated;

-- ============================================================================
-- 4. 시계열 랭킹 history — 주/월/년 × scope 별 retrospective 순위 + 거리 (build 100)
-- 사용처: /ranking 의 내 랭킹 탭 하단 시계열 그래프
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fetch_my_rank_history(
  target_user_id UUID,
  scope_type TEXT DEFAULT 'nation',
  period_type TEXT DEFAULT 'weekly',
  periods INT DEFAULT 12
)
RETURNS TABLE (
  period_idx INT,
  period_start DATE,
  period_end DATE,
  period_label TEXT,
  rank_position INT,
  total_in_scope INT,
  my_km NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
#variable_conflict use_column
DECLARE
  u_gu TEXT;
  u_gender TEXT;
  u_birth INT;
  u_decade INT;
  u_signup_date DATE;
  starter_min DATE;
  starter_max DATE;
  i INT;
  v_start DATE;
  v_end DATE;
  v_label TEXT;
  v_rank INT;
  v_total INT;
  v_km NUMERIC;
BEGIN
  SELECT pp.region_gu, pp.gender, pp.birth_year, pp.created_at::DATE
    INTO u_gu, u_gender, u_birth, u_signup_date
  FROM public.profiles pp WHERE pp.id = target_user_id;

  u_decade := age_decade(u_birth);
  IF u_signup_date IS NOT NULL THEN
    starter_min := u_signup_date - INTERVAL '60 days';
    starter_max := u_signup_date + INTERVAL '60 days';
  END IF;

  FOR i IN 0..(periods - 1) LOOP
    IF period_type = 'weekly' THEN
      v_end := CURRENT_DATE - (i * 7);
      v_start := v_end - 6;
      v_label := TO_CHAR(v_start, 'MM/DD');
    ELSIF period_type = 'monthly' THEN
      v_end := (DATE_TRUNC('month', CURRENT_DATE - (i * INTERVAL '1 month'))
                + INTERVAL '1 month - 1 day')::DATE;
      v_start := DATE_TRUNC('month', CURRENT_DATE - (i * INTERVAL '1 month'))::DATE;
      v_label := TO_CHAR(v_start, 'YY.MM');
    ELSE  -- yearly
      v_end := (DATE_TRUNC('year', CURRENT_DATE - (i * INTERVAL '1 year'))
                + INTERVAL '1 year - 1 day')::DATE;
      v_start := DATE_TRUNC('year', CURRENT_DATE - (i * INTERVAL '1 year'))::DATE;
      v_label := TO_CHAR(v_start, 'YYYY');
    END IF;

    WITH period AS (
      SELECT a.user_id AS uid, SUM(a.distance_km) AS km
      FROM public.activities a
      JOIN public.profiles p ON p.id = a.user_id
      WHERE p.is_public = true
        AND a.visibility = 'public'
        AND a.activity_date BETWEEN v_start AND v_end
        AND CASE scope_type
          WHEN 'nation' THEN TRUE
          WHEN 'region' THEN u_gu IS NOT NULL AND p.region_gu = u_gu
          WHEN 'decade' THEN u_decade IS NOT NULL AND u_gender IS NOT NULL
                            AND age_decade(p.birth_year) = u_decade
                            AND p.gender = u_gender
          WHEN 'starter' THEN u_signup_date IS NOT NULL
                            AND p.created_at::DATE BETWEEN starter_min AND starter_max
          WHEN 'gender' THEN u_gender IS NOT NULL AND p.gender = u_gender
          ELSE TRUE
        END
      GROUP BY a.user_id
    ),
    ranked AS (
      SELECT uid, km, RANK() OVER (ORDER BY km DESC)::INT AS r FROM period
    )
    SELECT r, (SELECT COUNT(*)::INT FROM period), km
    INTO v_rank, v_total, v_km
    FROM ranked WHERE uid = target_user_id;

    RETURN QUERY SELECT
      i, v_start, v_end, v_label,
      COALESCE(v_rank, 0)::INT,
      COALESCE(v_total, 0)::INT,
      COALESCE(v_km, 0)::NUMERIC;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.fetch_my_rank_history(UUID, TEXT, TEXT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fetch_my_rank_history(UUID, TEXT, TEXT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.fetch_my_rank_history(UUID, TEXT, TEXT, INT) TO authenticated;

COMMIT;
