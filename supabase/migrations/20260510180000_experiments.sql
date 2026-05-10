-- A/B 테스트 인프라.
-- 사용 흐름:
--   1. 어드민이 experiments 에 새 실험 등록 (name, variants[], traffic_split)
--   2. 클라가 useExperiment(name) hook 호출 → assign_experiment RPC
--   3. RPC 가 experiment_assignments 에 user_id 별 variant 결정 (deterministic, hash)
--   4. 클라가 결정된 variant 따라 UI 분기
--   5. 전환 이벤트 (구매/클릭 등) 발생 시 track_experiment_event RPC 로 기록
--   6. 어드민이 분석 — variant 별 conversion rate 비교

CREATE TABLE IF NOT EXISTS public.experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,           -- 'shop_cta_text', 'free_shipping_threshold' 등
  description TEXT,
  variants JSONB NOT NULL,             -- ['control', 'A', 'B'] 또는 [{key, weight}]
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'paused', 'completed')),
  traffic_pct INT NOT NULL DEFAULT 100 CHECK (traffic_pct BETWEEN 0 AND 100),
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  primary_metric TEXT,                 -- 'order_paid' / 'click' 등 트래킹할 핵심 이벤트
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.experiment_assignments (
  experiment_id UUID NOT NULL REFERENCES public.experiments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  variant TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (experiment_id, user_id)
);
CREATE INDEX IF NOT EXISTS exp_assignments_user_idx
  ON public.experiment_assignments(user_id);

CREATE TABLE IF NOT EXISTS public.experiment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID NOT NULL REFERENCES public.experiments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  variant TEXT NOT NULL,
  event_name TEXT NOT NULL,
  value NUMERIC,                        -- 매출액 등 numeric metric
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS exp_events_exp_idx
  ON public.experiment_events(experiment_id, event_name);

-- RLS
ALTER TABLE public.experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiment_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiment_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS experiments_read_running ON public.experiments;
CREATE POLICY experiments_read_running ON public.experiments
  FOR SELECT USING (status = 'running' OR public.is_shop_admin());
DROP POLICY IF EXISTS experiments_admin_write ON public.experiments;
CREATE POLICY experiments_admin_write ON public.experiments
  FOR ALL USING (public.is_shop_admin()) WITH CHECK (public.is_shop_admin());

DROP POLICY IF EXISTS exp_assignments_own ON public.experiment_assignments;
CREATE POLICY exp_assignments_own ON public.experiment_assignments
  FOR SELECT USING (auth.uid() = user_id OR public.is_shop_admin());

DROP POLICY IF EXISTS exp_events_own_read ON public.experiment_events;
CREATE POLICY exp_events_own_read ON public.experiment_events
  FOR SELECT USING (auth.uid() = user_id OR public.is_shop_admin());

