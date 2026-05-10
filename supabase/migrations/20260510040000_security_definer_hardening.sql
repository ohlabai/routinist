-- SECURITY DEFINER 함수 권한 가드 + search_path 명시.
--
-- 발견된 문제:
--   1. award_mileage / award_distance_mileage 가 호출자 검증 없음 → 임의 사용자에게 보상 트리거 가능.
--   2. purge_old_client_error_logs 가 누구나 실행 가능 → 다른 사용자 로그 삭제 가능.
--   3. create_prediction_round 가 누구나 호출 + 동일 week_of 의 cohort_type 을 EXCLUDED 로 덮음 → sabotage.
--   4. update_profile_totals 가 본인 검증 없음 (주석은 약속하나 본체에 가드 없음).
--   5. SECURITY DEFINER 다수 함수에 SET search_path 누락.
--
-- 전략:
--   - award_mileage / award_distance_mileage / settle_prediction_round / create_prediction_round
--     / purge_old_client_error_logs 는 클라이언트에서 직접 RPC 호출하지 않음 (검증됨).
--     → GRANT 를 authenticated 에서 revoke. 트리거 / cron / service_role 에서만 호출.
--   - update_profile_totals / daily_quote / toggle_quote_like / routine_photos_trending /
--     get_prediction_candidates 는 클라이언트가 호출 → 본체에 본인 검증 추가 또는 search_path 만 보강.

