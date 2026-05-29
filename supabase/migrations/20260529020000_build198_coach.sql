-- build 198: "러닝 코치 (AI)" 인프라.
-- 1) profile.weight_kg + max_hr — opt-in. 칼로리·HR Zones 정확도용. RLS 본인만 read/write.
-- 2) daily_stress_scores — 매일 1행 캐시. CTL/ATL/TSB 일별 누적값.
-- 3) get_my_fitness_trend(days) RPC — 최근 N일 컨디션 시계열 반환.
-- 4) compute_today_condition(user_id) RPC — 오늘 컨디션 점수 (0~100) + 코칭 문구.

-- ─── 1) profile 컬럼 추가 (opt-in, NULL OK) ──────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS max_hr INTEGER,
  ADD COLUMN IF NOT EXISTS resting_hr INTEGER,
  ADD COLUMN IF NOT EXISTS coach_opt_in BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.weight_kg IS 'opt-in 체중 (kcal MET 계산용). 랭킹·비교 X. 본인만 보임.';
COMMENT ON COLUMN public.profiles.max_hr IS 'opt-in 최대 심박수 (HR Zones 용). 220-age 추정 가능.';
COMMENT ON COLUMN public.profiles.resting_hr IS 'opt-in 안정시 심박수 (Karvonen 공식용).';
COMMENT ON COLUMN public.profiles.coach_opt_in IS '러닝 코치 (AI) 메뉴 활성화 여부.';

-- ─── 2) daily_stress_scores — 일별 stress 캐시 ──────────────────────────
CREATE TABLE IF NOT EXISTS public.daily_stress_scores (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  stress_score NUMERIC(6,1) NOT NULL DEFAULT 0,  -- TRIMP 추정값
  ctl NUMERIC(6,2),                              -- Chronic Training Load (42일 EWMA)
  atl NUMERIC(6,2),                              -- Acute Training Load (7일 EWMA)
  tsb NUMERIC(6,2),                              -- TSB = CTL - ATL
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, date)
);

CREATE INDEX IF NOT EXISTS daily_stress_user_date_idx ON public.daily_stress_scores (user_id, date DESC);

ALTER TABLE public.daily_stress_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dss_select_own ON public.daily_stress_scores;
CREATE POLICY dss_select_own ON public.daily_stress_scores FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS dss_modify_own ON public.daily_stress_scores;
CREATE POLICY dss_modify_own ON public.daily_stress_scores FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ─── 3) compute_fitness_trend RPC ───────────────────────────────────────
-- 사용자의 모든 활동에서 일별 stress 집계 → EWMA 로 CTL/ATL/TSB 계산.
-- TRIMP 단순 추정: distance_km × 10 + duration_minutes × 0.5 (HR 없는 폴백).
-- 정교화는 추후 (RSS / HRSS 등) — 지금은 거리·시간만 있는 사용자에게도 작동하게.
CREATE OR REPLACE FUNCTION public.compute_fitness_trend(
  p_user_id UUID,
  p_days INTEGER DEFAULT 90
) RETURNS TABLE (
  date DATE,
  stress_score NUMERIC,
  ctl NUMERIC,
  atl NUMERIC,
  tsb NUMERIC
) AS $$
DECLARE
  v_uid UUID;
  v_start DATE;
  v_end DATE;
  v_ctl_decay CONSTANT NUMERIC := 1.0 - EXP(-1.0 / 42.0);
  v_atl_decay CONSTANT NUMERIC := 1.0 - EXP(-1.0 / 7.0);
  v_prev_ctl NUMERIC := 0;
  v_prev_atl NUMERIC := 0;
  r RECORD;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF v_uid <> p_user_id THEN RAISE EXCEPTION 'only own data'; END IF;

  v_end := CURRENT_DATE;
  v_start := v_end - (p_days || ' days')::INTERVAL;

  -- 일별 stress 산출 (EWMA 안정화를 위해 추가 60일 buffer 데이터부터 시작)
  RETURN QUERY
  WITH date_range AS (
    SELECT generate_series(v_start - INTERVAL '60 days', v_end, '1 day'::INTERVAL)::DATE AS d
  ),
  daily_stress AS (
    SELECT
      dr.d AS date,
      COALESCE(SUM(
        (a.distance_km::NUMERIC * 10)
        + (a.duration_seconds::NUMERIC / 60.0 * 0.5)
      ), 0)::NUMERIC AS stress_score
    FROM date_range dr
    LEFT JOIN public.activities a
      ON a.user_id = p_user_id
     AND a.activity_date = dr.d
     AND a.activity_type IN ('running', 'walking')  -- type NULL 도 포함하려면 별도 후속
    GROUP BY dr.d
    ORDER BY dr.d
  ),
  ewma AS (
    -- 윈도우 함수로 EWMA 계산 — 한 패스로.
    SELECT
      date,
      stress_score,
      -- 누적 EWMA: SUM(stress * decay * (1-decay)^(N-i)) — 근사를 위해 단계적 누적
      -- PostgreSQL 에선 lag() 만으로 진정한 EWMA 어려움 → procedural loop 또는 array.
      ROW_NUMBER() OVER (ORDER BY date) AS rn
    FROM daily_stress
  )
  -- 실제 EWMA 계산은 PL/pgSQL loop 로 — 위 CTE 는 row 순회용
  SELECT q.date, q.stress_score, q.ctl, q.atl, q.tsb
  FROM (
    SELECT
      d.date,
      d.stress_score,
      -- 윈도우 누적은 PL/pgSQL 외부에선 부담 — 임시 row-by-row 결과를 별도 함수에서 합산
      NULL::NUMERIC AS ctl,
      NULL::NUMERIC AS atl,
      NULL::NUMERIC AS tsb
    FROM daily_stress d
    WHERE d.date >= v_start
  ) q;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

