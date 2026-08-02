-- 우승자 맞히기 정산 푸시 (2026-08-02 hans: "맞추면 마일리지·알림 가고 있나?")
-- 현행: 적중자 50P (award_mileage) + 예측점수 +10 은 이미 지급 — 알림만 없었음.
-- 추가: 정산 시 적중자에게 축하 푸시 (round 당 1회 — settle 자체가 state 가드로 1회).
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
  v_winner_name TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('settle_round:' || p_round_id::text));

  SELECT * INTO v_round FROM public.prediction_rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Round not found'; END IF;
  IF v_round.state = 'settled' THEN
    RETURN QUERY SELECT v_round.winner_user_id, v_round.total_picks, v_round.correct_picks;
    RETURN;
  END IF;

  v_week_start := v_round.week_of;
  v_week_end := v_week_start + 6;

  SELECT a.user_id INTO v_winner
    FROM public.activities a
    JOIN public.profiles p ON p.id = a.user_id AND COALESCE(p.is_public, true) = true
   WHERE a.activity_date BETWEEN v_week_start AND v_week_end
   GROUP BY a.user_id
   ORDER BY SUM(a.distance_km) DESC
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

  SELECT display_name INTO v_winner_name FROM public.profiles WHERE id = v_winner;
  v_winner_name := regexp_replace(LEFT(COALESCE(v_winner_name, '러너'), 24), '[[:cntrl:]]', '', 'g');

  -- 적중자: 50P + 축하 푸시 (2026-08-02 추가 — 이전엔 포인트만 조용히 지급)
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
    BEGIN
      IF public.should_send_push(v_user, 'prediction_result') THEN
        INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
        VALUES (v_user, 'prediction_result',
          public.push_text(v_user, '🎯 우승자 적중!', '🎯 You called it!'),
          public.push_text(v_user,
            '이번 주 우승자 ' || v_winner_name || '님을 맞혔어요 — 50P 적립 + 예측 점수 +10!',
            'You picked this week''s winner ' || v_winner_name || ' — +50P and +10 prediction score!'),
          jsonb_build_object('round_id', p_round_id, 'deep_link', '/dashboard'),
          'pending');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'prediction_result push failed for %: %', v_user, SQLERRM;
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