-- ============================================================================
-- 1. authenticated 에서 RPC 권한 revoke (트리거에는 영향 없음)
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.award_mileage(UUID, TEXT, JSONB) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.award_distance_mileage(UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.settle_prediction_round(UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.create_prediction_round(TEXT, TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.purge_old_client_error_logs(INT) FROM authenticated;

-- service_role 은 PostgREST 기본 권한이 모두 허용이므로 별도 GRANT 불필요.
-- 운영자가 RPC 가 필요할 때는 service-role key 로 호출.

-- ============================================================================
-- 2. update_profile_totals — 본인 검증 추가 + search_path 명시
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_profile_totals(p_user_id UUID)
RETURNS TABLE (total_runs INTEGER, total_distance_km NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total_runs INTEGER;
  v_total_distance NUMERIC;
BEGIN
  -- 본인의 totals 만 갱신 가능 (트리거가 호출하지 않으므로 authenticated 만 검사).
  IF auth.role() = 'authenticated' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'forbidden: cannot update other user totals';
  END IF;

  SELECT COUNT(*)::INTEGER, COALESCE(SUM(distance_km), 0)
    INTO v_total_runs, v_total_distance
  FROM public.activities
  WHERE user_id = p_user_id;

  UPDATE public.profiles
     SET total_runs = v_total_runs,
         total_distance_km = ROUND(v_total_distance::NUMERIC, 2),
         updated_at = NOW()
   WHERE id = p_user_id;

  RETURN QUERY SELECT v_total_runs, ROUND(v_total_distance::NUMERIC, 2);
END;
$$;

REVOKE ALL ON FUNCTION public.update_profile_totals(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_profile_totals(UUID) TO authenticated;

-- ============================================================================
-- 3. settle_prediction_round — advisory lock 으로 동시성 보호 (이중 지급 방지)
--    + search_path 명시. 권한은 위에서 이미 revoke 했으므로 service_role 만 호출.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.settle_prediction_round(p_round_id UUID)
RETURNS TABLE (winner_user_id UUID, total_picks INTEGER, correct_picks INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_round public.prediction_rounds%ROWTYPE;
  v_winner UUID;
  v_total INTEGER;
  v_correct INTEGER;
  v_week_start DATE;
  v_week_end DATE;
BEGIN
  -- 동일 round 동시 settle 차단 (transaction 끝까지 lock).
  PERFORM pg_advisory_xact_lock(hashtext('settle_round:' || p_round_id::text));

  SELECT * INTO v_round FROM public.prediction_rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Round not found'; END IF;
  IF v_round.state = 'settled' THEN
    RETURN QUERY SELECT v_round.winner_user_id, v_round.total_picks, v_round.correct_picks;
    RETURN;
  END IF;

  v_week_start := v_round.week_of;
  v_week_end := v_week_start + 6;

  SELECT user_id INTO v_winner
    FROM public.activities
   WHERE activity_date BETWEEN v_week_start AND v_week_end
   GROUP BY user_id
   ORDER BY SUM(distance_km) DESC
   LIMIT 1;

  IF v_winner IS NULL THEN
    UPDATE public.prediction_rounds SET state = 'settled', settled_at = NOW() WHERE id = p_round_id;
    RETURN QUERY SELECT NULL::UUID, 0, 0;
    RETURN;
  END IF;

  UPDATE public.prediction_picks
     SET is_correct = (picked_user_id = v_winner)
   WHERE round_id = p_round_id;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE is_correct)
    INTO v_total, v_correct
    FROM public.prediction_picks
   WHERE round_id = p_round_id;

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

  UPDATE public.prediction_rounds
     SET state = 'settled',
         settled_at = NOW(),
         winner_user_id = v_winner,
         total_picks = v_total,
         correct_picks = v_correct
   WHERE id = p_round_id;

  RETURN QUERY SELECT v_winner, v_total, v_correct;
END;
$$;

-- ============================================================================
-- 4. create_prediction_round — ON CONFLICT DO NOTHING 으로 sabotage 방지
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_prediction_round(p_cohort_type TEXT DEFAULT 'global', p_cohort_value TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_monday DATE;
  v_starts TIMESTAMPTZ;
  v_closes TIMESTAMPTZ;
  v_ends TIMESTAMPTZ;
  v_round_id UUID;
BEGIN
  v_monday := date_trunc('week', NOW() AT TIME ZONE 'Asia/Seoul')::DATE;
  v_starts := (v_monday::TEXT || ' 00:00:00')::TIMESTAMP AT TIME ZONE 'Asia/Seoul';
  v_closes := (v_starts + INTERVAL '5 days 23 hours 59 minutes');
  v_ends   := (v_starts + INTERVAL '6 days 23 hours 59 minutes');

  -- 같은 week_of 라운드 존재 시 cohort_type 덮어쓰지 않음 (sabotage 방지).
  INSERT INTO public.prediction_rounds (week_of, cohort_type, cohort_value, starts_at, closes_at, ends_at)
  VALUES (v_monday, p_cohort_type, p_cohort_value, v_starts, v_closes, v_ends)
  ON CONFLICT (week_of) DO NOTHING
  RETURNING id INTO v_round_id;

  IF v_round_id IS NULL THEN
    SELECT id INTO v_round_id FROM public.prediction_rounds WHERE week_of = v_monday LIMIT 1;
  END IF;

  RETURN v_round_id;
END;
$$;

-- ============================================================================
-- 5. SECURITY DEFINER 함수에 search_path 명시 (search_path hijack 방지)
-- ============================================================================
ALTER FUNCTION public.award_mileage(UUID, TEXT, JSONB) SET search_path = public, pg_temp;
ALTER FUNCTION public.award_distance_mileage(UUID) SET search_path = public, pg_temp;
ALTER FUNCTION public.purge_old_client_error_logs(INTEGER) SET search_path = public, pg_temp;
ALTER FUNCTION public.routine_photos_trending(UUID, INTEGER) SET search_path = public, pg_temp;
ALTER FUNCTION public.daily_quote(DATE) SET search_path = public, pg_temp;
ALTER FUNCTION public.toggle_quote_like(UUID) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_prediction_candidates(UUID, INTEGER) SET search_path = public, pg_temp;

-- award_signup_bonus / award_friend_invite / award_activity_milestones 트리거 함수도 보강.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'award_signup_bonus') THEN
    EXECUTE 'ALTER FUNCTION public.award_signup_bonus() SET search_path = public, pg_temp';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'award_friend_invite') THEN
    EXECUTE 'ALTER FUNCTION public.award_friend_invite() SET search_path = public, pg_temp';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'award_activity_milestones') THEN
    EXECUTE 'ALTER FUNCTION public.award_activity_milestones() SET search_path = public, pg_temp';
  END IF;
END $$;
