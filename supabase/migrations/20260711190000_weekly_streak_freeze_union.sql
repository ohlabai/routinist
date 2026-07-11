-- build 299: 회귀 리뷰 C1 fix — 주간 연속 보상 트리거가 보호권 주를 무시하던 불일치.
-- 클라 표시 "7주 연속" vs 보상 "1주 연속" 갈림 해소 (streak_freeze_uses UNION).

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
      -- build 299 C1: 보호권 주 UNION — 클라 getWeeklyStreak·streak_risk push 와 동일 정의.
      -- 이전엔 트리거만 freeze 를 무시해 보호권으로 이은 스트릭의 보상이 1주차로 리셋됐음.
      SELECT u.wk, ROW_NUMBER() OVER (ORDER BY u.wk DESC) AS rn
      FROM (
        SELECT w.wk FROM weeks w, goal WHERE w.run_days >= goal.g
        UNION
        SELECT date_trunc('week', f.used_on)::date
        FROM public.streak_freeze_uses f
        WHERE f.user_id = NEW.user_id
      ) u
      WHERE u.wk <= v_this_week
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
