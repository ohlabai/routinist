-- build 156: 마일리지 거리 보상은 가입일 이후 활동만.
-- 사용자 정책: Apple Health 일괄 import 시 과거 활동에 대량 적립 (Diana 4,282M) → 부당.
-- 정책: activity 의 KST date 가 profile.created_at::date 보다 이전이면 모든 마일리지 보상 skip.
--
-- 적용 위치 (이중 안전망):
-- 1. award_activity_milestones trigger 시작부 — 모든 보상 차단 (마일스톤 + 거리 + streak + 월목표 + 친구초대)
-- 2. award_distance_mileage 함수 시작부 — 별도 직접 호출 케이스 대비

-- 1) award_activity_milestones trigger 에 가입일 가드 추가
CREATE OR REPLACE FUNCTION public.award_activity_milestones()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_dist NUMERIC;
  v_streak INTEGER;
  v_streak_id TEXT;
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

    -- streak (KST 기준 연속일) — 7일/30일 단발 보너스
    WITH consecutive AS (
      SELECT activity_date,
             ROW_NUMBER() OVER (ORDER BY activity_date DESC) AS rn,
             activity_date - ((ROW_NUMBER() OVER (ORDER BY activity_date DESC) - 1)::INT) AS group_key
        FROM (SELECT DISTINCT activity_date FROM public.activities WHERE user_id = NEW.user_id) a
       WHERE activity_date <= v_kst_date
    )
    SELECT COUNT(*) INTO v_streak FROM consecutive WHERE group_key = v_kst_date;

    IF v_streak >= 7 THEN
      v_streak_id := 's7_' || (v_kst_date - 6)::text;
      PERFORM public.award_mileage(NEW.user_id, 'streak_7', jsonb_build_object('streak_id', v_streak_id, 'days', v_streak));
    END IF;
    IF v_streak >= 30 THEN
      v_streak_id := 's30_' || (v_kst_date - 29)::text;
      PERFORM public.award_mileage(NEW.user_id, 'streak_30', jsonb_build_object('streak_id', v_streak_id, 'days', v_streak));
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

    -- inviter 보상 (friend_invite_inviter) — 기존 로직 유지
    IF v_dist >= 5 THEN
      DECLARE f RECORD;
      BEGIN
        SELECT * INTO f FROM public.friend_links WHERE follower_id IS NOT NULL AND followee_id = NEW.user_id LIMIT 1;
        IF FOUND THEN
          PERFORM public.award_mileage(
            f.follower_id,
            'friend_invite_inviter',
            jsonb_build_object('invitee_id', NEW.user_id)
          );
        END IF;
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- 보상 실패해도 activity insert 자체는 통과.
    NULL;
  END;
  RETURN NEW;
END;
$$;

-- 2) award_distance_mileage 도 동일 가드 (직접 호출 케이스 대비)
CREATE OR REPLACE FUNCTION public.award_distance_mileage(p_activity_id uuid)
RETURNS TABLE(awarded boolean, amount integer, multiplier integer, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_activity public.activities%ROWTYPE;
  v_kst_date DATE;
  v_yesterday DATE;
  v_signup_date DATE;
  v_distance_km INTEGER;
  v_multiplier INTEGER := 1;
  v_total INTEGER;
  v_already_count INTEGER;
  v_milestone_id TEXT;
  v_new_balance INTEGER;
BEGIN
  SELECT * INTO v_activity FROM public.activities WHERE id = p_activity_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0, 1, 'activity not found';
    RETURN;
  END IF;

  v_kst_date := (COALESCE(v_activity.started_at, (v_activity.activity_date || ' 12:00:00')::TIMESTAMPTZ) AT TIME ZONE 'Asia/Seoul')::DATE;
  v_yesterday := v_kst_date - 1;

  -- build 156: 가입일 이전 활동은 거리 보상 X
  SELECT created_at::date INTO v_signup_date FROM public.profiles WHERE id = v_activity.user_id;
  IF v_signup_date IS NOT NULL AND v_kst_date < v_signup_date THEN
    RETURN QUERY SELECT false, 0, 1, 'before signup date';
    RETURN;
  END IF;

  v_distance_km := FLOOR(v_activity.distance_km)::INTEGER;
  IF v_distance_km < 1 THEN
    RETURN QUERY SELECT false, 0, 1, 'distance < 1km';
    RETURN;
  END IF;

  v_milestone_id := 'distance_' || p_activity_id::text;
  SELECT COUNT(*) INTO v_already_count
    FROM public.mileage_transactions
   WHERE user_id = v_activity.user_id
     AND event_type = 'distance_km'
     AND (metadata->>'milestone_id') = v_milestone_id;
  IF v_already_count > 0 THEN
    RETURN QUERY SELECT false, 0, 1, 'already awarded for this activity';
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_already_count
    FROM public.activities
   WHERE user_id = v_activity.user_id
     AND id != p_activity_id
     AND ((COALESCE(started_at, (activity_date || ' 12:00:00')::TIMESTAMPTZ) AT TIME ZONE 'Asia/Seoul')::DATE = v_yesterday);
  IF v_already_count > 0 THEN
    v_multiplier := 2;
  END IF;

  v_total := v_distance_km * v_multiplier;

  UPDATE public.profiles
     SET mileage_balance = COALESCE(mileage_balance, 0) + v_total
   WHERE id = v_activity.user_id
   RETURNING mileage_balance INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RETURN QUERY SELECT false, 0, v_multiplier, 'profile not found';
    RETURN;
  END IF;

  INSERT INTO public.mileage_transactions
    (user_id, amount, balance_after, tx_type, event_type, description, metadata)
  VALUES
    (v_activity.user_id, v_total, v_new_balance, 'reward', 'distance_km',
     v_distance_km || 'km × ' || v_multiplier || ' 보상',
     jsonb_build_object('milestone_id', v_milestone_id, 'distance_km', v_distance_km, 'multiplier', v_multiplier, 'activity_id', p_activity_id));

  RETURN QUERY SELECT true, v_total, v_multiplier, 'awarded';
END;
$$;
