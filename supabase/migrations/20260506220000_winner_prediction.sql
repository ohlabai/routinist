-- 2026-05-06: 우승자 맞추기 (무료, 마일리지 X)
-- 주 단위 라운드. 사용자가 1인 1픽. 일요일 자정 정산. 맞춘 사람 +10 점 + "예측왕" 뱃지.
-- App Store gambling 규제 회피 (chance-based reward + monetary stake X).

-- ============================================================================
-- 1. 라운드 (주 단위)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.prediction_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_of DATE NOT NULL UNIQUE,                    -- 월요일 (KST)
  cohort_type TEXT NOT NULL DEFAULT 'global',      -- 'global' | 'region_si' | 'region_gu'
  cohort_value TEXT,                               -- region_si='서울특별시' 등
  starts_at TIMESTAMPTZ NOT NULL,
  closes_at TIMESTAMPTZ NOT NULL,                  -- 토요일 자정 KST (예측 마감)
  ends_at TIMESTAMPTZ NOT NULL,                    -- 일요일 자정 KST (라운드 종료)
  winner_user_id UUID REFERENCES public.profiles(id),
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'locked', 'settled')),
  settled_at TIMESTAMPTZ,
  total_picks INTEGER DEFAULT 0,
  correct_picks INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pr_state_week ON public.prediction_rounds(state, week_of DESC);

ALTER TABLE public.prediction_rounds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rounds_select" ON public.prediction_rounds;
CREATE POLICY "rounds_select" ON public.prediction_rounds FOR SELECT USING (true);
-- INSERT/UPDATE 는 RPC 만 (SECURITY DEFINER) 통해 — 사용자 직접 못 함
DROP POLICY IF EXISTS "rounds_admin" ON public.prediction_rounds;
CREATE POLICY "rounds_admin" ON public.prediction_rounds FOR ALL
  USING ((auth.jwt() ->> 'email') = 'hans@openhan.kr')
  WITH CHECK ((auth.jwt() ->> 'email') = 'hans@openhan.kr');

-- ============================================================================
-- 2. 사용자 픽
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.prediction_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES public.prediction_rounds(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  picked_user_id UUID NOT NULL REFERENCES public.profiles(id),
  picked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_correct BOOLEAN,                              -- 정산 시 채워짐
  UNIQUE (round_id, user_id)                       -- 1인 1픽 (변경 불가, App Store gambling 회피)
);

CREATE INDEX IF NOT EXISTS idx_pp_round ON public.prediction_picks(round_id);
CREATE INDEX IF NOT EXISTS idx_pp_user ON public.prediction_picks(user_id);

ALTER TABLE public.prediction_picks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "picks_select" ON public.prediction_picks;
CREATE POLICY "picks_select" ON public.prediction_picks FOR SELECT USING (true);  -- 누구나 조회 (참여자 수 표시)
DROP POLICY IF EXISTS "picks_insert" ON public.prediction_picks;
CREATE POLICY "picks_insert" ON public.prediction_picks FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.prediction_rounds r
      WHERE r.id = round_id AND r.state = 'open' AND r.closes_at > NOW()
    )
  );
-- UPDATE/DELETE 금지 — pick 변경 불가

-- ============================================================================
-- 3. 사용자 점수 누적 (profiles 에 컬럼 추가)
-- ============================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS prediction_score INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prediction_correct INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prediction_total INTEGER DEFAULT 0;

