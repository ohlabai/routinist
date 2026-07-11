-- build 299: 주간 연속 보상 누진제 (2026-07-11 hans 결정)
--
-- 방금 만든 weekly_streak_3 (70P)/weekly_streak_8 (200P) 단발 보너스를 폐기하고,
-- **달성한 주마다 10P × 연속 주 수 (상한 10주 = 100P)** 로 교체.
--   1주차 10P, 2주차 20P … 8주차 80P, 10주차 100P, 11주차 이후 매주 100P.
-- 지급 시점 = 그 주의 목표를 채우는 러닝 저장 순간. 주당 1회 dedup (milestone 'wk_' || 주 시작일).
-- 금액이 동적이라 award_mileage (고정 config.amount) 대신 직접 지급 (course_complete_refund 패턴).

UPDATE public.mileage_reward_config SET is_active = false, updated_at = NOW()
 WHERE event_type IN ('weekly_streak_3', 'weekly_streak_8');

INSERT INTO public.mileage_reward_config (event_type, amount, description, is_active, recurrence, cooldown_days)
VALUES ('weekly_streak', 0, '주간 연속 달성 — 매주 10P × 연속 주 (상한 100P, 동적 계산)', true, 'per_milestone', 0)
ON CONFLICT (event_type) DO UPDATE SET is_active = true, amount = 0,
  description = '주간 연속 달성 — 매주 10P × 연속 주 (상한 100P, 동적 계산)', updated_at = NOW();

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
    IF COALESCE(v_weekly_streak, 0) >= 1 THEN
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
