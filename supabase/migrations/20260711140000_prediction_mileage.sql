-- build 299: 우승자 예측 적중 마일리지 (2026-07-11 사용자 요청)
--
-- 기존 설계는 의도적으로 마일리지 없음 (+10 예측점수만). 적중 시 50P 지급 추가.
-- per_milestone dedup: milestone_id = 'pred_' || round_id → 라운드당 1회 (재정산 안전).

INSERT INTO public.mileage_reward_config (event_type, amount, description, is_active, recurrence, cooldown_days)
VALUES ('prediction_correct', 50, '이번 주 우승자 예측 적중', true, 'per_milestone', 0)
ON CONFLICT (event_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.settle_prediction_round(p_round_id uuid)
 RETURNS TABLE(winner_user_id uuid, total_picks integer, correct_picks integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_round public.prediction_rounds%ROWTYPE;
  v_winner UUID;
  v_total INTEGER;
  v_correct INTEGER;
  v_week_start DATE;
  v_week_end DATE;
  v_user UUID;
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

  -- build 299: 적중자 50P (라운드당 1회 — milestone dedup 이라 재정산에도 안전).
  -- 보상 실패가 정산을 막으면 안 됨.
  FOR v_user IN
    SELECT user_id FROM public.prediction_picks
     WHERE round_id = p_round_id AND is_correct
  LOOP
    BEGIN
      PERFORM public.award_mileage(
        v_user,
        'prediction_correct',
        jsonb_build_object(
          'milestone_id', 'pred_' || p_round_id::text,
          'round_id', p_round_id,
          'week_of', v_round.week_of
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'prediction_correct award failed for %: %', v_user, SQLERRM;
    END;
  END LOOP;

  UPDATE public.prediction_rounds
     SET state = 'settled',
         settled_at = NOW(),
         winner_user_id = v_winner,
         total_picks = v_total,
         correct_picks = v_correct
   WHERE id = p_round_id;

  RETURN QUERY SELECT v_winner, v_total, v_correct;
END;
$function$;