-- ============================================================================
-- 4. 새 라운드 생성 RPC — 매주 월요일 호출 (수동 또는 cron)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_prediction_round(p_cohort_type TEXT DEFAULT 'global', p_cohort_value TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_monday DATE;
  v_starts TIMESTAMPTZ;
  v_closes TIMESTAMPTZ;
  v_ends TIMESTAMPTZ;
  v_round_id UUID;
BEGIN
  v_monday := date_trunc('week', NOW() AT TIME ZONE 'Asia/Seoul')::DATE;
  v_starts := (v_monday::TEXT || ' 00:00:00')::TIMESTAMP AT TIME ZONE 'Asia/Seoul';
  v_closes := (v_starts + INTERVAL '5 days 23 hours 59 minutes');  -- 토요일 23:59
  v_ends   := (v_starts + INTERVAL '6 days 23 hours 59 minutes');  -- 일요일 23:59

  INSERT INTO public.prediction_rounds (week_of, cohort_type, cohort_value, starts_at, closes_at, ends_at)
  VALUES (v_monday, p_cohort_type, p_cohort_value, v_starts, v_closes, v_ends)
  ON CONFLICT (week_of) DO UPDATE SET cohort_type = EXCLUDED.cohort_type
  RETURNING id INTO v_round_id;

  RETURN v_round_id;
END $$;

GRANT EXECUTE ON FUNCTION public.create_prediction_round(TEXT, TEXT) TO authenticated;

-- ============================================================================
-- 5. 라운드 정산 RPC — 일요일 자정에 winner 결정 + 점수 적립
-- ============================================================================
CREATE OR REPLACE FUNCTION public.settle_prediction_round(p_round_id UUID)
RETURNS TABLE (winner_user_id UUID, total_picks INTEGER, correct_picks INTEGER)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_round public.prediction_rounds%ROWTYPE;
  v_winner UUID;
  v_total INTEGER;
  v_correct INTEGER;
  v_week_start DATE;
  v_week_end DATE;
BEGIN
  SELECT * INTO v_round FROM public.prediction_rounds WHERE id = p_round_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Round not found'; END IF;
  IF v_round.state = 'settled' THEN
    RETURN QUERY SELECT v_round.winner_user_id, v_round.total_picks, v_round.correct_picks;
    RETURN;
  END IF;

  v_week_start := v_round.week_of;
  v_week_end := v_week_start + 6;

  -- winner = 그 주 KM 합계 1위
  SELECT user_id INTO v_winner
    FROM public.activities
   WHERE activity_date BETWEEN v_week_start AND v_week_end
   GROUP BY user_id
   ORDER BY SUM(distance_km) DESC
   LIMIT 1;

  IF v_winner IS NULL THEN
    -- 활동 0건이면 winner 없음. 라운드 무효
    UPDATE public.prediction_rounds SET state = 'settled', settled_at = NOW() WHERE id = p_round_id;
    RETURN QUERY SELECT NULL::UUID, 0, 0;
    RETURN;
  END IF;

  -- 픽 정확도 마킹
  UPDATE public.prediction_picks
     SET is_correct = (picked_user_id = v_winner)
   WHERE round_id = p_round_id;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE is_correct)
    INTO v_total, v_correct
    FROM public.prediction_picks
   WHERE round_id = p_round_id;

  -- 점수 적립 — 맞춘 사람 +10, 모든 참여자 prediction_total +1
  UPDATE public.profiles p
     SET prediction_score = COALESCE(prediction_score, 0) + 10,
         prediction_correct = COALESCE(prediction_correct, 0) + 1,
         prediction_total = COALESCE(prediction_total, 0) + 1
   WHERE p.id IN (
     SELECT user_id FROM public.prediction_picks
      WHERE round_id = p_round_id AND is_correct
   );

  UPDATE public.profiles p
     SET prediction_total = COALESCE(prediction_total, 0) + 1
   WHERE p.id IN (
     SELECT user_id FROM public.prediction_picks
      WHERE round_id = p_round_id AND NOT is_correct
   );

  -- 라운드 갱신
  UPDATE public.prediction_rounds
     SET state = 'settled',
         settled_at = NOW(),
         winner_user_id = v_winner,
         total_picks = v_total,
         correct_picks = v_correct
   WHERE id = p_round_id;

  RETURN QUERY SELECT v_winner, v_total, v_correct;
END $$;

GRANT EXECUTE ON FUNCTION public.settle_prediction_round(UUID) TO authenticated;

-- ============================================================================
-- 6. 후보 추출 RPC — 사용자 보여줄 5명 (랭킹 상위 + 친구 + 동네 mix)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_prediction_candidates(p_round_id UUID, p_limit INTEGER DEFAULT 8)
RETURNS TABLE (
  user_id UUID,
  display_name TEXT,
  avatar_url TEXT,
  region_gu TEXT,
  recent_km NUMERIC
)
LANGUAGE SQL STABLE SECURITY INVOKER AS $$
  WITH this_week AS (
    SELECT week_of FROM public.prediction_rounds WHERE id = p_round_id
  ),
  weekly_top AS (
    SELECT a.user_id, SUM(a.distance_km) AS km
      FROM public.activities a, this_week tw
     WHERE a.activity_date BETWEEN tw.week_of AND tw.week_of + 6
     GROUP BY a.user_id
     ORDER BY km DESC
     LIMIT p_limit
  )
  SELECT p.id, p.display_name, p.avatar_url, p.region_gu, ROUND(wt.km, 1)
    FROM weekly_top wt
    JOIN public.profiles p ON p.id = wt.user_id
   WHERE p.is_public = true OR p.id = auth.uid()
   ORDER BY wt.km DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_prediction_candidates(UUID, INTEGER) TO authenticated;

-- ============================================================================
-- 7. 현재 활성 라운드 조회 RPC
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_current_prediction_round()
RETURNS TABLE (
  id UUID,
  week_of DATE,
  starts_at TIMESTAMPTZ,
  closes_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  state TEXT,
  my_pick UUID,
  total_picks INTEGER
)
LANGUAGE SQL STABLE SECURITY INVOKER AS $$
  SELECT
    r.id, r.week_of, r.starts_at, r.closes_at, r.ends_at, r.state,
    (SELECT picked_user_id FROM public.prediction_picks pp
      WHERE pp.round_id = r.id AND pp.user_id = auth.uid() LIMIT 1) AS my_pick,
    (SELECT COUNT(*)::INTEGER FROM public.prediction_picks pp WHERE pp.round_id = r.id) AS total_picks
  FROM public.prediction_rounds r
  WHERE r.cohort_type = 'global'
  ORDER BY r.week_of DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_current_prediction_round() TO authenticated;

-- ============================================================================
-- 8. 첫 라운드 자동 생성
-- ============================================================================
SELECT public.create_prediction_round('global', NULL);
