-- build 299: DB 리뷰 발견 fix (2026-07-11 F1·F2)
--
-- F1: settle_prediction_round — 승자 선정을 후보 풀 (is_public) 과 일치시킴.
-- F2: award_activity_milestones — 주간 연속 보상은 실시간 주에만 (백필 소급 차단).

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

  -- build 299 F1: 승자 풀 = 후보 풀 (is_public 프로필만). 이전엔 비공개 프로필이
  -- 최다 km 면 "아무도 고를 수 없던 유저" 가 정답이 돼 전원 오답 처리됐음.
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

CREATE OR REPLACE FUNCTION public.award_activity_milestones()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_dist NUMERIC;
  v_weekly_streak INTEGER;
  v_this_week DATE;
  v_week_amount INTEGER;
  v_already INTEGER;
  v_new_balance INTEGER;
  v_monthly_total NUMERIC;
  v_goal NUMERIC;
  v_month_int INT;
  v_year_int INT;
  v_kst_date DATE;
  v_signup_date DATE;
BEGIN
  -- 가입일 검사 — 가입 전 활동은 어떤 보상도 안 함 (build 156)
  SELECT created_at::date INTO v_signup_date FROM public.profiles WHERE id = NEW.user_id;
  v_kst_date := (COALESCE(NEW.started_at, (NEW.activity_date || ' 12:00:00')::TIMESTAMPTZ) AT TIME ZONE 'Asia/Seoul')::DATE;
  IF v_signup_date IS NOT NULL AND v_kst_date < v_signup_date THEN
    RETURN NEW;
  END IF;

  -- 보상 로직 전체를 보호: 어떤 예외가 나도 NEW 는 정상 RETURN.
  BEGIN
    v_dist := NEW.distance_km;

    -- 거리 milestone (단발 보너스, 정책 그대로 유지)
    IF v_dist >= 5 THEN
      PERFORM public.award_mileage(NEW.user_id, 'first_5km', jsonb_build_object('activity_id', NEW.id));
    END IF;
    IF v_dist >= 10 THEN
      PERFORM public.award_mileage(NEW.user_id, 'first_10km', jsonb_build_object('activity_id', NEW.id));
    END IF;
    IF v_dist >= 21.0975 THEN
      PERFORM public.award_mileage(NEW.user_id, 'first_half', jsonb_build_object('activity_id', NEW.id));
    END IF;
    IF v_dist >= 42.195 THEN
      PERFORM public.award_mileage(NEW.user_id, 'first_marathon', jsonb_build_object('activity_id', NEW.id));
    END IF;

    -- 신규 (build 62): km 당 1마일 + 어제 달렸으면 ×2
    PERFORM public.award_distance_mileage(NEW.id);

    -- build 299 누진제: 이번 주 목표를 채우는 순간, 10P × 연속 주 (상한 100P). 걷기 제외.
    v_this_week := date_trunc('week', v_kst_date)::date;
    WITH goal AS (
      SELECT GREATEST(1, COALESCE(weekly_run_goal, 1)) AS g
      FROM public.profiles WHERE id = NEW.user_id
    ),
    weeks AS (
      SELECT date_trunc('week', a.activity_date)::date AS wk,
             COUNT(DISTINCT a.activity_date) AS run_days
      FROM public.activities a
      WHERE a.user_id = NEW.user_id
        AND (a.activity_type IS NULL OR a.activity_type <> 'walking')
        AND a.activity_date <= v_kst_date
      GROUP BY 1
    ),
    achieved AS (
      SELECT w.wk, ROW_NUMBER() OVER (ORDER BY w.wk DESC) AS rn
      FROM weeks w, goal
      WHERE w.run_days >= goal.g AND w.wk <= v_this_week
    )
    SELECT COUNT(*) INTO v_weekly_streak
    FROM achieved
    WHERE wk = v_this_week - ((rn - 1) * 7)::int;  -- rn 은 bigint — 캐스팅 필수

    -- v_weekly_streak >= 1 = 이번 주 달성됨 (연속 v_weekly_streak 주째)
    -- build 299 F2: 활동의 주 = "지금" 의 KST 주일 때만 지급 — Health 재연결 등으로
    -- 과거 몇 주를 일괄 백필하면 주마다 소급 지급되던 구멍 차단.
    IF COALESCE(v_weekly_streak, 0) >= 1
       AND v_this_week = date_trunc('week', (NOW() AT TIME ZONE 'Asia/Seoul')::date)::date THEN
      SELECT COUNT(*) INTO v_already
        FROM public.mileage_transactions
       WHERE user_id = NEW.user_id
         AND event_type = 'weekly_streak'
         AND (metadata->>'milestone_id') = 'wk_' || v_this_week::text;
      IF v_already = 0 THEN
        v_week_amount := 10 * LEAST(v_weekly_streak, 10);
        UPDATE public.profiles
           SET mileage_balance = COALESCE(mileage_balance, 0) + v_week_amount
         WHERE id = NEW.user_id
         RETURNING mileage_balance INTO v_new_balance;
        INSERT INTO public.mileage_transactions
          (user_id, amount, balance_after, tx_type, event_type, description, metadata)
        VALUES
          (NEW.user_id, v_week_amount, COALESCE(v_new_balance, v_week_amount), 'reward',
           'weekly_streak',
           '주간 목표 달성 — ' || v_weekly_streak || '주 연속',
           jsonb_build_object('milestone_id', 'wk_' || v_this_week::text,
                              'weeks', v_weekly_streak, 'week_start', v_this_week));
      END IF;
    END IF;

    -- 월 목표 달성
    v_year_int := EXTRACT(YEAR FROM v_kst_date)::INT;
    v_month_int := EXTRACT(MONTH FROM v_kst_date)::INT;
    SELECT goal_km INTO v_goal
      FROM public.monthly_goals
     WHERE user_id = NEW.user_id AND year = v_year_int AND month = v_month_int;
    IF v_goal IS NOT NULL AND v_goal > 0 THEN
      SELECT COALESCE(SUM(distance_km), 0) INTO v_monthly_total
        FROM public.activities
       WHERE user_id = NEW.user_id
         AND EXTRACT(YEAR FROM activity_date)::INT = v_year_int
         AND EXTRACT(MONTH FROM activity_date)::INT = v_month_int;
      IF v_monthly_total >= v_goal THEN
        PERFORM public.award_mileage(NEW.user_id, 'monthly_goal_complete', '{}'::jsonb);
      END IF;
    END IF;

    -- friend_invite_inviter 는 award_referral_inviter 트리거 (build 293) 담당.
  EXCEPTION WHEN OTHERS THEN
    -- 보상 실패해도 activity insert 자체는 통과.
    NULL;
  END;
  RETURN NEW;
END;
$function$;