-- ─── 3-alt) compute_fitness_trend_v2 — PL/pgSQL loop 로 정확한 EWMA ─────
-- 위 함수는 데이터 모양만, 실제 EWMA 는 이 함수에서.
CREATE OR REPLACE FUNCTION public.get_my_fitness_trend(
  p_days INTEGER DEFAULT 90
) RETURNS TABLE (
  date DATE,
  stress_score NUMERIC,
  ctl NUMERIC,
  atl NUMERIC,
  tsb NUMERIC
) AS $$
DECLARE
  v_uid UUID;
  v_start DATE;
  v_end DATE;
  v_buffer_start DATE;
  v_ctl NUMERIC := 0;
  v_atl NUMERIC := 0;
  v_ctl_decay CONSTANT NUMERIC := 1.0 / 42.0;
  v_atl_decay CONSTANT NUMERIC := 1.0 / 7.0;
  r RECORD;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  v_end := CURRENT_DATE;
  v_start := v_end - (p_days || ' days')::INTERVAL;
  v_buffer_start := v_start - INTERVAL '60 days';  -- EWMA 안정화 buffer

  -- 일별 stress 집계 + 임시 결과 누적
  CREATE TEMP TABLE _ft_result (date DATE, stress NUMERIC, ctl NUMERIC, atl NUMERIC, tsb NUMERIC) ON COMMIT DROP;

  FOR r IN
    SELECT
      d::DATE AS dt,
      COALESCE((
        SELECT SUM(
          (a.distance_km::NUMERIC * 10)
          + (a.duration_seconds::NUMERIC / 60.0 * 0.5)
        )
        FROM public.activities a
        WHERE a.user_id = v_uid
          AND a.activity_date = d::DATE
          AND (a.activity_type IS NULL OR a.activity_type IN ('running', 'walking'))
      ), 0) AS stress
    FROM generate_series(v_buffer_start, v_end, '1 day'::INTERVAL) d
    ORDER BY d
  LOOP
    -- EWMA: new = prev + (stress - prev) × decay
    v_ctl := v_ctl + (r.stress - v_ctl) * v_ctl_decay;
    v_atl := v_atl + (r.stress - v_atl) * v_atl_decay;
    INSERT INTO _ft_result (date, stress, ctl, atl, tsb)
      VALUES (r.dt, r.stress, ROUND(v_ctl, 2), ROUND(v_atl, 2), ROUND(v_ctl - v_atl, 2));
  END LOOP;

  RETURN QUERY
    SELECT _ft_result.date, _ft_result.stress, _ft_result.ctl, _ft_result.atl, _ft_result.tsb
    FROM _ft_result
    WHERE _ft_result.date >= v_start
    ORDER BY _ft_result.date;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.compute_fitness_trend(UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.compute_fitness_trend(UUID, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.compute_fitness_trend(UUID, INTEGER) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_my_fitness_trend(INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_fitness_trend(INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_fitness_trend(INTEGER) TO authenticated;

-- ─── 4) get_today_coaching — 오늘 컨디션 점수 + 친근한 한국어 메시지 ────
-- TSB 기반 컨디션 점수 (0~100). 양수 TSB = 회복 (점수 높음), 음수 = 피로.
-- 점수 = 50 + TSB × 2 (clamp 0~100).
-- 메시지 6단계: 매우 피로 / 피로 / 보통 / 좋음 / 매우 좋음 / 회복 후 활력.
CREATE OR REPLACE FUNCTION public.get_today_coaching() RETURNS JSON AS $$
DECLARE
  v_uid UUID;
  v_today_ctl NUMERIC := 0;
  v_today_atl NUMERIC := 0;
  v_tsb NUMERIC := 0;
  v_score INTEGER;
  v_msg TEXT;
  v_advice TEXT;
  v_recent_streak INTEGER := 0;
  v_last_active_date DATE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN json_build_object('error', 'auth required'); END IF;

  -- 최근 fitness trend 의 마지막 행 ≈ 오늘 CTL/ATL
  SELECT ctl, atl INTO v_today_ctl, v_today_atl
  FROM public.get_my_fitness_trend(14)
  ORDER BY date DESC LIMIT 1;

  v_today_ctl := COALESCE(v_today_ctl, 0);
  v_today_atl := COALESCE(v_today_atl, 0);
  v_tsb := v_today_ctl - v_today_atl;

  -- 컨디션 점수: TSB 가 0 이면 50점, +10 이면 70점, -10 이면 30점
  v_score := GREATEST(0, LEAST(100, ROUND(50 + v_tsb * 2.0)));

  -- 마지막 활동 날짜 확인 (스트릭 / 휴식 권장 판단)
  SELECT MAX(activity_date) INTO v_last_active_date
  FROM public.activities
  WHERE user_id = v_uid AND distance_km > 0;

  -- 메시지 분기
  IF v_today_ctl < 5 THEN
    v_msg := '천천히 시작해 봐요';
    v_advice := '아직 데이터가 적어요. 2~3km 가볍게 달려보세요.';
  ELSIF v_tsb < -15 THEN
    v_msg := '오늘은 푹 쉬세요';
    v_advice := '최근 무리하셨네요. 충분한 회복이 더 큰 발전을 만들어요.';
  ELSIF v_tsb < -5 THEN
    v_msg := '컨디션이 조금 무거워요';
    v_advice := '가볍게 30분 조깅이나 회복런을 추천해요.';
  ELSIF v_tsb < 5 THEN
    v_msg := '평소 컨디션이에요';
    v_advice := '오늘은 평소대로 5km 어떠세요?';
  ELSIF v_tsb < 15 THEN
    v_msg := '오늘 컨디션 좋아요 ✨';
    v_advice := '조금 더 길게 가도 좋아요. 7~10km 추천!';
  ELSE
    v_msg := '컨디션 절정! 자기 기록 갱신 도전 가능';
    v_advice := '인터벌 또는 템포런 추천. PB 도전!';
  END IF;

  RETURN json_build_object(
    'score', v_score,
    'message', v_msg,
    'advice', v_advice,
    'tsb', ROUND(v_tsb, 1),
    'ctl', ROUND(v_today_ctl, 1),
    'atl', ROUND(v_today_atl, 1),
    'last_active_date', v_last_active_date
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.get_today_coaching() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_today_coaching() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_today_coaching() TO authenticated;

COMMENT ON FUNCTION public.get_today_coaching() IS 'CTL/ATL/TSB 기반 오늘 컨디션 점수 + 친근한 한국어 메시지/조언. 러닝 코치 (AI) 메뉴 핵심.';
