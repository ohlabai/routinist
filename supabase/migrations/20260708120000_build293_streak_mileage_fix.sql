-- build 293 hotfix: 스트릭 마일리지 (streak_7/streak_30) 가 출시 이후 0건 지급 — 연속일 수식 버그
--
-- gaps-and-islands 에서 DESC 정렬은 group_key = activity_date "+" (rn-1) 이어야 섬이 상수가 된다.
-- prod 는 "-" 라서 연속 날짜 D, D-1, D-2 가 D, D-2, D-4 로 흩어져 COUNT 가 항상 1 →
-- 7일/30일 보너스 (70P/300P) 가 단 한 번도 발화하지 않음 (mileage_transactions 0건으로 확인).
-- 리텐션 래더 작성 중 에이전트가 발견. 부호 1글자만 수정 (나머지 prod 원문 유지).
-- freeze 사용일 산입은 의도적으로 미포함 (마일리지는 실제 달린 날 기준 — v1 분리 유지).

CREATE OR REPLACE FUNCTION public.award_activity_milestones()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
             activity_date + ((ROW_NUMBER() OVER (ORDER BY activity_date DESC) - 1)::INT) AS group_key
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
$function$
;