------------------------------------------------------------
-- assign_experiment — variant 결정 (deterministic hash)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_experiment(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_exp RECORD;
  v_existing TEXT;
  v_variants JSONB;
  v_variant_count INT;
  v_hash BIGINT;
  v_idx INT;
  v_chosen TEXT;
  v_random_pct INT;
BEGIN
  IF v_user_id IS NULL THEN RETURN 'control'; END IF;

  SELECT * INTO v_exp FROM public.experiments WHERE name = p_name AND status = 'running';
  IF NOT FOUND THEN RETURN 'control'; END IF;

  -- 시작/종료 시간 검사
  IF v_exp.start_at IS NOT NULL AND NOW() < v_exp.start_at THEN RETURN 'control'; END IF;
  IF v_exp.end_at IS NOT NULL AND NOW() > v_exp.end_at THEN RETURN 'control'; END IF;

  -- 이미 할당된 경우 (deterministic — 한 번 받은 variant 유지)
  SELECT variant INTO v_existing FROM public.experiment_assignments
   WHERE experiment_id = v_exp.id AND user_id = v_user_id;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  -- traffic_pct 적용 — user_id hash 가 traffic_pct 안 들어가면 control
  v_hash := abs(hashtextextended(v_exp.id::text || v_user_id::text, 0));
  v_random_pct := (v_hash % 100)::INT;
  IF v_random_pct >= v_exp.traffic_pct THEN
    v_chosen := 'control';
  ELSE
    -- variants 배열에서 hash 로 균등 분배
    v_variants := v_exp.variants;
    v_variant_count := jsonb_array_length(v_variants);
    IF v_variant_count = 0 THEN
      v_chosen := 'control';
    ELSE
      v_idx := ((v_hash / 100) % v_variant_count)::INT;
      -- variant 가 string 인 경우 ('A') 또는 object ({"key": "A"})
      IF jsonb_typeof(v_variants -> v_idx) = 'string' THEN
        v_chosen := v_variants ->> v_idx;
      ELSE
        v_chosen := COALESCE(v_variants -> v_idx ->> 'key', 'control');
      END IF;
    END IF;
  END IF;

  -- assignments 저장
  INSERT INTO public.experiment_assignments (experiment_id, user_id, variant)
  VALUES (v_exp.id, v_user_id, v_chosen)
  ON CONFLICT (experiment_id, user_id) DO NOTHING;

  RETURN v_chosen;
END $$;
REVOKE ALL ON FUNCTION public.assign_experiment(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_experiment(TEXT) TO authenticated;

------------------------------------------------------------
-- track_experiment_event — 전환 이벤트 기록
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.track_experiment_event(
  p_name TEXT,
  p_event_name TEXT,
  p_value NUMERIC DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_exp_id UUID;
  v_variant TEXT;
BEGIN
  IF v_user_id IS NULL THEN RETURN false; END IF;
  SELECT id INTO v_exp_id FROM public.experiments WHERE name = p_name AND status = 'running';
  IF v_exp_id IS NULL THEN RETURN false; END IF;
  SELECT variant INTO v_variant FROM public.experiment_assignments
   WHERE experiment_id = v_exp_id AND user_id = v_user_id;
  IF v_variant IS NULL THEN RETURN false; END IF;
  INSERT INTO public.experiment_events
    (experiment_id, user_id, variant, event_name, value, metadata)
  VALUES (v_exp_id, v_user_id, v_variant, p_event_name, p_value, p_metadata);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.track_experiment_event(TEXT, TEXT, NUMERIC, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_experiment_event(TEXT, TEXT, NUMERIC, JSONB) TO authenticated;

------------------------------------------------------------
-- 어드민 결과 집계
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.experiment_results(p_name TEXT)
RETURNS TABLE(
  variant TEXT,
  user_count BIGINT,
  event_count BIGINT,
  conversion_rate NUMERIC,
  total_value NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_exp_id UUID;
  v_metric TEXT;
BEGIN
  IF NOT public.is_shop_admin() THEN
    RAISE EXCEPTION '관리자만 조회 가능';
  END IF;
  SELECT id, primary_metric INTO v_exp_id, v_metric FROM public.experiments WHERE name = p_name;
  IF v_exp_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH assigned AS (
    SELECT variant, COUNT(*) AS user_cnt
      FROM public.experiment_assignments
     WHERE experiment_id = v_exp_id
     GROUP BY variant
  ),
  events AS (
    SELECT variant, COUNT(*) AS event_cnt, SUM(COALESCE(value, 0)) AS total_val
      FROM public.experiment_events
     WHERE experiment_id = v_exp_id
       AND (v_metric IS NULL OR event_name = v_metric)
     GROUP BY variant
  )
  SELECT
    a.variant,
    a.user_cnt,
    COALESCE(e.event_cnt, 0),
    CASE WHEN a.user_cnt > 0 THEN ROUND((COALESCE(e.event_cnt, 0)::NUMERIC / a.user_cnt) * 100, 2) ELSE 0 END,
    COALESCE(e.total_val, 0)
  FROM assigned a
  LEFT JOIN events e ON e.variant = a.variant;
END $$;
REVOKE ALL ON FUNCTION public.experiment_results(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.experiment_results(TEXT) TO authenticated;
